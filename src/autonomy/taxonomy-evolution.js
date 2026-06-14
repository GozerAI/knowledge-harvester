// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #701 — Autonomous Taxonomy Evolution
 *
 * Monitors category distributions, detects emerging topics, proposes
 * taxonomy splits/merges, and tracks taxonomy changes over time.
 */

const SPLIT_THRESHOLD = 100;  // Split category if it has > N artifacts
const MERGE_THRESHOLD = 3;    // Merge if category has < N artifacts
const OVERLAP_THRESHOLD = 0.6; // Merge if > 60% content overlap

/**
 * @typedef {object} TaxonomyProposal
 * @property {string} action - 'split' | 'merge' | 'rename' | 'create'
 * @property {string[]} categories
 * @property {string} reason
 * @property {number} confidence
 * @property {object} evidence
 */

/**
 * Analyze the current taxonomy and generate evolution proposals.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ proposals: TaxonomyProposal[], taxonomy_stats: object }>}
 */
export async function analyzeTaxonomy(db, options = {}) {
  const splitThreshold = options.splitThreshold ?? SPLIT_THRESHOLD;
  const mergeThreshold = options.mergeThreshold ?? MERGE_THRESHOLD;

  const distribution = await getCategoryDistribution(db);
  const proposals = [];

  // Detect oversized categories that should be split
  const splitCandidates = distribution.filter(d => d.count > splitThreshold);
  for (const cat of splitCandidates) {
    const subclusters = await detectSubclusters(db, cat.primary_category);
    if (subclusters.length >= 2) {
      proposals.push({
        action: 'split',
        categories: [cat.primary_category],
        reason: `Category "${cat.primary_category}" has ${cat.count} artifacts with ${subclusters.length} distinct subclusters`,
        confidence: Math.min(0.5 + (subclusters.length - 1) * 0.1, 0.95),
        evidence: { count: cat.count, subclusters: subclusters.map(s => s.label) },
      });
    }
  }

  // Detect undersized categories that should be merged
  const smallCats = distribution.filter(d => d.count < mergeThreshold && d.count > 0);
  const mergePairs = findMergeCandidates(smallCats);
  for (const pair of mergePairs) {
    proposals.push({
      action: 'merge',
      categories: pair.categories,
      reason: `Categories ${pair.categories.map(c => `"${c}"`).join(' and ')} both have fewer than ${mergeThreshold} artifacts`,
      confidence: pair.similarity,
      evidence: { counts: pair.counts },
    });
  }

  // Detect emerging topics from recent artifacts
  const emerging = await detectEmergingTopics(db);
  for (const topic of emerging) {
    const exists = distribution.some(d => d.primary_category === topic.name);
    if (!exists) {
      proposals.push({
        action: 'create',
        categories: [topic.name],
        reason: `Emerging topic "${topic.name}" detected from ${topic.artifact_count} recent artifacts`,
        confidence: topic.confidence,
        evidence: { artifact_count: topic.artifact_count, keywords: topic.keywords },
      });
    }
  }

  proposals.sort((a, b) => b.confidence - a.confidence);

  return {
    proposals,
    taxonomy_stats: {
      total_categories: distribution.length,
      total_artifacts: distribution.reduce((s, d) => s + d.count, 0),
      largest_category: distribution[0]?.primary_category || null,
      smallest_category: distribution[distribution.length - 1]?.primary_category || null,
      proposal_count: proposals.length,
      analyzed_at: new Date().toISOString(),
    },
  };
}

/**
 * Get category distribution with counts and quality.
 */
async function getCategoryDistribution(db) {
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

/**
 * Detect subclusters within a category based on name/tag patterns.
 */
async function detectSubclusters(db, category) {
  const result = await db.query(
    `SELECT name, tags FROM artifacts
     WHERE primary_category = $1
     ORDER BY quality_score DESC NULLS LAST
     LIMIT 200`,
    [category]
  );

  // Simple word frequency clustering
  const wordCounts = {};
  for (const row of result.rows) {
    const words = extractKeywords(row.name, row.tags);
    for (const w of words) {
      wordCounts[w] = (wordCounts[w] || 0) + 1;
    }
  }

  // Find dominant theme words (appear in >20% of artifacts)
  const threshold = Math.max(result.rows.length * 0.2, 2);
  const themes = Object.entries(wordCounts)
    .filter(([, cnt]) => cnt >= threshold)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return themes.map(([word, count]) => ({
    label: word,
    count,
    fraction: count / result.rows.length,
  }));
}

/**
 * Extract keywords from artifact name and tags.
 */
function extractKeywords(name, tags) {
  const words = new Set();
  if (name) {
    for (const w of name.toLowerCase().split(/[\s\-_/]+/)) {
      if (w.length > 3) words.add(w);
    }
  }
  if (Array.isArray(tags)) {
    for (const t of tags) {
      if (typeof t === 'string' && t.length > 2) words.add(t.toLowerCase());
    }
  }
  return [...words];
}

/**
 * Find pairs of small categories that could be merged.
 */
function findMergeCandidates(smallCats) {
  const pairs = [];
  for (let i = 0; i < smallCats.length; i++) {
    for (let j = i + 1; j < smallCats.length; j++) {
      const a = smallCats[i].primary_category;
      const b = smallCats[j].primary_category;
      const sim = nameSimilarity(a, b);
      if (sim > 0.3) {
        pairs.push({
          categories: [a, b],
          similarity: sim,
          counts: [smallCats[i].count, smallCats[j].count],
        });
      }
    }
  }
  pairs.sort((a, b) => b.similarity - a.similarity);
  return pairs;
}

/**
 * Simple name similarity (Jaccard on character trigrams).
 */
function nameSimilarity(a, b) {
  const triA = trigrams(a.toLowerCase());
  const triB = trigrams(b.toLowerCase());
  const intersection = triA.filter(t => triB.includes(t)).length;
  const union = new Set([...triA, ...triB]).size;
  return union === 0 ? 0 : intersection / union;
}

function trigrams(s) {
  const t = [];
  for (let i = 0; i <= s.length - 3; i++) {
    t.push(s.slice(i, i + 3));
  }
  return t;
}

/**
 * Detect emerging topics from recently added artifacts.
 */
async function detectEmergingTopics(db) {
  const result = await db.query(
    `SELECT name, tags, primary_category FROM artifacts
     WHERE created_at > NOW() - INTERVAL '30 days'
       AND primary_category IS NULL
     ORDER BY created_at DESC
     LIMIT 100`
  );

  if (result.rows.length === 0) return [];

  // Frequency analysis of uncategorized artifact keywords
  const wordCounts = {};
  for (const row of result.rows) {
    const words = extractKeywords(row.name, row.tags);
    for (const w of words) {
      wordCounts[w] = (wordCounts[w] || 0) + 1;
    }
  }

  const threshold = Math.max(result.rows.length * 0.15, 3);
  return Object.entries(wordCounts)
    .filter(([, cnt]) => cnt >= threshold)
    .map(([word, count]) => ({
      name: word,
      artifact_count: count,
      confidence: Math.min(count / result.rows.length, 0.95),
      keywords: [word],
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
}

/**
 * Apply a taxonomy proposal (merge or rename).
 * @param {object} db
 * @param {TaxonomyProposal} proposal
 * @returns {Promise<{ applied: boolean, affected: number }>}
 */
export async function applyProposal(db, proposal) {
  if (proposal.action === 'merge' && proposal.categories.length >= 2) {
    const target = proposal.categories[0];
    let affected = 0;
    for (let i = 1; i < proposal.categories.length; i++) {
      const result = await db.query(
        `UPDATE artifacts SET primary_category = $1 WHERE primary_category = $2`,
        [target, proposal.categories[i]]
      );
      affected += result.rowCount || 0;
    }
    return { applied: true, affected };
  }
  return { applied: false, affected: 0 };
}

// Export internals for testing
export { extractKeywords, nameSimilarity, findMergeCandidates, getCategoryDistribution };
