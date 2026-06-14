// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Trend Enricher — Enriches artifacts with Trendscope trend signals.
 *
 * Pipeline phase that:
 *   1. Fetches signals + top trends from Trendscope
 *   2. Matches trend keywords against artifact tags using tag overlap
 *   3. Writes matching signals into marketplace_metadata.trend_signals
 *
 * Reuses calculateTagOverlap from relation-builder.js for consistency.
 */

import { logger } from '../utils/logger.js';
import { getSignals, getTopTrends, mapCategory } from '../integrations/trendscope-client.js';
import { calculateTagOverlap } from './relation-builder.js';

// Minimum tag overlap count to consider a match
const MATCH_THRESHOLD = 1;

/**
 * Enrich artifacts with trend signal data from Trendscope.
 *
 * @param {object} dbClient - Database client with .query()
 * @param {number} [limit=200] - Maximum number of artifacts to process
 * @returns {Promise<{ processed: number, enriched: number, no_match: number }>}
 */
export async function enrichWithTrends(dbClient, limit = 200) {
  logger.info('Enriching artifacts with Trendscope signals', { limit });

  // Fetch trend data from Trendscope
  const [signals, topTrends] = await Promise.all([
    getSignals(),
    getTopTrends(50),
  ]);

  if (!signals && !topTrends) {
    logger.warn('Trendscope unreachable — skipping trend enrichment');
    return { processed: 0, enriched: 0, no_match: 0 };
  }

  // Build a flat list of trend entries with their signal type
  const trendEntries = [];

  if (signals) {
    for (const [signalType, trends] of Object.entries(signals)) {
      for (const trend of trends) {
        trendEntries.push({
          name: trend.name,
          signal: signalType,
          velocity: trend.velocity || 0,
          momentum: trend.momentum || 0,
          category: trend.category || null,
          keywords: trend.keywords || trend.name.toLowerCase().split(/\s+/).filter(w => w.length > 2),
        });
      }
    }
  }

  // Also include top trends that may not appear in signals
  if (topTrends && Array.isArray(topTrends)) {
    const existingNames = new Set(trendEntries.map(t => t.name));
    for (const trend of topTrends) {
      if (!existingNames.has(trend.name)) {
        trendEntries.push({
          name: trend.name,
          signal: 'hold',
          velocity: trend.velocity || 0,
          momentum: trend.momentum || 0,
          category: trend.category || null,
          keywords: trend.keywords || trend.name.toLowerCase().split(/\s+/).filter(w => w.length > 2),
        });
      }
    }
  }

  if (trendEntries.length === 0) {
    logger.info('No trend data available from Trendscope');
    return { processed: 0, enriched: 0, no_match: 0 };
  }

  logger.info(`Loaded ${trendEntries.length} trend entries from Trendscope`);

  // Fetch artifacts to enrich
  const artifactsResult = await dbClient.query(
    `SELECT id, tags, primary_category, marketplace_metadata
     FROM artifacts
     WHERE tags IS NOT NULL AND array_length(tags, 1) > 0
     ORDER BY quality_score DESC
     LIMIT $1`,
    [limit],
  );

  const artifacts = artifactsResult.rows;
  let enriched = 0;
  let no_match = 0;

  for (const artifact of artifacts) {
    const matchedSignals = [];

    for (const trend of trendEntries) {
      const { overlap_count } = calculateTagOverlap(
        artifact.tags || [],
        trend.keywords,
      );

      if (overlap_count >= MATCH_THRESHOLD) {
        matchedSignals.push({
          trend_name: trend.name,
          signal: trend.signal,
          velocity: trend.velocity,
          momentum: trend.momentum,
          matched_at: new Date().toISOString(),
        });
      }
    }

    if (matchedSignals.length === 0) {
      no_match++;
      continue;
    }

    // Sort by signal priority: strong_buy > buy > hold > sell > strong_sell
    const SIGNAL_PRIORITY = { strong_buy: 5, buy: 4, hold: 3, sell: 2, strong_sell: 1 };
    matchedSignals.sort((a, b) => (SIGNAL_PRIORITY[b.signal] || 0) - (SIGNAL_PRIORITY[a.signal] || 0));

    // Write to marketplace_metadata.trend_signals
    try {
      await dbClient.query(
        `UPDATE artifacts
         SET marketplace_metadata = jsonb_set(
           COALESCE(marketplace_metadata, '{}'),
           '{trend_signals}',
           $1::jsonb
         )
         WHERE id = $2`,
        [JSON.stringify(matchedSignals), artifact.id],
      );
      enriched++;
    } catch (err) {
      logger.error('Failed to write trend signals', { id: artifact.id, error: err.message });
    }
  }

  logger.info('Trend enrichment complete', { processed: artifacts.length, enriched, no_match });
  return { processed: artifacts.length, enriched, no_match };
}
