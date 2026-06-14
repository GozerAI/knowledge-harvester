// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { BaseHarvester } from './base.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { normalizeWorkflow } from '../processing/normalizer.js';
import { checkDuplicate } from '../processing/deduplicator.js';
import { storeWorkflow } from '../db/store.js';
import { logger } from '../utils/logger.js';
import pLimit from 'p-limit';

const BASE_URL = 'https://api.n8n.io/api/templates';
const PAGE_SIZE = 50;
const CONCURRENCY = 3;

/**
 * Harvester for the n8n Community Templates API.
 *
 * Corrected endpoints (spec was outdated):
 *   List:   GET /api/templates/search?page=1&rows=50
 *   Detail: GET /api/templates/workflows/{id}
 *
 * Response nesting for detail:
 *   response.workflow          = outer metadata (id, name, description, user)
 *   response.workflow.workflow = inner workflow definition (nodes, connections)
 */
export class N8nCommunityHarvester extends BaseHarvester {
  constructor() {
    // ~100 requests/hour = conservative 1 req per 2 seconds
    super(
      'n8n-community',
      new RateLimiter({ maxTokens: 5, refillRate: 1, refillIntervalMs: 2000 })
    );
  }

  async _harvest(signal) {
    // 1. Get total count from first page
    const firstPage = await this._fetchPage(1, signal);
    const totalWorkflows = firstPage.totalWorkflows;
    const totalPages = Math.ceil(totalWorkflows / PAGE_SIZE);
    logger.info(`n8n Community: ${totalWorkflows} templates across ${totalPages} pages`);

    // 2. Process each page
    for (let page = 1; page <= totalPages; page++) {
      if (signal.aborted) break;

      const pageData = page === 1 ? firstPage : await this._fetchPage(page, signal);
      const workflows = pageData.workflows || [];
      logger.info(`Processing page ${page}/${totalPages}`, { count: workflows.length });

      if (workflows.length === 0) break;

      // 3. Fetch full details with concurrency limit
      const limit = pLimit(CONCURRENCY);
      const tasks = workflows.map(wf =>
        limit(async () => {
          if (signal.aborted) return;
          await this.rateLimiter.acquire();
          try {
            await this._processTemplate(wf.id, signal);
            this.resetConsecutiveErrors();
          } catch (err) {
            this.recordError(err);
          }
        })
      );
      await Promise.all(tasks);

      // Delay between pages
      if (page < totalPages && !signal.aborted) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  /**
   * Fetch a page of template listings from the search endpoint.
   */
  async _fetchPage(page, signal) {
    await this.rateLimiter.acquire();
    const url = `${BASE_URL}/search?page=${page}&rows=${PAGE_SIZE}`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`n8n API ${res.status}: ${url}`);
    return res.json();
  }

  /**
   * Fetch full template details, normalize, dedup, and store.
   */
  async _processTemplate(templateId, signal) {
    const url = `${BASE_URL}/workflows/${templateId}`;
    const res = await fetch(url, { signal });

    if (!res.ok) {
      if (res.status === 404) {
        this.stats.invalid++;
        return; // Template may have been removed
      }
      throw new Error(`n8n API ${res.status}: ${url}`);
    }

    const data = await res.json();
    const templateData = data.workflow; // outer wrapper

    // Validate that inner workflow exists with nodes
    if (!templateData?.workflow || !Array.isArray(templateData.workflow.nodes)) {
      this.stats.invalid++;
      logger.warn('Template missing workflow data', { templateId });
      return;
    }

    this.stats.discovered++;

    // Normalize — pass the outer wrapper (normalizer extracts inner .workflow)
    const normalized = normalizeWorkflow('n8n-community', templateData);

    // Dedup check
    const { isDuplicate } = await checkDuplicate(
      normalized.hash,
      normalized.source,
      normalized.source_id
    );
    if (isDuplicate) {
      this.stats.duplicate++;
      return;
    }

    // Store
    await storeWorkflow(normalized);
    this.stats.new++;
    logger.debug('Stored new workflow', {
      id: normalized.id,
      name: normalized.workflow_name,
    });
  }
}
