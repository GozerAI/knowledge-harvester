// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #884 — Autonomous Knowledge Summarization
 *
 * Generates concise summaries for artifacts and categories,
 * producing executive overviews and category digests.
 */

/**
 * Summarize a batch of artifacts.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ summarized: number, summary: object }>}
 */
export async function summarizeKnowledge(db, options = {}) {
  const limit = options.limit || 100;

  const result = await db.query(
    `SELECT id, name, description, primary_category, artifact_type,
            tags, quality_score
     FROM artifacts
     WHERE description IS NOT NULL AND length(description) > 100
       AND (type_metadata->>'summary') IS NULL
     ORDER BY quality_score DESC NULLS LAST
     LIMIT $1`,
    [limit]
  );

  let summarized = 0;
  for (const artifact of result.rows) {
    const summary = generateArtifactSummary(artifact);
    try {
      await db.query(
        `UPDATE artifacts
         SET type_metadata = COALESCE(type_metadata, '{}'::jsonb) || jsonb_build_object('summary', $1)
         WHERE id = $2`,
        [summary, artifact.id]
      );
      summarized++;
    } catch {
      continue;
    }
  }

  return {
    summarized,
    summary: {
      scanned: result.rows.length,
      summarized,
      summarized_at: new Date().toISOString(),
    },
  };
}

/**
 * Generate a summary for a single artifact.
 */
export function generateArtifactSummary(artifact) {
  const desc = artifact.description || '';
  const name = artifact.name || 'Untitled';
  const type = artifact.artifact_type || 'artifact';
  const category = artifact.primary_category || 'uncategorized';

  // Extract key sentences (first sentence + any sentence with key terms)
  const sentences = desc.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const keySentences = [];

  if (sentences.length > 0) {
    keySentences.push(sentences[0].trim());
  }

  // Find sentences with important keywords
  const importantTerms = ['provides', 'enables', 'supports', 'includes', 'features', 'implements'];
  for (const s of sentences.slice(1)) {
    const lower = s.toLowerCase();
    if (importantTerms.some(t => lower.includes(t)) && keySentences.length < 3) {
      keySentences.push(s.trim());
    }
  }

  const summaryText = keySentences.length > 0
    ? keySentences.join('. ') + '.'
    : `${name} is a ${type} in the ${category} category.`;

  return summaryText.slice(0, 500);
}

/**
 * Generate a category digest.
 * @param {object} db
 * @param {string} category
 * @returns {Promise<object>}
 */
export async function generateCategoryDigest(db, category) {
  const result = await db.query(
    `SELECT name, artifact_type, quality_score, description
     FROM artifacts
     WHERE primary_category = $1
     ORDER BY quality_score DESC NULLS LAST
     LIMIT 20`,
    [category]
  );

  const types = new Set(result.rows.map(r => r.artifact_type));
  const avgQuality = result.rows.length > 0
    ? Math.round(result.rows.reduce((s, r) => s + (r.quality_score || 0), 0) / result.rows.length)
    : 0;

  const topItems = result.rows.slice(0, 5).map(r => r.name);

  return {
    category,
    total_artifacts: result.rows.length,
    artifact_types: [...types],
    avg_quality: avgQuality,
    top_items: topItems,
    digest: `The "${category}" category contains ${result.rows.length} artifacts across ${types.size} types with an average quality score of ${avgQuality}. Top items include: ${topItems.join(', ')}.`,
    generated_at: new Date().toISOString(),
  };
}
