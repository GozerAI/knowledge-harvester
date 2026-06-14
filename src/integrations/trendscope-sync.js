// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Cross-System Intelligence Sync — Trendscope ↔ KH integration.
 *
 * Fetches anomalies and coverage from Trendscope, cross-references
 * with KH coverage gaps to produce prioritized harvest recommendations.
 */

import { getAnomalies, getCoverage } from './trendscope-client.js';
import { identifyGaps } from '../processing/coverage-analyzer.js';
import { scanForStale } from '../processing/auto-refresh.js';
import { logger } from '../utils/logger.js';

/**
 * Sync intelligence from Trendscope.
 * Fetches anomalies + blind spots and cross-references with KH gaps.
 * @param {object} db
 * @returns {Promise<object>}
 */
export async function syncFromTrendscope(db) {
  let anomalies = null;
  let blindSpots = null;

  try {
    anomalies = await getAnomalies();
  } catch {
    logger.debug('Trendscope anomalies unavailable');
  }

  try {
    blindSpots = await getCoverage();
  } catch {
    logger.debug('Trendscope coverage unavailable');
  }

  // Get KH coverage gaps
  const khGaps = await identifyGaps(db);

  // Cross-reference: find recommendations from TS anomalies that match KH gaps
  const recommendations = [];

  if (anomalies && Array.isArray(anomalies)) {
    for (const anomaly of anomalies) {
      const matchingGap = khGaps.find(g =>
        g.primary_category === anomaly.category ||
        g.artifact_type === anomaly.type
      );
      if (matchingGap) {
        recommendations.push({
          source: 'trendscope_anomaly',
          category: anomaly.category || matchingGap.primary_category,
          type: anomaly.type || matchingGap.artifact_type,
          reason: anomaly.description || 'Anomaly detected in Trendscope',
          priority: 'high',
        });
      }
    }
  }

  if (blindSpots && Array.isArray(blindSpots)) {
    for (const spot of blindSpots) {
      recommendations.push({
        source: 'trendscope_blind_spot',
        category: spot.category,
        type: spot.type || 'unknown',
        reason: spot.reason || 'Blind spot detected',
        priority: 'medium',
      });
    }
  }

  // Add KH-only gaps not covered by TS
  for (const gap of khGaps) {
    const alreadyRecommended = recommendations.some(
      r => r.category === gap.primary_category && r.type === gap.artifact_type
    );
    if (!alreadyRecommended) {
      recommendations.push({
        source: 'kh_coverage_gap',
        category: gap.primary_category,
        type: gap.artifact_type,
        reason: `Only ${gap.count} artifacts (below threshold)`,
        priority: 'low',
      });
    }
  }

  return {
    trendscope_available: anomalies !== null || blindSpots !== null,
    anomaly_count: anomalies?.length || 0,
    blind_spot_count: blindSpots?.length || 0,
    kh_gap_count: khGaps.length,
    recommendations,
  };
}

/**
 * Get smart harvest targets combining decay, TS anomalies, and coverage gaps.
 * @param {object} db
 * @returns {Promise<Array>}
 */
export async function getSmartHarvestTargets(db) {
  const targets = [];

  // 1. Stale artifacts (high priority)
  try {
    const stale = await scanForStale(db, 0.6, 20);
    for (const a of stale) {
      targets.push({
        source: 'decay',
        artifact_id: a.id,
        name: a.name,
        priority: 'high',
        reason: 'High decay risk',
      });
    }
  } catch {
    // best-effort
  }

  // 2. Trendscope sync
  try {
    const syncResult = await syncFromTrendscope(db);
    for (const rec of syncResult.recommendations) {
      targets.push({
        source: rec.source,
        category: rec.category,
        type: rec.type,
        priority: rec.priority,
        reason: rec.reason,
      });
    }
  } catch {
    // best-effort
  }

  // Sort by priority: high > medium > low
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  targets.sort((a, b) => (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2));

  return targets;
}
