// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Relation Builder — Discovers and stores relationships between artifacts.
 *
 * Analyzes artifacts using four complementary strategies:
 *   1. Tag overlap (≥3 shared tags → 'similar_to')
 *   2. Same primary_category + different artifact_type → 'pairs_with'
 *   3. Embedding cosine similarity >0.85 → 'similar_to' (pgvector)
 *   4. Shared tool_type or dependencies in type_metadata → 'uses'
 *
 * Results are written to artifact_relations with ON CONFLICT DO NOTHING so
 * re-runs are safe and idempotent.
 */

import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';

// Minimum shared tags required to create a 'similar_to' relation via tag overlap.
const TAG_OVERLAP_THRESHOLD = 3;

// Minimum cosine similarity score (pgvector) to create a 'similar_to' relation.
const EMBEDDING_SIM_THRESHOLD = 0.85;

// ── Pure helper functions (also exported for testing) ─────────────────────────

/**
 * Calculate the overlap between two tag arrays.
 *
 * @param {string[]} tagsA
 * @param {string[]} tagsB
 * @returns {{ overlap_count: number, overlap_ratio: number }}
 */
export function calculateTagOverlap(tagsA, tagsB) {
  if (!Array.isArray(tagsA) || !Array.isArray(tagsB) || tagsA.length === 0 || tagsB.length === 0) {
    return { overlap_count: 0, overlap_ratio: 0 };
  }

  const setA = new Set(tagsA);
  let overlap_count = 0;
  for (const tag of tagsB) {
    if (setA.has(tag)) overlap_count++;
  }

  // Ratio over the union size — a Jaccard-style measure
  const union = new Set([...tagsA, ...tagsB]).size;
  const overlap_ratio = union === 0 ? 0 : overlap_count / union;

  return { overlap_count, overlap_ratio };
}

/**
 * Determine whether two artifacts should be related and, if so, how.
 *
 * Only evaluates tag-overlap and category-pairing strategies (the ones that
 * don't require a live database). Embedding similarity is handled separately
 * via a pgvector query because it needs the DB.
 *
 * @param {object} artifactA
 * @param {object} artifactB
 * @returns {{ relate: boolean, relation_type: string|null, confidence: number }}
 */
export function shouldRelate(artifactA, artifactB) {
  if (!artifactA || !artifactB || artifactA.id === artifactB.id) {
    return { relate: false, relation_type: null, confidence: 0 };
  }

  // Strategy 1: tag overlap
  const { overlap_count, overlap_ratio } = calculateTagOverlap(
    artifactA.tags || [],
    artifactB.tags || [],
  );
  if (overlap_count >= TAG_OVERLAP_THRESHOLD) {
    return {
      relate: true,
      relation_type: 'similar_to',
      confidence: Math.min(0.95, 0.5 + overlap_ratio * 0.5),
    };
  }

  // Strategy 2: same primary_category, different artifact_type → pairs_with
  if (
    artifactA.primary_category &&
    artifactB.primary_category &&
    artifactA.primary_category === artifactB.primary_category &&
    artifactA.artifact_type !== artifactB.artifact_type
  ) {
    return { relate: true, relation_type: 'pairs_with', confidence: 0.6 };
  }

  // Strategy 4: shared tool_type (non-null) → 'uses'
  if (
    artifactA.tool_type &&
    artifactB.tool_type &&
    artifactA.tool_type === artifactB.tool_type &&
    artifactA.artifact_type !== artifactB.artifact_type
  ) {
    return { relate: true, relation_type: 'uses', confidence: 0.5 };
  }

  return { relate: false, relation_type: null, confidence: 0 };
}

/**
 * Check whether two type_metadata objects share any dependency strings.
 *
 * @param {object} metaA
 * @param {object} metaB
 * @returns {boolean}
 */
function sharedDependencies(metaA, metaB) {
  const depsA = metaA?.dependencies;
  const depsB = metaB?.dependencies;
  if (!Array.isArray(depsA) || !Array.isArray(depsB)) return false;
  const setA = new Set(depsA);
  return depsB.some(d => setA.has(d));
}

// ── DB-backed main export ─────────────────────────────────────────────────────

/**
 * Build artifact_relations entries for a batch of artifacts.
 *
 * Runs three in-process strategies (tag, category, tool/deps) plus one
 * pgvector cosine-similarity query for embedding-based relations.
 *
 * @param {object} dbClient - db client (pool wrapper with .query())
 * @param {number} [limit=200] - Maximum number of artifacts to process
 * @returns {Promise<{ processed: number, relations_created: number }>}
 */
export async function buildRelations(dbClient, limit = 200) {
  logger.info('Building artifact relations', { limit });

  // Fetch artifacts with all fields needed for relation strategies.
  const result = await dbClient.query(
    `SELECT id, artifact_type, primary_category, tags, tool_type, type_metadata, embedding
     FROM artifacts
     WHERE primary_category IS NOT NULL
     ORDER BY quality_score DESC
     LIMIT $1`,
    [limit],
  );

  const artifacts = result.rows;

  if (artifacts.length === 0) {
    logger.info('No artifacts available for relation building');
    return { processed: 0, relations_created: 0 };
  }

  logger.info(`Processing ${artifacts.length} artifacts for relations`);

  let relations_created = 0;

  // ── In-process strategies: tag overlap, category pairing, tool/dep sharing ──

  for (let i = 0; i < artifacts.length; i++) {
    const a = artifacts[i];

    for (let j = i + 1; j < artifacts.length; j++) {
      const b = artifacts[j];

      // Tag overlap (strategy 1)
      const { overlap_count, overlap_ratio } = calculateTagOverlap(
        a.tags || [],
        b.tags || [],
      );
      if (overlap_count >= TAG_OVERLAP_THRESHOLD) {
        const confidence = Math.min(0.95, 0.5 + overlap_ratio * 0.5);
        const inserted = await insertRelation(dbClient, a.id, b.id, 'similar_to', confidence, {
          strategy: 'tag_overlap',
          overlap_count,
          overlap_ratio,
        });
        if (inserted) relations_created++;
        continue; // strongest signal for this pair — skip further checks
      }

      // Category pairing (strategy 2)
      if (
        a.primary_category &&
        b.primary_category &&
        a.primary_category === b.primary_category &&
        a.artifact_type !== b.artifact_type
      ) {
        const inserted = await insertRelation(dbClient, a.id, b.id, 'pairs_with', 0.6, {
          strategy: 'category_pairing',
          category: a.primary_category,
        });
        if (inserted) relations_created++;
        continue;
      }

      // Shared tool_type (strategy 4a)
      if (
        a.tool_type &&
        b.tool_type &&
        a.tool_type === b.tool_type &&
        a.artifact_type !== b.artifact_type
      ) {
        const inserted = await insertRelation(dbClient, a.id, b.id, 'uses', 0.5, {
          strategy: 'shared_tool_type',
          tool_type: a.tool_type,
        });
        if (inserted) relations_created++;
        continue;
      }

      // Shared dependencies in type_metadata (strategy 4b)
      if (sharedDependencies(a.type_metadata, b.type_metadata)) {
        const inserted = await insertRelation(dbClient, a.id, b.id, 'uses', 0.5, {
          strategy: 'shared_dependencies',
        });
        if (inserted) relations_created++;
      }
    }
  }

  // ── pgvector cosine similarity (strategy 3) ──

  // For each artifact that has an embedding, find near-neighbours via pgvector.
  // We run this as a separate pass so we don't mix DB calls into the inner loop.
  const embedded = artifacts.filter(a => a.embedding !== null);
  logger.debug(`Running embedding similarity for ${embedded.length} artifacts`);

  for (const a of embedded) {
    try {
      const simResult = await dbClient.query(
        `SELECT id, 1 - (embedding <=> (
           SELECT embedding FROM artifacts WHERE id = $1
         )) AS similarity
         FROM artifacts
         WHERE id != $1
           AND embedding IS NOT NULL
           AND 1 - (embedding <=> (
             SELECT embedding FROM artifacts WHERE id = $1
           )) > $2
         ORDER BY similarity DESC
         LIMIT 20`,
        [a.id, EMBEDDING_SIM_THRESHOLD],
      );

      for (const row of simResult.rows) {
        const confidence = Math.min(0.99, parseFloat(row.similarity));
        const inserted = await insertRelation(dbClient, a.id, row.id, 'similar_to', confidence, {
          strategy: 'embedding_similarity',
          cosine_similarity: confidence,
        });
        if (inserted) relations_created++;
      }
    } catch (err) {
      logger.warn('Embedding similarity query failed', { id: a.id, error: err.message });
    }
  }

  logger.info('Relation building complete', {
    processed: artifacts.length,
    relations_created,
  });

  return { processed: artifacts.length, relations_created };
}

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Insert a relation row. Returns true if a new row was created, false if it
 * already existed (ON CONFLICT DO NOTHING).
 *
 * @param {object} dbClient
 * @param {string} sourceId
 * @param {string} targetId
 * @param {string} relationType
 * @param {number} confidence
 * @param {object} metadata
 * @returns {Promise<boolean>}
 */
async function insertRelation(dbClient, sourceId, targetId, relationType, confidence, metadata = {}) {
  const result = await dbClient.query(
    `INSERT INTO artifact_relations (source_id, target_id, relation_type, confidence, metadata)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING`,
    [sourceId, targetId, relationType, confidence, JSON.stringify(metadata)],
  );
  return (result.rowCount || 0) > 0;
}
