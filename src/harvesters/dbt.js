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
 * Segmented search queries for dbt projects on GitHub.
 * Each query targets a different dbt pattern.
 */
const SEARCH_QUERIES = [
  { query: '"config(" "materialized" extension:sql path:models', label: 'dbt-model' },
  { query: 'filename:dbt_project.yml "name:" "version:"', label: 'dbt-project' },
  { query: '"source(" "ref(" extension:sql dbt', label: 'dbt-ref-source' },
];

const GITHUB_API = 'https://api.github.com';
const CONCURRENCY = 5;
const MAX_PAGES_PER_QUERY = 5;

/**
 * Harvester for dbt model and project definitions on GitHub.
 * Searches for SQL files with dbt macros and dbt_project.yml configuration files.
 */
export class DbtHarvester extends BaseHarvester {
  constructor() {
    super(
      'dbt',
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
      logger.warn('No GITHUB_TOKEN set, skipping dbt harvester');
      return;
    }

    for (const { query, label } of SEARCH_QUERIES) {
      if (signal.aborted) break;
      logger.info(`dbt search: "${query}" [${label}]`);

      try {
        await this._searchAndProcess(query, label, signal);
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        logger.error('dbt search query failed', { query, error: err.message });
      }

      // Pause between queries
      if (!signal.aborted) {
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  /**
   * Execute a single search query with pagination.
   */
  async _searchAndProcess(query, label, signal) {
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
      logger.info(`dbt page ${page}: ${items.length} items (total: ${data.total_count})`);

      // Process items with concurrency
      const limit = pLimit(CONCURRENCY);
      const tasks = items
        .filter(item => !this.seenUrls.has(item.html_url))
        .map(item =>
          limit(async () => {
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

  /**
   * Monitor GitHub rate limit headers.
   */
  async _handleRateLimit(res) {
    const remaining = parseInt(res.headers.get('x-ratelimit-remaining') || '999');
    if (remaining < 50) {
      const resetEpoch = parseInt(res.headers.get('x-ratelimit-reset') || '0') * 1000;
      const waitMs = Math.max(resetEpoch - Date.now() + 5000, 30000);
      logger.warn(`GitHub rate limit low (${remaining} remaining), waiting ${Math.round(waitMs / 1000)}s`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }

  /**
   * Fetch and validate a single file as a dbt definition.
   */
  async _processFile(searchResult, label, signal) {
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

    // Size check
    if (text.length > 500000) {
      this.stats.invalid++;
      return;
    }

    const filename = searchResult.name || searchResult.path?.split('/').pop() || '';
    const validation = this._validateDbt(text, filename);
    if (!validation.valid) {
      this.stats.invalid++;
      return;
    }

    this.stats.discovered++;

    const normalized = normalizeWorkflow('dbt', {
      searchResult,
      content: text,
      label,
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
    logger.debug('Stored dbt workflow', {
      id: normalized.id,
      name: normalized.workflow_name,
      label,
      repo: searchResult.repository?.full_name,
    });
  }

  /**
   * Validate that a file contains a dbt definition.
   * .sql files must contain dbt Jinja macros (config, ref, source).
   * dbt_project.yml must contain 'name:'.
   * Returns { valid: boolean }.
   */
  _validateDbt(content, filename) {
    const ext = filename.split('.').pop()?.toLowerCase();
    const baseName = filename.split('/').pop() || filename;

    // SQL files with dbt Jinja macros
    if (ext === 'sql') {
      const hasConfig = content.includes('{{ config(');
      const hasRef = content.includes('{{ ref(');
      const hasSource = content.includes('{{ source(');
      if (hasConfig || hasRef || hasSource) {
        return { valid: true };
      }
    }

    // dbt_project.yml with name
    if (baseName === 'dbt_project.yml' && content.includes('name:')) {
      return { valid: true };
    }

    return { valid: false };
  }
}
