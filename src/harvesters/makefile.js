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
  { query: 'filename:Makefile .PHONY', label: 'makefile-phony' },
  { query: 'filename:Makefile docker build', label: 'makefile-docker' },
  { query: 'filename:Makefile test lint', label: 'makefile-test-lint' },
];

const GITHUB_API = 'https://api.github.com';
const CONCURRENCY = 5;
const MAX_PAGES_PER_QUERY = 5;

/**
 * Harvester for Makefile definitions on GitHub.
 * Focuses on Makefiles with PHONY targets, Docker integration, and test/lint workflows.
 */
export class MakefileHarvester extends ArtifactBaseHarvester {
  constructor() {
    super(
      'makefile',
      'code_pattern',
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
      logger.warn('No GITHUB_TOKEN set, skipping Makefile harvester');
      return;
    }

    for (const { query, label } of SEARCH_QUERIES) {
      if (signal.aborted) break;
      logger.info(`Makefile search: "${query}" [${label}]`);

      try {
        await this._searchAndProcess(query, label, signal);
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        logger.error('Makefile search query failed', { query, error: err.message });
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
      logger.info(`Makefile page ${page}: ${items.length} items`);

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
    if (text.length > 500000 || text.length < 5) { this.stats.invalid++; return; }

    this.stats.discovered++;

    const filename = searchResult.name || 'Makefile';
    const normalized = this._normalize(searchResult, text, filename, label);

    const { isDuplicate } = await checkArtifactDuplicate(
      normalized.hash, normalized.source, normalized.source_id
    );
    if (isDuplicate) { this.stats.duplicate++; return; }

    await storeArtifact(normalized);
    this.stats.new++;
    logger.debug('Stored Makefile', {
      id: normalized.id,
      targetCount: normalized.type_metadata.targets.length,
      repo: searchResult.repository?.full_name,
    });
  }

  _normalize(searchResult, content, filename, label) {
    const components = extractMakefileComponents(content);
    const name = searchResult?.repository?.full_name
      ? `${searchResult.repository.full_name}/${filename}`
      : extractNameFromPath(filename);
    const description = searchResult?.repository?.description || '';

    const typeMetadata = {
      pattern_type: 'makefile',
      targets: components.targets,
      phony_targets: components.phonyTargets,
      has_docker: components.hasDocker,
      has_test: components.hasTest,
      has_lint: components.hasLint,
      has_help: components.hasHelp,
      variable_count: components.variableCount,
    };

    return {
      id: randomUUID(),
      hash: generateContentHash(content, 'makefile'),
      artifact_type: 'code_pattern',
      source: 'makefile',
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
      language: 'makefile',
      tool_type: 'make',
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
 * Extract components from Makefile content.
 *
 * @param {string} content - Raw Makefile text
 * @returns {object}
 */
export function extractMakefileComponents(content) {
  if (!content || typeof content !== 'string') {
    return {
      targets: [],
      phonyTargets: [],
      hasDocker: false,
      hasTest: false,
      hasLint: false,
      hasHelp: false,
      variableCount: 0,
    };
  }

  // .PHONY targets: collect all names after .PHONY:
  const phonyTargets = [];
  const phonyMatches = content.match(/^\.PHONY\s*:\s*(.+)/gm) || [];
  for (const m of phonyMatches) {
    const rest = m.replace(/^\.PHONY\s*:\s*/, '').trim();
    for (const t of rest.split(/\s+/)) {
      if (t) phonyTargets.push(t);
    }
  }

  // All targets: lines starting with a non-whitespace word followed by ':'
  // Exclude variable assignments (VAR = ...) and .PHONY lines
  const targets = [];
  for (const line of content.split('\n')) {
    if (/^\.PHONY/.test(line)) continue;
    if (/^#/.test(line)) continue;
    const m = line.match(/^([\w][\w.-]*)\s*:/);
    if (m && !m[1].includes('=')) targets.push(m[1]);
  }

  // Variable definitions: lines like VAR = value or VAR := value or VAR ?= value
  const varMatches = content.match(/^[\w][\w_]*\s*[:?!+]?=/gm) || [];
  const variableCount = varMatches.length;

  const hasDocker = /\bdocker\b/i.test(content);
  const hasTest = targets.some(t => /^test/.test(t)) || phonyTargets.some(t => /^test/.test(t));
  const hasLint = targets.some(t => /^lint/.test(t)) || phonyTargets.some(t => /^lint/.test(t));
  const hasHelp = targets.includes('help') || phonyTargets.includes('help');

  return {
    targets: [...new Set(targets)].slice(0, 100),
    phonyTargets: [...new Set(phonyTargets)],
    hasDocker,
    hasTest,
    hasLint,
    hasHelp,
    variableCount,
  };
}
