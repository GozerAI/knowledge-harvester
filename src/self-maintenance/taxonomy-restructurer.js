// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #870 — Taxonomy Restructuring Based on Usage
 *
 * Analyzes category usage patterns and restructures taxonomy by detecting
 * similar categories, proposing merges/splits, and tracking category health.
 */

/**
 * Check if two category names are similar enough to merge.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function areSimilarCategories(a, b) {
  const na = a.toLowerCase().replace(/[\s\-_]+/g, '');
  const nb = b.toLowerCase().replace(/[\s\-_]+/g, '');
  if (na.includes(nb) || nb.includes(na)) return true;
  const wa = new Set(a.toLowerCase().split(/[\s\-_]+/));
  const wb = new Set(b.toLowerCase().split(/[\s\-_]+/));
  let overlap = 0;
  for (const w of wa) { if (wb.has(w)) overlap++; }
  return overlap > 0 && overlap >= Math.min(wa.size, wb.size) * 0.5;
}

/**
 * Analyze taxonomy and propose restructuring.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ proposals: object[], stats: object }>}
 */
export async function analyzeTaxonomyUsage(db, options = {}) {
  const mergeThreshold = options.mergeThreshold || 5;
  const splitThreshold = options.splitThreshold || 200;

  const categories = await getCategoryStats(db);
  const proposals = [];

  // Find merge candidates (small + similar)
  const small = categories.filter(c => c.count < mergeThreshold);
  for (let i = 0; i < small.length; i++) {
    for (let j = i + 1; j < small.length; j++) {
      if (areSimilarCategories(small[i].primary_category, small[j].primary_category)) {
        proposals.push({
          action: 'merge',
          categories: [small[i].primary_category, small[j].primary_category],
          counts: [small[i].count, small[j].count],
          reason: `Similar categories with low artifact counts`,
        });
      }
    }
  }

  // Find split candidates (oversized)
  const large = categories.filter(c => c.count > splitThreshold);
  for (const cat of large) {
    proposals.push({
      action: 'split',
      categories: [cat.primary_category],
      counts: [cat.count],
      reason: `Category has ${cat.count} artifacts, exceeding split threshold of ${splitThreshold}`,
    });
  }

  // Find empty/orphan categories
  const empty = categories.filter(c => c.count === 0);
  for (const cat of empty) {
    proposals.push({
      action: 'remove',
      categories: [cat.primary_category],
      counts: [0],
      reason: 'Empty category with no artifacts',
    });
  }

  return {
    proposals,
    stats: {
      total_categories: categories.length,
      total_artifacts: categories.reduce((s, c) => s + c.count, 0),
      proposal_count: proposals.length,
      analyzed_at: new Date().toISOString(),
    },
  };
}

async function getCategoryStats(db) {
  const result = await db.query(
    `SELECT primary_category, COUNT(*)::int AS count,
            ROUND(AVG(quality_score)::numeric, 2)::float AS avg_quality
     FROM artifacts WHERE primary_category IS NOT NULL
     GROUP BY primary_category ORDER BY count DESC`
  );
  return result.rows;
}

/**
 * Apply a merge proposal.
 * @param {object} db
 * @param {string} targetCategory
 * @param {string[]} sourceCategories
 * @returns {Promise<{ affected: number }>}
 */
export async function applyMerge(db, targetCategory, sourceCategories) {
  let affected = 0;
  for (const src of sourceCategories) {
    if (src === targetCategory) continue;
    const result = await db.query(
      `UPDATE artifacts SET primary_category = $1 WHERE primary_category = $2`,
      [targetCategory, src]
    );
    affected += result.rowCount || 0;
  }
  return { affected };
}
