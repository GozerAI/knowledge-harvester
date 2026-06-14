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
 * Temporal Knowledge Harvester (GitHub code search).
 *
 * Temporal is a durable execution platform. Workflows are defined
 * in Python, TypeScript, Go, or Java. This harvester finds real
 * Temporal workflow definitions via GitHub code search.
 */
const SEARCH_QUERIES = [
  // Python SDK (temporalio)
  { query: '"from temporalio" "@workflow.defn" extension:py', lang: 'python' },
  { query: '"from temporalio.workflow" extension:py', lang: 'python' },
  { query: '"from temporalio" "activity.defn" extension:py', lang: 'python' },
  { query: '"temporalio" "workflow.run" extension:py', lang: 'python' },

  // TypeScript SDK (@temporalio/workflow)
  { query: '"@temporalio/workflow" extension:ts', lang: 'typescript' },
  { query: '"@temporalio/activity" extension:ts', lang: 'typescript' },
  { query: '"proxyActivities" "@temporalio" extension:ts', lang: 'typescript' },

  // Go SDK (go.temporal.io)
  { query: '"go.temporal.io/sdk/workflow" extension:go', lang: 'go' },
  { query: '"go.temporal.io/sdk/activity" extension:go', lang: 'go' },

  // Java SDK
  { query: '"io.temporal.workflow" "WorkflowInterface" extension:java', lang: 'java' },
  { query: '"io.temporal.activity" extension:java', lang: 'java' },
];

const GITHUB_API = 'https://api.github.com';
const CONCURRENCY = 5;
const MAX_PAGES_PER_QUERY = 5;

export class TemporalHarvester extends BaseHarvester {
  constructor() {
    super(
      'temporal',
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
      logger.warn('No GITHUB_TOKEN set, skipping Temporal harvester');
      return;
    }

    for (const { query, lang } of SEARCH_QUERIES) {
      if (signal.aborted) break;
      logger.info(`Temporal search: "${query}" [${lang}]`);

      try {
        await this._searchAndProcess(query, lang, signal);
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        logger.error('Temporal search query failed', { query, error: err.message });
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
      logger.info(`Temporal page ${page}: ${items.length} items (total: ${data.total_count})`);

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

    // Skip very large files
    if (text.length > 500000) {
      this.stats.invalid++;
      return;
    }

    const filename = searchResult.name || searchResult.path?.split('/').pop() || '';
    if (!this._validate(text, lang)) {
      this.stats.invalid++;
      return;
    }

    this.stats.discovered++;

    const normalized = normalizeWorkflow('temporal', {
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
    logger.debug('Stored Temporal workflow', {
      id: normalized.id,
      name: normalized.workflow_name,
      lang,
      repo: searchResult.repository?.full_name,
    });
  }

  /**
   * Validate a file is genuine Temporal workflow/activity code.
   */
  _validate(content, lang) {
    switch (lang) {
      case 'python':
        return (
          (content.includes('from temporalio') || content.includes('import temporalio')) &&
          (content.includes('@workflow.defn') || content.includes('@activity.defn') ||
           content.includes('workflow.run') || content.includes('workflow.execute_activity'))
        );

      case 'typescript':
        return (
          (content.includes('@temporalio/workflow') || content.includes('@temporalio/activity')) &&
          (content.includes('proxyActivities') || content.includes('defineSignal') ||
           content.includes('defineQuery') || content.includes('export async function'))
        );

      case 'go':
        return (
          content.includes('go.temporal.io/sdk/workflow') &&
          (content.includes('workflow.Go') || content.includes('workflow.ExecuteActivity') ||
           content.includes('func(ctx workflow.Context'))
        );

      case 'java':
        return (
          content.includes('io.temporal') &&
          (content.includes('@WorkflowInterface') || content.includes('@WorkflowMethod') ||
           content.includes('@ActivityInterface') || content.includes('@ActivityMethod'))
        );

      default:
        return false;
    }
  }
}
