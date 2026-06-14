// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Workflow Embedder — Generates vector embeddings for semantic search.
 *
 * Uses Ollama's embedding API (nomic-embed-text, 768 dimensions) to create
 * dense vector representations of workflows. These are stored in the
 * `embedding` column (pgvector) for cosine similarity search.
 *
 * Pipeline step: runs after scoring, before any semantic search is possible.
 */

import { db } from '../db/client.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const EMBED_DELAY_MS = 500; // Delay between Ollama calls

/**
 * Build the text string that will be embedded for a workflow.
 * Combines all semantically relevant fields into a single string.
 */
function buildEmbeddingText(row) {
  const parts = [
    row.workflow_name || '',
    row.original_description || '',
    row.tool_type || '',
    row.primary_category || '',
    Array.isArray(row.tags) ? row.tags.join(' ') : '',
    Array.isArray(row.node_types) ? row.node_types.join(' ') : '',
    row.language || '',
  ];

  return parts
    .filter(Boolean)
    .join(' ')
    .slice(0, 4000) // Truncate for embedding model context
    .trim();
}

/**
 * Call Ollama's embedding API.
 * Uses /api/embeddings endpoint (matches OllamaEmbeddingProvider in c-suite).
 *
 * @param {string} text - Text to embed
 * @returns {number[]} - 768-dimensional float array
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
 * Generate embeddings for workflows that don't have them yet.
 *
 * @param {number} limit - Maximum workflows to embed per run
 */
export async function embedWorkflows(limit = 100) {
  logger.info(`Embedding up to ${limit} workflows...`);

  const result = await db.query(`
    SELECT id, workflow_name, original_description, tool_type,
           primary_category, tags, node_types, language
    FROM workflows
    WHERE embedded_at IS NULL
    ORDER BY quality_score DESC NULLS LAST
    LIMIT $1
  `, [limit]);

  const rows = result.rows;
  if (rows.length === 0) {
    logger.info('No workflows to embed');
    return { success: 0, failed: 0 };
  }

  logger.info(`Found ${rows.length} workflows to embed`);

  let success = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const text = buildEmbeddingText(row);
      if (!text) {
        logger.warn(`Empty embedding text for workflow ${row.id}, skipping`);
        failed++;
        continue;
      }

      const embedding = await getEmbedding(text);

      if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
        logger.warn(`Invalid embedding for workflow ${row.id}`);
        failed++;
        continue;
      }

      // Store as pgvector format: '[0.1, 0.2, ...]'
      const vectorStr = `[${embedding.join(',')}]`;

      await db.query(
        'UPDATE workflows SET embedding = $1::vector, embedded_at = NOW() WHERE id = $2',
        [vectorStr, row.id],
      );

      success++;

      if (success % 25 === 0) {
        logger.info(`Embedded ${success}/${rows.length} workflows...`);
      }

      // Rate limit to avoid overwhelming Ollama
      await new Promise(resolve => setTimeout(resolve, EMBED_DELAY_MS));

    } catch (err) {
      logger.warn(`Failed to embed workflow ${row.id}: ${err.message}`);
      failed++;
    }
  }

  logger.info(`Embedding complete: ${success} succeeded, ${failed} failed`);
  return { success, failed };
}
