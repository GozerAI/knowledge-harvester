// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Artifact Embedder — Generates vector embeddings for artifacts in the
 * unified artifacts table. Mirrors embedder.js but targets the artifacts table.
 *
 * Uses the same Ollama nomic-embed-text model (768d) for consistent
 * cross-table semantic search compatibility.
 */

import { db } from '../db/client.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const EMBED_DELAY_MS = 500;

/**
 * Build embedding text from an artifact row.
 * Combines all semantically relevant fields.
 */
function buildEmbeddingText(row) {
  const parts = [
    row.name || '',
    row.description || '',
    row.artifact_type || '',
    row.tool_type || '',
    row.primary_category || '',
    Array.isArray(row.tags) ? row.tags.join(' ') : '',
    row.language || '',
  ];

  // Extract searchable content from type_metadata
  const meta = typeof row.type_metadata === 'string'
    ? JSON.parse(row.type_metadata) : (row.type_metadata || {});

  // Include relevant type_metadata fields as additional context
  for (const [key, val] of Object.entries(meta)) {
    if (Array.isArray(val)) {
      parts.push(val.join(' '));
    } else if (typeof val === 'string') {
      parts.push(val);
    }
  }

  return parts
    .filter(Boolean)
    .join(' ')
    .slice(0, 4000)
    .trim();
}

/**
 * Call Ollama's embedding API.
 */
async function getEmbedding(text) {
  const response = await fetch(`${config.ollama.host}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollama.embedModel,
      prompt: text,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Ollama embed failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data.embedding;
}

/**
 * Generate embeddings for artifacts that don't have them yet.
 *
 * @param {number} limit - Maximum artifacts to embed per run
 * @param {string} [artifactType] - Optional filter by artifact_type
 */
export async function embedArtifacts(limit = 100, artifactType = null) {
  const typeFilter = artifactType
    ? 'AND artifact_type = $2'
    : '';
  const params = artifactType ? [limit, artifactType] : [limit];

  const result = await db.query(`
    SELECT id, name, description, artifact_type, tool_type,
           primary_category, tags, language, type_metadata
    FROM artifacts
    WHERE embedded_at IS NULL ${typeFilter}
    ORDER BY quality_score DESC NULLS LAST
    LIMIT $1
  `, params);

  const rows = result.rows;
  if (rows.length === 0) {
    logger.info('No artifacts to embed');
    return { success: 0, failed: 0 };
  }

  logger.info(`Embedding ${rows.length} artifacts`);
  let success = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const text = buildEmbeddingText(row);
      if (!text) {
        failed++;
        continue;
      }

      const embedding = await getEmbedding(text);
      if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
        failed++;
        continue;
      }

      const vectorStr = `[${embedding.join(',')}]`;
      await db.query(
        'UPDATE artifacts SET embedding = $1::vector, embedded_at = NOW() WHERE id = $2',
        [vectorStr, row.id],
      );

      success++;
      if (success % 25 === 0) {
        logger.info(`Embedded ${success}/${rows.length} artifacts...`);
      }

      await new Promise(resolve => setTimeout(resolve, EMBED_DELAY_MS));
    } catch (err) {
      logger.warn(`Failed to embed artifact ${row.id}: ${err.message}`);
      failed++;
    }
  }

  logger.info(`Artifact embedding complete: ${success} succeeded, ${failed} failed`);
  return { success, failed };
}
