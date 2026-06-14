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
 * Segmented search queries for Zapier, Make.com, and IFTTT configs on GitHub.
 */
const SEARCH_QUERIES = [
  // Zapier
  { query: '"zapier" "triggers" "actions" extension:json', toolType: 'zapier' },
  { query: 'filename:zapier extension:json', toolType: 'zapier' },
  { query: '"zapier" "zap" "template" extension:json', toolType: 'zapier' },
  { query: 'topic:zapier-integration', toolType: 'zapier' },
  { query: '"zapier" "steps" extension:json', toolType: 'zapier' },

  // Make.com (formerly Integromat)
  { query: '"make.com" "scenario" extension:json', toolType: 'make' },
  { query: '"integromat" "modules" extension:json', toolType: 'make' },
  { query: 'filename:scenario extension:json "modules"', toolType: 'make' },
  { query: 'topic:make-integration', toolType: 'make' },
  { query: '"integromat" extension:json', toolType: 'make' },

  // IFTTT
  { query: '"ifttt" "applet" extension:json', toolType: 'ifttt' },
  { query: '"ifttt" "trigger" "action" extension:json', toolType: 'ifttt' },
  { query: 'topic:ifttt-automation', toolType: 'ifttt' },
];

const GITHUB_API = 'https://api.github.com';
const CONCURRENCY = 5;
const MAX_PAGES_PER_QUERY = 5;

/**
 * Harvester for Zapier, Make.com, and IFTTT configurations shared on GitHub.
 * Searches for JSON files containing automation configs from these platforms.
 */
export class GitHubZapierMakeHarvester extends BaseHarvester {
  constructor() {
    super(
      'github-zapier-make',
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
      logger.warn('No GITHUB_TOKEN set, skipping Zapier/Make harvester');
      return;
    }

    for (const { query, toolType } of SEARCH_QUERIES) {
      if (signal.aborted) break;
      logger.info(`Zapier/Make search: "${query}" [${toolType}]`);

      try {
        await this._searchAndProcess(query, toolType, signal);
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        logger.error('Zapier/Make search query failed', { query, error: err.message });
      }

      if (!signal.aborted) {
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  async _searchAndProcess(query, toolType, signal) {
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
      logger.info(`Zapier/Make page ${page}: ${items.length} items (total: ${data.total_count})`);

      const limit = pLimit(CONCURRENCY);
      const tasks = items
        .filter(item => !this.seenUrls.has(item.html_url))
        .map(item =>
          limit(async () => {
            if (signal.aborted) return;
            this.seenUrls.add(item.html_url);
            await this.rateLimiter.acquire();
            try {
              await this._processFile(item, toolType, signal);
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

  async _processFile(searchResult, toolType, signal) {
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

    let content;
    try {
      const text = await res.text();
      // Size check — skip files > 1MB
      if (text.length > 1000000) {
        this.stats.invalid++;
        return;
      }
      content = JSON.parse(text);
    } catch {
      this.stats.invalid++;
      return; // Not valid JSON
    }

    // Validate as the expected tool type
    const validation = this._validateConfig(content, toolType);
    if (!validation.valid) {
      this.stats.invalid++;
      return;
    }

    this.stats.discovered++;

    const filename = searchResult.name || searchResult.path?.split('/').pop() || '';
    const normalized = normalizeWorkflow('github-zapier-make', {
      searchResult,
      content,
      toolType: validation.detectedType || toolType,
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
    logger.debug('Stored Zapier/Make workflow', {
      id: normalized.id,
      name: normalized.workflow_name,
      toolType: validation.detectedType || toolType,
      repo: searchResult.repository?.full_name,
    });
  }

  /**
   * Validate that a JSON object looks like a Zapier/Make/IFTTT config.
   */
  _validateConfig(obj, expectedType) {
    if (!obj || typeof obj !== 'object') {
      return { valid: false };
    }

    // Zapier detection
    if (this._isZapierConfig(obj)) {
      return { valid: true, detectedType: 'zapier' };
    }

    // Make.com detection
    if (this._isMakeConfig(obj)) {
      return { valid: true, detectedType: 'make' };
    }

    // IFTTT detection
    if (this._isIFTTTConfig(obj)) {
      return { valid: true, detectedType: 'ifttt' };
    }

    return { valid: false };
  }

  _isZapierConfig(obj) {
    // Zapier configs typically have triggers/actions/searches
    const hasActions = Array.isArray(obj.actions) || Array.isArray(obj.steps);
    const hasTriggers = Array.isArray(obj.triggers);
    const hasZapierKeys = obj.platformVersion || obj.zapierAppId;

    if (hasActions && hasTriggers) return true;
    if (hasZapierKeys) return true;

    // Check for Zapier-style step definitions
    if (Array.isArray(obj.steps)) {
      return obj.steps.some(s => s.action_id || s.app);
    }

    return false;
  }

  _isMakeConfig(obj) {
    // Make.com configs have modules array or scenario wrapper
    if (Array.isArray(obj.modules) && obj.modules.length > 0) {
      return obj.modules.some(m => m.module || m.type_id || m.mapper);
    }
    if (obj.scenario && Array.isArray(obj.scenario.modules)) {
      return true;
    }
    // Integromat format
    if (obj.flow && Array.isArray(obj.flow)) {
      return true;
    }
    return false;
  }

  _isIFTTTConfig(obj) {
    // IFTTT has trigger/actions or "this"/"that" structure
    if (obj.trigger && (Array.isArray(obj.actions) || obj.action)) return true;
    if (obj.this && obj.that) return true; // IFTTT "if this then that"
    if (obj.applet && (obj.applet.trigger || obj.applet.action)) return true;
    return false;
  }
}
