// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { ArtifactBaseHarvester } from './artifact-base.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { storeArtifact, checkArtifactDuplicate } from '../db/artifact-store.js';
import { generateContentHash } from '../utils/hash.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { randomUUID } from 'node:crypto';
import { extractNameFromPath } from '../utils/helpers.js';
import pLimit from 'p-limit';

const SEARCH_QUERIES = [
  { query: 'filename:Dockerfile FROM multi-stage', label: 'dockerfile-multistage' },
  { query: 'filename:Dockerfile USER non-root', label: 'dockerfile-nonroot' },
  { query: 'filename:Dockerfile HEALTHCHECK', label: 'dockerfile-healthcheck' },
];

const GITHUB_API = 'https://api.github.com';
const CONCURRENCY = 5;
const MAX_PAGES_PER_QUERY = 5;

/**
 * Harvester for Dockerfile definitions on GitHub.
 * Focuses on patterns such as multi-stage builds, non-root users, and healthchecks.
 */
export class DockerfileHarvester extends ArtifactBaseHarvester {
  constructor() {
    super(
      'dockerfile',
      'infra_config',
      new RateLimiter({ maxTokens: 10, refillRate: 1, refillIntervalMs: 2500 })
    );
    this.seenUrls = new Set();
  }

  _headers() {
    return {
      Authorization: `Bearer ${config.github.token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'KnowledgeHarvester/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  async _harvest(signal) {
    if (!config.github.token) {
      logger.warn('No GITHUB_TOKEN set, skipping Dockerfile harvester');
      return;
    }

    for (const { query, label } of SEARCH_QUERIES) {
      if (signal.aborted) break;
      logger.info(`Dockerfile search: "${query}" [${label}]`);

      try {
        await this._searchAndProcess(query, label, signal);
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        logger.error('Dockerfile search query failed', { query, error: err.message });
      }

      if (!signal.aborted) await new Promise(r => setTimeout(r, 5000));
    }
  }

  async _searchAndProcess(query, label, signal) {
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= MAX_PAGES_PER_QUERY && !signal.aborted) {
      await this.rateLimiter.acquire();
      const url = `${GITHUB_API}/search/code?q=${encodeURIComponent(query)}&per_page=100&page=${page}`;
      const res = await fetch(url, { headers: this._headers(), signal });

      await this._handleRateLimit(res);
      if (res.status === 403 || res.status === 429) {
        await new Promise(r => setTimeout(r, 60000));
        continue;
      }
      if (res.status === 422 || !res.ok) break;

      const data = await res.json();
      const items = data.items || [];
      logger.info(`Dockerfile page ${page}: ${items.length} items`);

      const limit = pLimit(CONCURRENCY);
      const tasks = items
        .filter(item => !this.seenUrls.has(item.html_url))
        .map(item => limit(async () => {
          if (signal.aborted) return;
          this.seenUrls.add(item.html_url);
          await this.rateLimiter.acquire();
          try {
            await this._processFile(item, label, signal);
            this.resetConsecutiveErrors();
          } catch (err) {
            if (err.name === 'AbortError') throw err;
            this.recordError(err);
          }
        }));
      await Promise.all(tasks);

      hasMore = items.length === 100;
      page++;
      if (hasMore && !signal.aborted) await new Promise(r => setTimeout(r, 3000));
    }
  }

  async _handleRateLimit(res) {
    const remaining = parseInt(res.headers.get('x-ratelimit-remaining') || '999');
    if (remaining < 50) {
      const resetEpoch = parseInt(res.headers.get('x-ratelimit-reset') || '0') * 1000;
      const waitMs = Math.max(resetEpoch - Date.now() + 5000, 30000);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }

  async _processFile(searchResult, label, signal) {
    if (!searchResult.download_url) { this.stats.invalid++; return; }

    const res = await fetch(searchResult.download_url, { headers: this._headers(), signal });
    if (!res.ok) { this.stats.invalid++; return; }

    const text = await res.text();
    if (text.length > 500000 || text.length < 10) { this.stats.invalid++; return; }

    if (!this._validateDockerfile(text)) { this.stats.invalid++; return; }

    this.stats.discovered++;

    const filename = searchResult.name || 'Dockerfile';
    const normalized = this._normalize(searchResult, text, filename, label);

    const { isDuplicate } = await checkArtifactDuplicate(
      normalized.hash, normalized.source, normalized.source_id
    );
    if (isDuplicate) { this.stats.duplicate++; return; }

    await storeArtifact(normalized);
    this.stats.new++;
    logger.debug('Stored Dockerfile', {
      id: normalized.id,
      repo: searchResult.repository?.full_name,
    });
  }

  _validateDockerfile(content) {
    return /^FROM\s+\S+/m.test(content);
  }

  _normalize(searchResult, content, filename, label) {
    const components = extractDockerfileComponents(content);
    const name = searchResult?.repository?.full_name
      ? `${searchResult.repository.full_name}/${filename}`
      : extractNameFromPath(filename);
    const description = searchResult?.repository?.description || '';

    const typeMetadata = {
      config_type: 'dockerfile',
      stages: components.stages,
      base_images: components.baseImages,
      is_multi_stage: components.isMultiStage,
      has_healthcheck: components.hasHealthcheck,
      has_non_root_user: components.hasNonRootUser,
      exposed_ports: components.exposedPorts,
      build_args: components.buildArgs,
    };

    return {
      id: randomUUID(),
      hash: generateContentHash(content, 'dockerfile'),
      artifact_type: 'infra_config',
      source: 'dockerfile',
      source_url: searchResult?.html_url || '',
      source_id: searchResult?.sha || searchResult?.html_url || randomUUID(),
      discovered_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      content: { source_code: content, filename },
      name,
      description,
      author: {
        username: searchResult?.repository?.owner?.login || null,
        profile_url: searchResult?.repository?.owner?.html_url || null,
      },
      language: 'dockerfile',
      tool_type: 'docker',
      tool_metadata: typeMetadata,
      tags: [],
      type_metadata: typeMetadata,
      quality: {
        score: 0,
        has_description: description.length > 0,
        has_documentation: description.length > 100,
        is_complete: true,
        validation_status: 'valid',
      },
    };
  }
}

/**
 * Extract structural components from a Dockerfile.
 *
 * @param {string} content - Raw Dockerfile text
 * @returns {object}
 */
export function extractDockerfileComponents(content) {
  if (!content || typeof content !== 'string') {
    return {
      stages: [], baseImages: [], isMultiStage: false,
      hasHealthcheck: false, hasNonRootUser: false,
      exposedPorts: [], buildArgs: [],
    };
  }

  // FROM lines — each represents a stage (multi-stage if > 1)
  const fromLines = content.match(/^FROM\s+\S+(?:\s+AS\s+\S+)?/gim) || [];
  const stages = [];
  const baseImages = [];

  for (const line of fromLines) {
    const parts = line.trim().split(/\s+/);
    // parts: ['FROM', 'image[:tag]', 'AS'?, 'stagename'?]
    const image = parts[1] || '';
    if (image && image.toLowerCase() !== 'scratch') {
      baseImages.push(image.toLowerCase());
    }
    const asIdx = parts.findIndex(p => p.toLowerCase() === 'as');
    if (asIdx !== -1 && parts[asIdx + 1]) {
      stages.push(parts[asIdx + 1]);
    } else {
      stages.push(image || `stage${stages.length}`);
    }
  }

  const isMultiStage = fromLines.length > 1;
  const hasHealthcheck = /^HEALTHCHECK\s/im.test(content);

  // Non-root USER: USER directive where value is not root/0
  const userMatches = content.match(/^USER\s+(\S+)/gim) || [];
  const hasNonRootUser = userMatches.some(u => {
    const val = u.split(/\s+/)[1] || '';
    return val !== 'root' && val !== '0';
  });

  // EXPOSE ports
  const exposeLines = content.match(/^EXPOSE\s+(.+)/gim) || [];
  const exposedPorts = [];
  for (const line of exposeLines) {
    const portPart = line.replace(/^EXPOSE\s+/i, '').trim();
    for (const p of portPart.split(/\s+/)) {
      const port = p.split('/')[0];
      if (port && !exposedPorts.includes(port)) exposedPorts.push(port);
    }
  }

  // ARG names
  const argMatches = content.match(/^ARG\s+(\w+)/gim) || [];
  const buildArgs = [...new Set(argMatches.map(a => a.split(/\s+/)[1]).filter(Boolean))];

  return {
    stages,
    baseImages: [...new Set(baseImages)],
    isMultiStage,
    hasHealthcheck,
    hasNonRootUser,
    exposedPorts,
    buildArgs,
  };
}
