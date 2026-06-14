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
 * Prefect Knowledge Harvester (GitHub code search).
 *
 * Prefect is a modern Python orchestration framework. Workflows are
 * defined using @flow and @task decorators. This harvester finds real
 * Prefect flow definitions on GitHub.
 *
 * https://docs.prefect.io/
 */
const SEARCH_QUERIES = [
  { query: '"from prefect" "@flow" extension:py' },
  { query: '"from prefect" "@task" extension:py' },
  { query: '"from prefect.tasks" extension:py' },
  { query: '"from prefect.deployments" extension:py' },
  { query: '"from prefect import flow" extension:py' },
  { query: '"from prefect.runtime" extension:py' },
  { query: '"prefect.serve" extension:py' },
];

const GITHUB_API = 'https://api.github.com';
const CONCURRENCY = 5;
const MAX_PAGES_PER_QUERY = 5;

export class PrefectHarvester extends BaseHarvester {
  constructor() {
    super(
      'prefect',
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
      logger.warn('No GITHUB_TOKEN set, skipping Prefect harvester');
      return;
    }

    for (const { query } of SEARCH_QUERIES) {
      if (signal.aborted) break;
      logger.info(`Prefect search: "${query}"`);

      try {
        await this._searchAndProcess(query, signal);
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        logger.error('Prefect search query failed', {
          query,
          error: err.message,
        });
      }

      if (!signal.aborted) {
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  async _searchAndProcess(query, signal) {
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= MAX_PAGES_PER_QUERY && !signal.aborted) {
      await this.rateLimiter.acquire();

      const url = `${GITHUB_API}/search/code?q=${encodeURIComponent(query)}&per_page=100&page=${page}`;
      const res = await fetch(url, { headers: this._headers(), signal });

      await this._handleRateLimit(res);

      if (res.status === 403 || res.status === 429) {
        logger.warn('GitHub rate limited, pausing 60s');
        await new Promise((r) => setTimeout(r, 60000));
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
      logger.info(
        `Prefect page ${page}: ${items.length} items (total: ${data.total_count})`
      );

      const limit = pLimit(CONCURRENCY);
      const tasks = items
        .filter((item) => !this.seenUrls.has(item.html_url))
        .map((item) =>
          limit(async () => {
            if (signal.aborted) return;
            this.seenUrls.add(item.html_url);
            await this.rateLimiter.acquire();
            try {
              await this._processFile(item, signal);
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
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  async _handleRateLimit(res) {
    const remaining = parseInt(
      res.headers.get('x-ratelimit-remaining') || '999'
    );
    if (remaining < 50) {
      const resetEpoch =
        parseInt(res.headers.get('x-ratelimit-reset') || '0') * 1000;
      const waitMs = Math.max(resetEpoch - Date.now() + 5000, 30000);
      logger.warn(
        `GitHub rate limit low (${remaining} remaining), waiting ${Math.round(waitMs / 1000)}s`
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  async _processFile(searchResult, signal) {
    if (!searchResult.download_url) {
      this.stats.invalid++;
      return;
    }

    // Skip test files
    const path = searchResult.path || '';
    const filename = searchResult.name || path.split('/').pop() || '';
    if (
      filename.startsWith('test_') ||
      filename.endsWith('_test.py') ||
      filename === 'conftest.py' ||
      path.includes('/tests/') ||
      path.includes('/test/')
    ) {
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

    // Skip very large files
    if (text.length > 500000) {
      this.stats.invalid++;
      return;
    }

    if (!this._validate(text)) {
      this.stats.invalid++;
      return;
    }

    this.stats.discovered++;

    const normalized = normalizeWorkflow('prefect', {
      searchResult,
      content: text,
      lang: 'python',
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
    logger.debug('Stored Prefect workflow', {
      id: normalized.id,
      name: normalized.workflow_name,
      repo: searchResult.repository?.full_name,
    });
  }

  /**
   * Validate a file is genuine Prefect flow/task code.
   */
  _validate(content) {
    // Must have prefect import
    if (
      !content.includes('from prefect') &&
      !content.includes('import prefect')
    ) {
      return false;
    }

    // Must have flow or task definition
    return (
      content.includes('@flow') ||
      content.includes('@task') ||
      content.includes('flow(') ||
      content.includes('Flow(') ||
      content.includes('.serve(') ||
      content.includes('prefect.deploy')
    );
  }
}
