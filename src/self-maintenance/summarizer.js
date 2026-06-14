// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #884 — Knowledge Summarization
 *
 * Generates concise summaries for artifacts by extracting key sentences
 * from descriptions and metadata. Supports individual and batch summarization.
 */

const IMPORTANT_TERMS = [
  'provides', 'enables', 'supports', 'includes', 'features',
  'implements', 'automates', 'manages', 'integrates', 'handles',
];

/**
 * Generate a summary for a single artifact.
 * @param {object} artifact
 * @returns {string}
 */
export function generateArtifactSummary(artifact) {
  const desc = artifact.description || '';
  const name = artifact.name || 'Untitled';
  const type = artifact.artifact_type || 'artifact';
  const category = artifact.primary_category || 'uncategorized';

  // Extract sentences and pick the most informative ones
  const sentences = desc.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const keySentences = [];

  // Always include the first sentence (usually the overview)
  if (sentences.length > 0) keySentences.push(sentences[0].trim());

  // Find sentences containing important terms
  for (const s of sentences.slice(1)) {
    if (IMPORTANT_TERMS.some(t => s.toLowerCase().includes(t)) && keySentences.length < 3) {
      keySentences.push(s.trim());
    }
  }

  return keySentences.length > 0
    ? (keySentences.join('. ') + '.').slice(0, 500)
    : `${name} is a ${type} in the ${category} category.`;
}

/**
 * Generate a category summary from its artifacts.
 * @param {string} category
 * @param {object[]} artifacts
 * @returns {object}
 */
export function generateCategorySummary(category, artifacts) {
  const types = {};
  let totalQuality = 0;
  let qualityCount = 0;

  for (const a of artifacts) {
    const t = a.artifact_type || 'unknown';
    types[t] = (types[t] || 0) + 1;
    if (a.quality_score != null) {
      totalQuality += a.quality_score;
      qualityCount++;
    }
  }

  return {
    category,
    artifact_count: artifacts.length,
    type_distribution: types,
    avg_quality: qualityCount > 0 ? Math.round(totalQuality / qualityCount) : null,
    top_artifacts: artifacts
      .sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0))
      .slice(0, 5)
      .map(a => ({ id: a.id, name: a.name, quality: a.quality_score })),
  };
}

/**
 * Batch summarize artifacts.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ summaries: object[], summary: object }>}
 */
export async function batchSummarize(db, options = {}) {
  const limit = options.limit || 200;

  const result = await db.query(
    `SELECT id, name, description, artifact_type, primary_category, quality_score
     FROM artifacts
     WHERE description IS NOT NULL AND length(description) > 20
     ORDER BY quality_score DESC NULLS LAST LIMIT $1`,
    [limit]
  );

  const summaries = result.rows.map(a => ({
    artifact_id: a.id,
    name: a.name,
    summary: generateArtifactSummary(a),
  }));

  return {
    summaries,
    summary: {
      total_summarized: summaries.length,
      summarized_at: new Date().toISOString(),
    },
  };
}

export { IMPORTANT_TERMS };
