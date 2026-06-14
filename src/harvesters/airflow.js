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
 * Apache Airflow DAG Harvester (GitHub code search).
 *
 * Airflow is the most popular open-source workflow orchestrator.
 * DAGs are defined in Python. This harvester finds real DAG definitions
 * via GitHub code search, targeting provider imports, operators, and DAG patterns.
 */
const SEARCH_QUERIES = [
  // Core DAG definitions
  { query: '"from airflow" "DAG" extension:py' },
  { query: '"from airflow.decorators" "@dag" extension:py' },
  { query: '"from airflow.models" "DAG" extension:py' },

  // Operator imports (common operators signal real DAGs)
  { query: '"from airflow.operators" extension:py' },
  { query: '"from airflow.providers" extension:py' },
  { query: '"from airflow.sensors" extension:py' },

  // Specific popular patterns
  { query: '"BashOperator" "from airflow" extension:py' },
  { query: '"PythonOperator" "from airflow" extension:py' },
  { query: '"BigQueryOperator" "from airflow" extension:py' },
  { query: '"S3" "from airflow.providers" extension:py' },
  { query: '"GCS" "from airflow.providers" extension:py' },

  // TaskFlow API (modern Airflow)
  { query: '"@task" "from airflow.decorators" extension:py' },
];

const GITHUB_API = 'https://api.github.com';
const CONCURRENCY = 5;
const MAX_PAGES_PER_QUERY = 5;

export class AirflowHarvester extends BaseHarvester {
  constructor() {
    super(
      'airflow',
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
      logger.warn('No GITHUB_TOKEN set, skipping Airflow harvester');
      return;
    }

    for (const { query } of SEARCH_QUERIES) {
      if (signal.aborted) break;
      logger.info(`Airflow search: "${query}"`);

      try {
        await this._searchAndProcess(query, signal);
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        logger.error('Airflow search query failed', { query, error: err.message });
      }

      if (!signal.aborted) {
        await new Promise(r => setTimeout(r, 5000));
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
      logger.info(`Airflow page ${page}: ${items.length} items (total: ${data.total_count})`);

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

    const filename = searchResult.name || searchResult.path?.split('/').pop() || '';
    const normalized = normalizeWorkflow('airflow', {
      searchResult,
      content: text,
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
    logger.debug('Stored Airflow DAG', {
      id: normalized.id,
      name: normalized.workflow_name,
      repo: searchResult.repository?.full_name,
    });
  }

  /**
   * Validate a Python file is a genuine Airflow DAG definition.
   * Must have airflow imports AND DAG instantiation/decoration.
   */
  _validate(content) {
    // Must import from airflow
    const hasAirflowImport =
      content.includes('from airflow') || content.includes('import airflow');
    if (!hasAirflowImport) return false;

    // Must have a DAG definition (either classic or TaskFlow API)
    const hasDagDef =
      content.includes('DAG(') ||          // Classic: dag = DAG(...)
      content.includes('@dag') ||           // TaskFlow: @dag decorator
      content.includes('with DAG') ||       // Context manager: with DAG(...) as dag:
      content.includes('dag_id');           // Explicit dag_id parameter

    return hasDagDef;
  }
}
