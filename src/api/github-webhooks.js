// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * GitHub Webhook ingestion for Knowledge Harvester.
 *
 * Receives GitHub push/ping/repository events, extracts relevant files,
 * fetches their content via GitHub API, and stores them as artifacts.
 *
 * Signature verification uses timing-safe HMAC comparison.
 * File fetching degrades gracefully — a failed fetch never blocks the pipeline.
 */

import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import https from 'node:https';
import { config } from '../config.js';
import { json } from './middleware.js';
import { logger } from '../utils/logger.js';

// File extensions we care about for artifact ingestion
export const ARTIFACT_EXTENSIONS = new Set([
  '.json', '.yaml', '.yml', '.toml',
  '.js', '.ts', '.py', '.go', '.rs',
  '.sql', '.graphql', '.gql',
  '.dockerfile', '.tf', '.hcl',
  '.md', '.mdx', '.rst',
  '.sh', '.bash',
  '.ipynb',
]);

/**
 * Verify GitHub webhook HMAC-SHA256 signature.
 * @param {string} payload - raw request body
 * @param {string} signature - X-Hub-Signature-256 header value
 * @param {string} secret - configured webhook secret
 * @returns {boolean}
 */
export function verifySignature(payload, signature, secret) {
  if (!secret) {
    logger.warn('GitHub webhook secret not configured — rejecting webhook');
    return false;
  }
  if (!signature) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Extract file paths with relevant extensions from push commits.
 * Deduplicates across added/modified in all commits.
 * @param {object[]} commits
 * @returns {string[]}
 */
export function filterRelevantFiles(commits) {
  const files = new Set();
  for (const commit of (commits || [])) {
    for (const file of [...(commit.added || []), ...(commit.modified || [])]) {
      const ext = '.' + file.split('.').pop().toLowerCase();
      if (ARTIFACT_EXTENSIONS.has(ext) || file.toLowerCase().includes('dockerfile')) {
        files.add(file);
      }
    }
  }
  return [...files];
}

/**
 * Fetch raw file content from the GitHub API.
 * Returns null on any failure (graceful degradation).
 * @param {string} owner
 * @param {string} repo
 * @param {string} path
 * @param {string} ref - commit SHA or branch
 * @returns {Promise<string|null>}
 */
export async function fetchFileContent(owner, repo, path, ref) {
  const token = config.github?.token;
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${ref}`,
      method: 'GET',
      headers: {
        'User-Agent': 'knowledge-harvester',
        'Accept': 'application/vnd.github.v3.raw',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(data);
        } else {
          resolve(null); // Graceful degradation
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.setTimeout(10000);
    req.end();
  });
}

/**
 * Guess artifact type from file path and extension.
 * @param {string} filePath
 * @param {string} ext
 * @returns {string}
 */
export function guessArtifactType(filePath, ext) {
  const lower = filePath.toLowerCase();
  if (lower.includes('dockerfile') || ext === '.tf' || ext === '.hcl' || lower.includes('docker-compose') || lower.includes('k8s') || lower.includes('helm')) return 'infra_config';
  if (ext === '.sql') return 'data_asset';
  if (ext === '.graphql' || ext === '.gql' || lower.includes('openapi') || lower.includes('swagger')) return 'api_spec';
  if (ext === '.ipynb') return 'ai_ml_asset';
  if (ext === '.md' || ext === '.mdx' || ext === '.rst') return 'documentation';
  if (['.yaml', '.yml'].includes(ext) && (lower.includes('workflow') || lower.includes('pipeline') || lower.includes('action'))) return 'workflow';
  return 'code_pattern';
}

/**
 * Process a GitHub push event: extract relevant files, fetch content, store as artifacts.
 * @param {object} dbClient
 * @param {object} payload - GitHub push webhook payload
 * @param {Function} [fetchFn] - optional fetch override for testing
 * @returns {Promise<{files_found: number, artifacts_created: number, repo: string}>}
 */
export async function processGitHubPush(dbClient, payload, fetchFn) {
  const repo = payload.repository;
  const ref = payload.ref || payload.after;
  const owner = repo.owner?.login || repo.owner?.name || '';
  const repoName = repo.name;
  const fullName = repo.full_name || `${owner}/${repoName}`;

  const relevantFiles = filterRelevantFiles(payload.commits);

  let artifactsCreated = 0;
  const fetcher = fetchFn || fetchFileContent;

  for (const filePath of relevantFiles) {
    const content = await fetcher(owner, repoName, filePath, ref);
    if (!content) continue;

    const ext = '.' + filePath.split('.').pop().toLowerCase();
    const artifactType = guessArtifactType(filePath, ext);

    // Store as artifact
    const hash = createHash('sha256').update(content).digest('hex');

    try {
      await dbClient.query(
        `INSERT INTO artifacts (id, name, description, source, source_url, source_id, artifact_type, content, hash, discovered_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
         ON CONFLICT (hash) DO UPDATE SET updated_at = NOW()`,
        [
          filePath.split('/').pop(),
          `From ${fullName}: ${filePath}`,
          'github-webhook',
          `https://github.com/${fullName}/blob/main/${filePath}`,
          `${fullName}:${filePath}`,
          artifactType,
          JSON.stringify({ raw: content, file_path: filePath, repo: fullName }),
          hash,
        ]
      );
      artifactsCreated++;
    } catch {
      // Skip on error, continue with next file
    }
  }

  return { files_found: relevantFiles.length, artifacts_created: artifactsCreated, repo: fullName };
}

/**
 * Main webhook handler — routes by X-GitHub-Event header.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {object} dbClient
 */
export async function handleGitHubWebhook(req, res, dbClient) {
  const event = req.headers['x-github-event'];
  const signature = req.headers['x-hub-signature-256'];
  const secret = config.github?.webhookSecret || '';

  // Read raw body
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString();

  // Verify signature
  if (secret && !verifySignature(rawBody, signature, secret)) {
    return json(res, 401, { error: 'Invalid signature' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' });
  }

  // Record event
  const repoFullName = payload.repository?.full_name || 'unknown';

  try {
    await dbClient.query(
      `INSERT INTO github_webhook_events (id, event_type, repo_full_name, payload, received_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW())`,
      [event, repoFullName, JSON.stringify(payload)]
    );
  } catch {
    // Event recording is best-effort
  }

  // Route events
  if (event === 'push') {
    const result = await processGitHubPush(dbClient, payload);

    // Mark event as processed
    try {
      await dbClient.query(
        `UPDATE github_webhook_events SET processed = true, artifacts_created = $1, processed_at = NOW()
         WHERE repo_full_name = $2 AND processed = false`,
        [result.artifacts_created, repoFullName]
      );
    } catch { /* best effort */ }

    return json(res, 200, { status: 'processed', ...result });
  } else if (event === 'repository') {
    return json(res, 200, { status: 'acknowledged', event });
  } else if (event === 'ping') {
    return json(res, 200, { status: 'pong' });
  } else {
    return json(res, 200, { status: 'ignored', event });
  }
}

/**
 * List all watched repos.
 * @param {object} dbClient
 * @returns {Promise<object[]>}
 */
export async function getWatchedRepos(dbClient) {
  const result = await dbClient.query('SELECT id, owner, repo, webhook_active, last_event_at, created_at FROM watched_repos ORDER BY created_at DESC');
  return result.rows;
}

/**
 * Add or re-activate a watched repo.
 * @param {object} dbClient
 * @param {string} owner
 * @param {string} repo
 * @returns {Promise<object>}
 */
export async function addWatchedRepo(dbClient, owner, repo) {
  const result = await dbClient.query(
    `INSERT INTO watched_repos (id, owner, repo) VALUES (gen_random_uuid(), $1, $2)
     ON CONFLICT (owner, repo) DO UPDATE SET webhook_active = true
     RETURNING id, owner, repo, webhook_active, created_at`,
    [owner, repo]
  );
  return result.rows[0];
}
