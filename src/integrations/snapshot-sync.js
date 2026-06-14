// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Pushes KH snapshot diffs to Trendscope for cross-system awareness.
 */
import { getEventBus } from '../processing/event-bus.js';
import { logger } from '../utils/logger.js';

export function summarizeDiff(diff) {
  if (!diff) return null;
  const additions = Object.keys(diff.additions || {}).length;
  const removals = Object.keys(diff.removals || {}).length;
  const changes = Object.keys(diff.changes || {}).length;

  // Extract top affected categories from changes
  const topCategories = [];
  if (diff.changes) {
    for (const [key, value] of Object.entries(diff.changes)) {
      if (key.includes('category') || key === 'by_category') {
        topCategories.push(key);
      }
    }
  }

  return {
    added_count: additions,
    removed_count: removals,
    changed_count: changes,
    top_categories_affected: topCategories,
    significant: (additions + removals + changes) > 0,
  };
}

export function pushDiffToEventBus(diff) {
  const summary = summarizeDiff(diff);
  if (summary && summary.significant) {
    const bus = getEventBus();
    bus.emit('snapshot.diff', summary);
    return summary;
  }
  return null;
}
