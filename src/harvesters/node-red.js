// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { BaseHarvester } from './base.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { normalizeWorkflow } from '../processing/normalizer.js';
import { checkDuplicate } from '../processing/deduplicator.js';
import { storeWorkflow } from '../db/store.js';
import { logger } from '../utils/logger.js';

/**
 * Node-RED Flow Library Harvester.
 *
 * Node-RED is a flow-based programming tool for IoT and integration.
 * The community flow library at flows.nodered.org hosts thousands of
 * reusable flows, nodes, and collections.
 *
 * API: https://flows.nodered.org/things?format=json
 * Source: https://github.com/node-red/flow-library
 */
const LIBRARY_URL = 'https://flows.nodered.org';
const PAGE_SIZE = 50;
const MAX_PAGES = 300; // ~15,000 flows max

export class NodeRedHarvester extends BaseHarvester {
  constructor() {
    super(
      'node-red',
      new RateLimiter({ maxTokens: 5, refillRate: 1, refillIntervalMs: 2000 })
    );
    this.seenIds = new Set();
  }

  async _harvest(signal) {
    let page = 1;

    while (page <= MAX_PAGES && !signal.aborted) {
      await this.rateLimiter.acquire();

      try {
        const url = `${LIBRARY_URL}/things?format=json&type=flow&page=${page}&page_size=${PAGE_SIZE}`;
        const res = await fetch(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'KnowledgeHarvester/1.0',
          },
          signal,
        });

        if (res.status === 429) {
          logger.warn('Node-RED rate limited, pausing 30s');
          await new Promise(r => setTimeout(r, 30000));
          continue;
        }

        if (!res.ok) {
          logger.error(`Node-RED API error: ${res.status}`);
          break;
        }

        const body = await res.json();
        const flows = body.data || [];
        const totalPages = body.meta?.pages?.total || 0;

        if (!Array.isArray(flows) || flows.length === 0) {
          logger.info('Node-RED: no more flows');
          break;
        }

        logger.info(
          `Node-RED page ${page}/${totalPages}: ${flows.length} flows`
        );

        for (const flowSummary of flows) {
          if (signal.aborted) break;

          try {
            await this._processFlow(flowSummary, signal);
            this.resetConsecutiveErrors();
          } catch (err) {
            if (err.name === 'AbortError') throw err;
            this.recordError(err);
          }
        }

        // Stop if we've reached the last page
        if (page >= totalPages || flows.length < PAGE_SIZE) break;

        page++;

        // Polite pause between pages
        if (!signal.aborted) {
          await new Promise(r => setTimeout(r, 1500));
        }
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        logger.error('Node-RED page fetch failed', {
          page,
          error: err.message,
        });
        break;
      }
    }
  }

  /**
   * Process a single flow from the listing, fetching full detail.
   */
  async _processFlow(flowSummary, signal) {
    const flowId = flowSummary._id;
    if (!flowId || this.seenIds.has(flowId)) return;
    this.seenIds.add(flowId);

    // Skip non-flow types that might slip through
    if (flowSummary.isNode || flowSummary.isCollection) return;

    // Fetch full flow detail (includes the actual nodes/wires definition)
    await this.rateLimiter.acquire();

    const detailUrl = `${LIBRARY_URL}/flow/${flowId}?format=json`;
    const res = await fetch(detailUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'KnowledgeHarvester/1.0',
      },
      signal,
    });

    if (!res.ok) {
      this.stats.invalid++;
      return;
    }

    const flowDetail = await res.json();

    // Validate: must have a nodes array with real nodes
    if (!this._validate(flowDetail)) {
      this.stats.invalid++;
      return;
    }

    this.stats.discovered++;

    const normalized = normalizeWorkflow('node-red', {
      flowSummary,
      flowDetail,
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
    logger.debug('Stored Node-RED flow', {
      id: normalized.id,
      name: normalized.workflow_name,
    });
  }

  /**
   * Validate a flow detail has meaningful node structure.
   */
  _validate(flowDetail) {
    // The flow JSON contains a nodes array
    const nodes = flowDetail.nodes || flowDetail.flow?.nodes || [];

    if (!Array.isArray(nodes)) return false;

    // Filter out tab/comment/subflow-template nodes — count real nodes
    const realNodes = nodes.filter(
      (n) =>
        n.type &&
        n.type !== 'tab' &&
        n.type !== 'comment' &&
        n.type !== 'subflow' &&
        !n.type.startsWith('subflow:')
    );

    return realNodes.length >= 2;
  }
}
