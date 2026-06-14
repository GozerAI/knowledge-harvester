// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { config } from '../config.js';
import { db } from '../db/client.js';
import { json } from './middleware.js';

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 50;

export function extractSearchParams(params) {
  const q = params.get('q') || '';
  const rawLimit = parseInt(params.get('limit') || String(DEFAULT_LIMIT), 10);
  const limit = Math.min(isNaN(rawLimit) || rawLimit < 1 ? DEFAULT_LIMIT : rawLimit, MAX_LIMIT);
  return { q, limit };
}

export function validateSearchQuery(q) {
  if (!q || typeof q !== 'string' || q.trim().length === 0) {
    return { valid: false, error: 'Query parameter "q" is required and must not be empty' };
  }

  return { valid: true, error: null };
}

export function buildVectorQuery(limit) {
  return {
    sql: `
      SELECT id, name, artifact_type, primary_category, tags, quality_score,
             1 - (embedding <=> $1::vector) AS score
      FROM artifacts
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector
      LIMIT $2
    `.trim(),
    params: ['<embedding_vector>', limit],
  };
}

export function formatSearchResults(rows) {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    artifact_type: row.artifact_type,
    primary_category: row.primary_category || null,
    tags: row.tags || [],
    quality_score: row.quality_score,
    score: typeof row.score === 'number'
      ? Math.round(row.score * 10000) / 10000
      : row.score,
  }));
}

export async function getQueryEmbedding(
  q,
  {
    fetchImpl = fetch,
    host = config.ollama.host,
    model = config.ollama.embedModel,
  } = {},
) {
  const response = await fetchImpl(`${host}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: q,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama embed failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  if (!Array.isArray(data.embedding) || data.embedding.length === 0) {
    throw new Error('Ollama embed returned an invalid embedding');
  }

  return data.embedding;
}

export function createSemanticSearchHandler({
  database = db,
  fetchImpl = fetch,
  host = config.ollama.host,
  model = config.ollama.embedModel,
} = {}) {
  return async function handleSemanticSearch(_req, res, params) {
    const { q, limit } = extractSearchParams(params);
    const validation = validateSearchQuery(q);
    if (!validation.valid) {
      return json(res, 400, { error: validation.error });
    }

    try {
      const embedding = await getQueryEmbedding(q.trim(), { fetchImpl, host, model });
      const vector = `[${embedding.join(',')}]`;
      const { sql } = buildVectorQuery(limit);
      const result = await database.query(sql, [vector, limit]);

      return json(res, 200, {
        query: q,
        results: formatSearchResults(result.rows),
      });
    } catch (err) {
      return json(res, 502, { error: err.message });
    }
  };
}

export const handleSemanticSearch = createSemanticSearchHandler();
