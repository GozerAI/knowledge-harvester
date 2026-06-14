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
 * Segmented search queries to work around GitHub's 1000-result-per-query limit.
 * Each query targets a different pattern of n8n workflow files.
 */
const SEARCH_QUERIES = [
  // By file naming patterns
  'filename:workflow.json n8n',
  'filename:n8n-workflow extension:json',
  '"n8n-nodes-base" extension:json',
  // By content patterns (specific node types)
  '"n8n-nodes-base.webhook" extension:json',
  '"n8n-nodes-base.httpRequest" extension:json',
  '"n8n-nodes-base.code" extension:json',
  // By repository topic
  'topic:n8n-workflow',
  'topic:n8n-automation',
  // By readme mentions
  'n8n workflow template in:readme',
];

const GITHUB_API = 'https://api.github.com';
const CONCURRENCY = 5;
const MAX_PAGES_PER_QUERY = 10; // GitHub caps at 1000 results = 10 pages of 100

/**
 * Harvester for GitHub code search.
 * Searches for JSON files containing n8n workflow definitions, then
 * fetches raw content, validates, normalizes, and stores.
 */
export class GitHubHarvester extends BaseHarvester {
  constructor() {
    // 5000 req/hour authenticated, but code search is stricter (~30/min)
    super(
      'github',
      new RateLimiter({ maxTokens: 10, refillRate: 1, refillIntervalMs: 2500 })
    );
    this.seenUrls = new Set(); // Cross-query dedup by html_url
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
      logger.warn('No GITHUB_TOKEN set, skipping GitHub harvester');
      return;
    }

    for (const query of SEARCH_QUERIES) {
      if (signal.aborted) break;
      logger.info(`GitHub search: "${query}"`);

      try {
        await this._searchAndProcess(query, signal);
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        logger.error('GitHub search query failed', { query, error: err.message });
      }

      // Pause between queries to stay well within rate limits
      if (!signal.aborted) {
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  /**
   * Execute a single search query with pagination, process all results.
   */
  async _searchAndProcess(query, signal) {
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= MAX_PAGES_PER_QUERY && !signal.aborted) {
      await this.rateLimiter.acquire();

      const url = `${GITHUB_API}/search/code?q=${encodeURIComponent(query)}&per_page=100&page=${page}`;
      const res = await fetch(url, { headers: this._headers(), signal });

      // Handle rate limiting via response headers
      await this._handleRateLimit(res);

      if (res.status === 403 || res.status === 429) {
        logger.warn('GitHub rate limited, pausing 60s');
        await new Promise(r => setTimeout(r, 60000));
        continue; // Retry same page
      }

      if (res.status === 422) {
        // Validation failed — usually means the query returned too many results
        logger.warn('GitHub search validation failed', { query, page });
        break;
      }

      if (!res.ok) {
        logger.error(`GitHub search failed: ${res.status}`, { query, page });
        break;
      }

      const data = await res.json();
      const items = data.items || [];
      logger.info(`GitHub page ${page}: ${items.length} items (total: ${data.total_count})`);

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

      // Pause between pages
      if (hasMore && !signal.aborted) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  /**
   * Monitor GitHub rate limit headers and pause proactively.
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
   * Fetch a single file from GitHub, validate as n8n workflow, normalize, store.
   */
  async _processFile(searchResult, signal) {
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

    // Try to parse as JSON
    let content;
    try {
      const text = await res.text();
      content = JSON.parse(text);
    } catch {
      this.stats.invalid++;
      return; // Not valid JSON
    }

    // Validate as n8n workflow
    if (!this._isN8nWorkflow(content)) {
      this.stats.invalid++;
      return;
    }

    this.stats.discovered++;

    const normalized = normalizeWorkflow('github', {
      searchResult,
      workflowJson: content,
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
    logger.debug('Stored GitHub workflow', {
      id: normalized.id,
      name: normalized.workflow_name,
      repo: searchResult.repository?.full_name,
    });
  }

  /**
   * Check if a JSON object looks like an n8n workflow.
   */
  _isN8nWorkflow(obj) {
    if (!obj || !Array.isArray(obj.nodes)) return false;
    // Must have at least one n8n-specific node type
    return obj.nodes.some(
      n =>
        n.type?.startsWith('n8n-nodes-base.') ||
        n.type?.startsWith('@n8n/') ||
        n.type?.includes('n8n')
    );
  }
}
