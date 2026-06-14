// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { BaseHarvester } from './base.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { normalizeWorkflow } from '../processing/normalizer.js';
import { checkDuplicate } from '../processing/deduplicator.js';
import { storeWorkflow } from '../db/store.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import pLimit from 'p-limit';

/**
 * Windmill Knowledge Harvester (GitHub code search).
 *
 * Windmill is an open-source workflow engine using OpenFlow definitions.
 * Searches for .flow.json, .flow.yaml, and Windmill script files on GitHub.
 */
const SEARCH_QUERIES = [
  // OpenFlow JSON definitions
  { query: '"openflow" extension:json windmill', lang: 'json' },
  { query: 'filename:flow.json path:windmill', lang: 'json' },
  { query: '"windmill" "modules" extension:json flow', lang: 'json' },

  // YAML flow definitions
  { query: '"windmill" extension:yaml flow', lang: 'yaml' },
  { query: 'filename:flow.yaml windmill', lang: 'yaml' },

  // Windmill scripts (TypeScript/Python with Windmill SDK)
  { query: '"from wmill" extension:py', lang: 'python' },
  { query: '"import * as wmill" extension:ts', lang: 'typescript' },
  { query: '"windmill-client" extension:ts', lang: 'typescript' },

  // Hub-style definitions
  { query: '"windmill" "summary" "schema" extension:json', lang: 'json' },
];

const GITHUB_API = 'https://api.github.com';
const CONCURRENCY = 5;
const MAX_PAGES_PER_QUERY = 5;

export class WindmillHarvester extends BaseHarvester {
  constructor() {
    super(
      'windmill',
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
      logger.warn('No GITHUB_TOKEN set, skipping Windmill harvester');
      return;
    }

    for (const { query, lang } of SEARCH_QUERIES) {
      if (signal.aborted) break;
      logger.info(`Windmill search: "${query}" [${lang}]`);

      try {
        await this._searchAndProcess(query, lang, signal);
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        logger.error('Windmill search query failed', { query, error: err.message });
      }

      if (!signal.aborted) {
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  async _searchAndProcess(query, lang, signal) {
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= MAX_PAGES_PER_QUERY && !signal.aborted) {
      await this.rateLimiter.acquire();

      const url = `${GITHUB_API}/search/code?q=${encodeURIComponent(query)}&per_page=100&page=${page}`;
      const res = await fetch(url, { headers: this._headers(), signal });

      await this._handleRateLimit(res);

      if (res.status === 403 || res.status === 429) {
        logger.warn('GitHub rate limited, pausing 60s');
        await new Promise(r => setTimeout(r, 60000));
        continue;
      }

      if (res.status === 422) {
        logger.warn('GitHub search validation failed', { query, page });
        break;
      }

      if (!res.ok) {
        logger.error(`GitHub search failed: ${res.status}`, { query, page });
        break;
      }

      const data = await res.json();
      const items = data.items || [];
      logger.info(`Windmill page ${page}: ${items.length} items (total: ${data.total_count})`);

      const limit = pLimit(CONCURRENCY);
      const tasks = items
        .filter(item => !this.seenUrls.has(item.html_url))
        .map(item =>
          limit(async () => {
            if (signal.aborted) return;
            this.seenUrls.add(item.html_url);
            await this.rateLimiter.acquire();
            try {
              await this._processFile(item, lang, signal);
              this.resetConsecutiveErrors();
            } catch (err) {
              if (err.name === 'AbortError') throw err;
              this.recordError(err);
            }
          })
        );
      await Promise.all(tasks);

      hasMore = items.length === 100;
      page++;

      if (hasMore && !signal.aborted) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  async _handleRateLimit(res) {
    const remaining = parseInt(res.headers.get('x-ratelimit-remaining') || '999');
    if (remaining < 50) {
      const resetEpoch = parseInt(res.headers.get('x-ratelimit-reset') || '0') * 1000;
      const waitMs = Math.max(resetEpoch - Date.now() + 5000, 30000);
      logger.warn(`GitHub rate limit low (${remaining} remaining), waiting ${Math.round(waitMs / 1000)}s`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }

  async _processFile(searchResult, lang, signal) {
    if (!searchResult.download_url) {
      this.stats.invalid++;
      return;
    }

    const res = await fetch(searchResult.download_url, {
      headers: this._headers(),
      signal,
    });

    if (!res.ok) {
      this.stats.invalid++;
      return;
    }

    const text = await res.text();

    // Skip very large files (>500KB)
    if (text.length > 500000) {
      this.stats.invalid++;
      return;
    }

    const filename = searchResult.name || searchResult.path?.split('/').pop() || '';
    if (!this._validate(text, filename, lang)) {
      this.stats.invalid++;
      return;
    }

    this.stats.discovered++;

    const normalized = normalizeWorkflow('windmill', {
      searchResult,
      content: text,
      lang,
      filename,
    });

    const { isDuplicate } = await checkDuplicate(
      normalized.hash,
      normalized.source,
      normalized.source_id
    );
    if (isDuplicate) {
      this.stats.duplicate++;
      return;
    }

    await storeWorkflow(normalized);
    this.stats.new++;
    logger.debug('Stored Windmill workflow', {
      id: normalized.id,
      name: normalized.workflow_name,
      repo: searchResult.repository?.full_name,
    });
  }

  /**
   * Validate that a file is a genuine Windmill artifact.
   */
  _validate(content, filename, lang) {
    // JSON flow definitions
    if (lang === 'json') {
      try {
        const parsed = JSON.parse(content);
        // OpenFlow: has summary + value.modules or schema
        if (parsed.summary && (parsed.value?.modules || parsed.schema)) return true;
        // Flow with modules array
        if (parsed.modules && Array.isArray(parsed.modules)) return true;
        // Windmill resource/script with path
        if (parsed.path && (parsed.summary || parsed.description)) return true;
        // Check for windmill-specific fields
        if (content.includes('windmill') || content.includes('openflow')) return true;
      } catch {
        return false;
      }
      return false;
    }

    // YAML flow definitions
    if (lang === 'yaml') {
      return (
        (content.includes('windmill') || content.includes('openflow')) &&
        (content.includes('summary:') || content.includes('modules:') || content.includes('steps:'))
      );
    }

    // Python scripts using wmill SDK
    if (lang === 'python') {
      return content.includes('import wmill') || content.includes('from wmill');
    }

    // TypeScript scripts using Windmill SDK
    if (lang === 'typescript') {
      return (
        content.includes('windmill-client') ||
        content.includes('import * as wmill') ||
        content.includes("from 'windmill'")
      );
    }

    return false;
  }
}
