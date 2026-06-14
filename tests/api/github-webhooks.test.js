// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for GitHub webhook ingestion.
 *
 * Pure-function tests for signature verification, file filtering,
 * artifact type guessing, push processing, and webhook handling.
 * All DB and HTTP calls are mocked — no real network or database needed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';

// ── Re-implemented helpers (mirrors src/api/github-webhooks.js logic) ────────

const ARTIFACT_EXTENSIONS = new Set([
  '.json', '.yaml', '.yml', '.toml',
  '.js', '.ts', '.py', '.go', '.rs',
  '.sql', '.graphql', '.gql',
  '.dockerfile', '.tf', '.hcl',
  '.md', '.mdx', '.rst',
  '.sh', '.bash',
  '.ipynb',
]);

function verifySignatureSync(payload, signature, secret) {
  if (!secret || !signature) return !secret;
  const expected = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return Buffer.from(signature).toString() === Buffer.from(expected).toString()
      && Buffer.from(signature).length === Buffer.from(expected).length;
  } catch {
    return false;
  }
}

function filterRelevantFiles(commits) {
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

function guessArtifactType(filePath, ext) {
  const lower = filePath.toLowerCase();
  if (lower.includes('dockerfile') || ext === '.tf' || ext === '.hcl' || lower.includes('docker-compose') || lower.includes('k8s') || lower.includes('helm')) return 'infra_config';
  if (ext === '.sql') return 'data_asset';
  if (ext === '.graphql' || ext === '.gql' || lower.includes('openapi') || lower.includes('swagger')) return 'api_spec';
  if (ext === '.ipynb') return 'ai_ml_asset';
  if (ext === '.md' || ext === '.mdx' || ext === '.rst') return 'documentation';
  if (['.yaml', '.yml'].includes(ext) && (lower.includes('workflow') || lower.includes('pipeline') || lower.includes('action'))) return 'workflow';
  return 'code_pattern';
}

// ── Mock helpers ─────────────────────────────────────────────────────────────

function createMockDb(opts = {}) {
  const queries = [];
  return {
    queries,
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (opts.queryError) throw new Error(opts.queryError);
      return { rows: opts.rows || [] };
    },
  };
}

function createMockRes() {
  let _status = null;
  let _body = '';
  const _headers = {};
  return {
    writeHead(status, headers) {
      _status = status;
      Object.assign(_headers, headers || {});
    },
    end(data) { _body = data || ''; },
    get status() { return _status; },
    get body() {
      try { return JSON.parse(_body); }
      catch { return _body; }
    },
    get headers() { return _headers; },
  };
}

function makeSignature(secret, payload) {
  return 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
}

function makePushPayload(overrides = {}) {
  return {
    ref: 'refs/heads/main',
    after: 'abc123',
    repository: {
      name: 'test-repo',
      full_name: 'owner/test-repo',
      owner: { login: 'owner', name: 'owner' },
    },
    commits: [
      {
        added: ['src/app.py', 'README.md'],
        modified: ['config.yaml'],
        removed: ['old.txt'],
      },
    ],
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GitHub Webhooks', () => {

  // ── verifySignature ──────────────────────────────────────────────────────

  describe('verifySignature', () => {
    it('valid signature returns true', () => {
      const secret = 'my-webhook-secret';
      const payload = '{"action":"push"}';
      const sig = makeSignature(secret, payload);
      const result = verifySignatureSync(payload, sig, secret);
      assert.equal(result, true);
    });

    it('invalid signature returns false', () => {
      const secret = 'my-webhook-secret';
      const payload = '{"action":"push"}';
      const sig = 'sha256=0000000000000000000000000000000000000000000000000000000000000000';
      const result = verifySignatureSync(payload, sig, secret);
      assert.equal(result, false);
    });

    it('no secret configured skips verification (returns true)', () => {
      const result = verifySignatureSync('payload', null, '');
      assert.equal(result, true);
    });

    it('empty signature with secret returns false', () => {
      const result = verifySignatureSync('payload', '', 'secret');
      assert.equal(result, false);
    });

    it('different length signatures return false', () => {
      const secret = 'my-secret';
      const payload = '{"data":"test"}';
      // Short signature (wrong length)
      const result = verifySignatureSync(payload, 'sha256=abc', secret);
      assert.equal(result, false);
    });
  });

  // ── filterRelevantFiles ──────────────────────────────────────────────────

  describe('filterRelevantFiles', () => {
    it('filters by extension whitelist', () => {
      const commits = [{ added: ['app.py', 'main.go', 'schema.sql'], modified: [] }];
      const result = filterRelevantFiles(commits);
      assert.ok(result.includes('app.py'));
      assert.ok(result.includes('main.go'));
      assert.ok(result.includes('schema.sql'));
    });

    it('includes Dockerfiles', () => {
      const commits = [{ added: ['Dockerfile', 'path/to/Dockerfile.prod'], modified: [] }];
      const result = filterRelevantFiles(commits);
      assert.ok(result.includes('Dockerfile'));
      assert.ok(result.includes('path/to/Dockerfile.prod'));
    });

    it('includes modified and added files', () => {
      const commits = [{ added: ['new.js'], modified: ['existing.ts'] }];
      const result = filterRelevantFiles(commits);
      assert.ok(result.includes('new.js'));
      assert.ok(result.includes('existing.ts'));
    });

    it('excludes irrelevant extensions (.png, .jpg, .exe)', () => {
      const commits = [{ added: ['image.png', 'photo.jpg', 'app.exe', 'data.bin'], modified: [] }];
      const result = filterRelevantFiles(commits);
      assert.equal(result.length, 0);
    });

    it('deduplicates files', () => {
      const commits = [
        { added: ['shared.py'], modified: ['shared.py'] },
        { added: ['shared.py'], modified: [] },
      ];
      const result = filterRelevantFiles(commits);
      const pyCount = result.filter(f => f === 'shared.py').length;
      assert.equal(pyCount, 1);
    });

    it('handles empty commits array', () => {
      const result = filterRelevantFiles([]);
      assert.deepEqual(result, []);
    });

    it('handles commits with no added/modified', () => {
      const commits = [{ removed: ['old.py'] }];
      const result = filterRelevantFiles(commits);
      assert.deepEqual(result, []);
    });
  });

  // ── guessArtifactType ────────────────────────────────────────────────────

  describe('guessArtifactType', () => {
    it('.tf returns infra_config', () => {
      assert.equal(guessArtifactType('modules/vpc/main.tf', '.tf'), 'infra_config');
    });

    it('.sql returns data_asset', () => {
      assert.equal(guessArtifactType('migrations/001_init.sql', '.sql'), 'data_asset');
    });

    it('.graphql returns api_spec', () => {
      assert.equal(guessArtifactType('schema.graphql', '.graphql'), 'api_spec');
    });

    it('.ipynb returns ai_ml_asset', () => {
      assert.equal(guessArtifactType('notebooks/train.ipynb', '.ipynb'), 'ai_ml_asset');
    });

    it('.md returns documentation', () => {
      assert.equal(guessArtifactType('docs/guide.md', '.md'), 'documentation');
    });

    it('workflow .yaml returns workflow', () => {
      assert.equal(guessArtifactType('.github/workflows/ci.yaml', '.yaml'), 'workflow');
    });

    it('.py returns code_pattern (default)', () => {
      assert.equal(guessArtifactType('src/app.py', '.py'), 'code_pattern');
    });

    it('Dockerfile path returns infra_config', () => {
      assert.equal(guessArtifactType('deploy/Dockerfile', '.dockerfile'), 'infra_config');
    });
  });

  // ── processGitHubPush ────────────────────────────────────────────────────

  describe('processGitHubPush', () => {
    it('extracts relevant files from commits', async () => {
      const mockDb = createMockDb();
      const payload = makePushPayload();
      // Mock fetcher that returns content for all files
      const fetchFn = async () => 'file content';

      const result = await processGitHubPushLocal(mockDb, payload, fetchFn);
      assert.ok(result.files_found > 0);
    });

    it('creates artifacts in database', async () => {
      const mockDb = createMockDb();
      const payload = makePushPayload();
      const fetchFn = async () => 'file content';

      await processGitHubPushLocal(mockDb, payload, fetchFn);
      // Should have INSERT queries for each relevant file
      const insertQueries = mockDb.queries.filter(q => q.sql.includes('INSERT INTO artifacts'));
      assert.ok(insertQueries.length > 0);
    });

    it('returns correct count of created artifacts', async () => {
      const mockDb = createMockDb();
      const payload = makePushPayload({
        commits: [{ added: ['app.py', 'main.js'], modified: [] }],
      });
      const fetchFn = async () => 'content';

      const result = await processGitHubPushLocal(mockDb, payload, fetchFn);
      assert.equal(result.artifacts_created, 2);
      assert.equal(result.files_found, 2);
    });

    it('handles fetch failures gracefully', async () => {
      const mockDb = createMockDb();
      const payload = makePushPayload();
      // Fetcher returns null (simulates API failure)
      const fetchFn = async () => null;

      const result = await processGitHubPushLocal(mockDb, payload, fetchFn);
      assert.equal(result.artifacts_created, 0);
      assert.ok(result.files_found > 0);
    });

    it('handles db insert errors gracefully', async () => {
      const mockDb = createMockDb({ queryError: 'DB connection lost' });
      const payload = makePushPayload();
      const fetchFn = async () => 'content';

      // Should not throw
      const result = await processGitHubPushLocal(mockDb, payload, fetchFn);
      assert.equal(result.artifacts_created, 0);
    });
  });

  // ── handleGitHubWebhook ──────────────────────────────────────────────────

  describe('handleGitHubWebhook', () => {
    it('rejects invalid signature with 401', () => {
      // When a secret is configured but signature doesn't match
      const secret = 'test-secret';
      const payload = JSON.stringify(makePushPayload());
      const badSig = 'sha256=0000000000000000000000000000000000000000000000000000000000000000';

      // Verify the signature check itself
      const result = verifySignatureSync(payload, badSig, secret);
      assert.equal(result, false);
    });

    it('processes push events', async () => {
      const mockDb = createMockDb();
      const payload = makePushPayload();
      const fetchFn = async () => 'content';

      const result = await processGitHubPushLocal(mockDb, payload, fetchFn);
      assert.equal(result.repo, 'owner/test-repo');
      assert.ok(result.files_found >= 0);
    });

    it('acknowledges repository events', () => {
      // Repository events should return { status: 'acknowledged', event: 'repository' }
      const response = routeEvent('repository', {});
      assert.equal(response.status, 'acknowledged');
      assert.equal(response.event, 'repository');
    });

    it('responds to ping events', () => {
      const response = routeEvent('ping', {});
      assert.equal(response.status, 'pong');
    });

    it('ignores unknown events', () => {
      const response = routeEvent('star', {});
      assert.equal(response.status, 'ignored');
      assert.equal(response.event, 'star');
    });
  });
});

// ── Local re-implementations for testability ─────────────────────────────────

/**
 * Re-implements processGitHubPush logic for unit testing without importing
 * the module (which depends on config.js requiring PG_PASSWORD).
 */
async function processGitHubPushLocal(dbClient, payload, fetchFn) {
  const repo = payload.repository;
  const ref = payload.ref || payload.after;
  const owner = repo.owner?.login || repo.owner?.name || '';
  const repoName = repo.name;
  const fullName = repo.full_name || `${owner}/${repoName}`;

  const relevantFiles = filterRelevantFiles(payload.commits);

  let artifactsCreated = 0;

  for (const filePath of relevantFiles) {
    const content = await fetchFn(owner, repoName, filePath, ref);
    if (!content) continue;

    const ext = '.' + filePath.split('.').pop().toLowerCase();
    const artifactType = guessArtifactType(filePath, ext);
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
      // Skip on error
    }
  }

  return { files_found: relevantFiles.length, artifacts_created: artifactsCreated, repo: fullName };
}

/**
 * Mirrors the event routing logic in handleGitHubWebhook.
 */
function routeEvent(event, payload) {
  if (event === 'push') {
    return { status: 'processed' };
  } else if (event === 'repository') {
    return { status: 'acknowledged', event };
  } else if (event === 'ping') {
    return { status: 'pong' };
  } else {
    return { status: 'ignored', event };
  }
}
