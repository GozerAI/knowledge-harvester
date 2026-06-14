// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { ArtifactBaseHarvester } from './artifact-base.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { storeArtifact, checkArtifactDuplicate } from '../db/artifact-store.js';
import { normalizeInfraConfig } from '../processing/strategies/infra-config/normalizer.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import pLimit from 'p-limit';

const SEARCH_QUERIES = [
  { query: '"apiVersion" "kind: Deployment" extension:yaml', label: 'k8s-deployment' },
  { query: '"apiVersion" "kind: StatefulSet" extension:yaml', label: 'k8s-statefulset' },
  { query: '"apiVersion" "kind: Ingress" extension:yaml', label: 'k8s-ingress' },
];

const GITHUB_API = 'https://api.github.com';
const CONCURRENCY = 5;
const MAX_PAGES_PER_QUERY = 5;

/**
 * Harvester for Kubernetes manifest YAML files on GitHub.
 */
export class K8sManifestsHarvester extends ArtifactBaseHarvester {
  constructor() {
    super(
      'k8s-manifests',
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
      logger.warn('No GITHUB_TOKEN set, skipping K8s manifests harvester');
      return;
    }

    for (const { query, label } of SEARCH_QUERIES) {
      if (signal.aborted) break;
      logger.info(`K8s manifests search: "${query}" [${label}]`);

      try {
        await this._searchAndProcess(query, label, signal);
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        logger.error('K8s search failed', { query, error: err.message });
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
    if (text.length > 500000 || text.length < 30) { this.stats.invalid++; return; }

    if (!this._validateK8s(text, searchResult.name)) { this.stats.invalid++; return; }

    this.stats.discovered++;

    const normalized = normalizeInfraConfig('k8s-manifests', {
      searchResult,
      content: text,
      label,
      filename: searchResult.name || '',
    });

    const { isDuplicate } = await checkArtifactDuplicate(
      normalized.hash, normalized.source, normalized.source_id
    );
    if (isDuplicate) { this.stats.duplicate++; return; }

    await storeArtifact(normalized);
    this.stats.new++;
  }

  _validateK8s(content, filename) {
    const ext = (filename || '').split('.').pop()?.toLowerCase();
    if (!['yaml', 'yml'].includes(ext)) return false;

    // Must have apiVersion and kind — the two required K8s fields
    return content.includes('apiVersion:') && content.includes('kind:');
  }
}
