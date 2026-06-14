// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { BaseHarvester } from './base.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { normalizeWorkflow } from '../processing/normalizer.js';
import { checkDuplicate } from '../processing/deduplicator.js';
import { storeWorkflow } from '../db/store.js';
import { logger } from '../utils/logger.js';

/**
 * Activepieces Template Gallery Harvester.
 *
 * Activepieces is an open-source automation platform (alternative to Zapier/Make).
 * This harvester pulls from their public template gallery API.
 *
 * API: https://cloud.activepieces.com/api/v1/flow-templates
 * Docs: https://www.activepieces.com/docs/developers/overview
 */
const AP_API = 'https://cloud.activepieces.com/api/v1/flow-templates';
const PAGE_SIZE = 50;
const MAX_PAGES = 200; // ~10,000 templates max

export class ActivepiecesHarvester extends BaseHarvester {
  constructor() {
    super(
      'activepieces',
      new RateLimiter({ maxTokens: 5, refillRate: 1, refillIntervalMs: 2000 })
    );
    this.seenIds = new Set();
  }

  async _harvest(signal) {
    let cursor = undefined;
    let page = 0;

    while (page < MAX_PAGES && !signal.aborted) {
      await this.rateLimiter.acquire();

      try {
        const url = new URL(AP_API);
        url.searchParams.set('limit', String(PAGE_SIZE));
        if (cursor) url.searchParams.set('cursor', cursor);

        const res = await fetch(url.toString(), {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'KnowledgeHarvester/1.0',
          },
          signal,
        });

        if (res.status === 429) {
          logger.warn('Activepieces rate limited, pausing 30s');
          await new Promise(r => setTimeout(r, 30000));
          continue;
        }

        if (!res.ok) {
          logger.error(`Activepieces API error: ${res.status}`);
          break;
        }

        const data = await res.json();
        const templates = data.data || data || [];

        if (!Array.isArray(templates) || templates.length === 0) {
          logger.info('Activepieces: no more templates');
          break;
        }

        logger.info(`Activepieces page ${page + 1}: ${templates.length} templates`);

        for (const template of templates) {
          if (signal.aborted) break;

          try {
            await this._processTemplate(template);
            this.resetConsecutiveErrors();
          } catch (err) {
            if (err.name === 'AbortError') throw err;
            this.recordError(err);
          }
        }

        // Pagination: check for cursor/next token
        cursor = data.cursor || data.next;
        if (!cursor && templates.length < PAGE_SIZE) break;

        page++;

        // Pause between pages
        if (!signal.aborted) {
          await new Promise(r => setTimeout(r, 1500));
        }
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        logger.error('Activepieces page fetch failed', { page, error: err.message });
        break;
      }
    }
  }

  /**
   * Process a single Activepieces template.
   */
  async _processTemplate(template) {
    const templateId = template.id || template.name;
    if (!templateId || this.seenIds.has(templateId)) return;
    this.seenIds.add(templateId);

    // Validate: must have a flow definition with trigger/actions
    if (!this._validate(template)) {
      this.stats.invalid++;
      return;
    }

    this.stats.discovered++;

    const normalized = normalizeWorkflow('activepieces', { template });

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
    logger.debug('Stored Activepieces template', {
      id: normalized.id,
      name: normalized.workflow_name,
    });
  }

  /**
   * Validate an Activepieces template has meaningful flow structure.
   */
  _validate(template) {
    // Must have a name or displayName
    if (!template.name && !template.displayName && !template.template?.displayName) {
      return false;
    }

    // Must have some flow definition
    const flow = template.template || template;
    if (flow.trigger) return true;
    if (flow.pieces && flow.pieces.length > 0) return true;
    if (flow.steps && flow.steps.length > 0) return true;
    if (flow.actions && flow.actions.length > 0) return true;

    return false;
  }
}
