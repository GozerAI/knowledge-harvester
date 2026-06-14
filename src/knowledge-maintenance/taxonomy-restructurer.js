// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #870 — Autonomous Taxonomy Restructuring
 *
 * Restructures the taxonomy by analyzing category health, merging sparse
 * categories, splitting bloated ones, and maintaining hierarchy consistency.
 */

/**
 * Analyze and propose taxonomy restructuring.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ actions: object[], summary: object }>}
 */
export async function restructureTaxonomy(db, options = {}) {
  const maxCategorySize = options.maxCategorySize || 200;
  const minCategorySize = options.minCategorySize || 3;

  const stats = await getCategoryStats(db);
  const actions = [];

  // Find categories to split
  for (const cat of stats.filter(s => s.count > maxCategorySize)) {
    actions.push({
      action: 'split',
      category: cat.primary_category,
      reason: `${cat.count} artifacts exceeds max ${maxCategorySize}`,
      priority: 'high',
    });
  }

  // Find categories to merge
  const small = stats.filter(s => s.count < minCategorySize && s.count > 0);
  for (let i = 0; i < small.length; i++) {
    for (let j = i + 1; j < small.length; j++) {
      if (areSimilarCategories(small[i].primary_category, small[j].primary_category)) {
        actions.push({
          action: 'merge',
          categories: [small[i].primary_category, small[j].primary_category],
          reason: `Both have fewer than ${minCategorySize} artifacts and are similar`,
          priority: 'medium',
        });
      }
    }
  }

  // Find empty categories
  const empty = stats.filter(s => s.count === 0);
  for (const cat of empty) {
    actions.push({
      action: 'remove',
      category: cat.primary_category,
      reason: 'Category has no artifacts',
      priority: 'low',
    });
  }

  return {
    actions,
    summary: {
      total_categories: stats.length,
      proposed_actions: actions.length,
      splits: actions.filter(a => a.action === 'split').length,
      merges: actions.filter(a => a.action === 'merge').length,
      removals: actions.filter(a => a.action === 'remove').length,
      analyzed_at: new Date().toISOString(),
    },
  };
}

async function getCategoryStats(db) {
  const result = await db.query(
    `SELECT primary_category, COUNT(*)::int AS count,
            ROUND(AVG(quality_score)::numeric, 2)::float AS avg_quality
     FROM artifacts
     WHERE primary_category IS NOT NULL
     GROUP BY primary_category
     ORDER BY count DESC`
  );
  return result.rows;
}

function areSimilarCategories(a, b) {
  const na = a.toLowerCase().replace(/[\s\-_]+/g, '');
  const nb = b.toLowerCase().replace(/[\s\-_]+/g, '');
  if (na.includes(nb) || nb.includes(na)) return true;
  // Check word overlap
  const wa = new Set(a.toLowerCase().split(/[\s\-_]+/));
  const wb = new Set(b.toLowerCase().split(/[\s\-_]+/));
  let overlap = 0;
  for (const w of wa) { if (wb.has(w)) overlap++; }
  return overlap > 0 && overlap >= Math.min(wa.size, wb.size) * 0.5;
}

export { areSimilarCategories };
