// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * CRUD route handlers for artifacts.
 *
 * All handlers follow the (req, res, params, id?) signature used by server.js.
 * DB access uses the shared pool client. Body reads are async (streaming chunks).
 */

import { db } from '../db/client.js';
import { validateUUID, validateBody, parsePagination, parseFilters, json } from './middleware.js';

// ── Body reader ──────────────────────────────────────────────────────────────

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

// ── Allowed update fields (never allow id, hash, discovered_at, source_id) ──

const UPDATABLE_FIELDS = new Set([
  'name', 'description', 'artifact_type', 'source', 'source_url',
  'language', 'tool_type', 'tool_metadata', 'tags', 'type_metadata',
  'primary_category', 'secondary_categories', 'quality_score',
  'complexity_score', 'has_description', 'has_documentation',
  'is_complete', 'validation_status', 'publishing_status',
  'marketplace_metadata', 'content',
]);

// ── Handlers ─────────────────────────────────────────────────────────────────

/**
 * GET /api/artifacts
 * Supports pagination, filtering, and full-text search.
 */
export async function handleListArtifacts(req, res, params) {
  const { limit, offset } = parsePagination(params);
  const filters = parseFilters(params, ['artifact_type', 'primary_category', 'tool_type', 'language', 'publishing_status']);

  const conditions = [];
  const values = [];
  let idx = 1;

  // Structured filters
  for (const [field, value] of Object.entries(filters)) {
    conditions.push(`${field} = $${idx}`);
    values.push(value);
    idx++;
  }

  // quality_min filter
  const qualityMin = parseInt(params.get('quality_min') || '0', 10);
  if (!isNaN(qualityMin) && qualityMin > 0) {
    conditions.push(`quality_score >= $${idx}`);
    values.push(qualityMin);
    idx++;
  }

  // tags filter (ANY overlap)
  const tagsParam = params.get('tags');
  if (tagsParam) {
    const tagList = tagsParam.split(',').map(t => t.trim()).filter(Boolean);
    if (tagList.length > 0) {
      conditions.push(`tags && $${idx}`);
      values.push(tagList);
      idx++;
    }
  }

  // Full-text search
  const q = params.get('search') || params.get('q') || '';
  if (q) {
    conditions.push(`search_vector @@ plainto_tsquery('english', $${idx})`);
    values.push(q);
    idx++;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await db.query(
    `SELECT COUNT(*) as count FROM artifacts ${where}`,
    values
  );

  const result = await db.query(
    `SELECT id, artifact_type, name, description, source, source_url,
            language, tool_type, tags, primary_category, secondary_categories,
            quality_score, complexity_score, has_description, has_documentation,
            is_complete, validation_status, publishing_status,
            discovered_at, updated_at
     FROM artifacts ${where}
     ORDER BY quality_score DESC, discovered_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...values, limit, offset]
  );

  json(res, 200, {
    total: parseInt(countResult.rows[0].count, 10),
    limit,
    offset,
    artifacts: result.rows,
  });
}

/**
 * GET /api/artifacts/:id
 */
export async function handleGetArtifact(req, res, params, id) {
  if (!validateUUID(id)) {
    return json(res, 400, { error: 'Invalid artifact ID format' });
  }

  const result = await db.query(
    `SELECT id, hash, artifact_type, source, source_url, source_id,
            name, description, author_username, author_profile_url,
            language, tool_type, tool_metadata, tags, type_metadata,
            content, primary_category, secondary_categories,
            quality_score, complexity_score, complexity_breakdown,
            has_description, has_documentation, is_complete,
            validation_status, publishing_status, price_tier,
            marketplace_metadata, discovered_at, updated_at,
            enriched_at, published_at
     FROM artifacts WHERE id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    return json(res, 404, { error: 'Artifact not found' });
  }

  json(res, 200, result.rows[0]);
}

/**
 * POST /api/artifacts
 */
export async function handleCreateArtifact(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' });
  }

  const { valid, errors } = validateBody(body, ['artifact_type', 'name', 'content']);
  if (!valid) {
    return json(res, 400, { error: 'Validation failed', errors });
  }

  const result = await db.query(
    `INSERT INTO artifacts (
       artifact_type, name, description, source, source_url, source_id,
       content, language, tool_type, tool_metadata, tags,
       type_metadata, quality_score, has_description, has_documentation,
       is_complete, validation_status, publishing_status, marketplace_metadata
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10, $11,
       $12, $13, $14, $15,
       $16, $17, $18, $19
     )
     RETURNING *`,
    [
      body.artifact_type,
      body.name,
      body.description || '',
      body.source || 'api',
      body.source_url || '',
      body.source_id || '',
      JSON.stringify(body.content),
      body.language || null,
      body.tool_type || null,
      JSON.stringify(body.tool_metadata || {}),
      body.tags || [],
      JSON.stringify(body.type_metadata || {}),
      body.quality_score || 0,
      body.has_description || false,
      body.has_documentation || false,
      body.is_complete !== undefined ? body.is_complete : true,
      body.validation_status || 'untested',
      body.publishing_status || 'raw',
      JSON.stringify(body.marketplace_metadata || {}),
    ]
  );

  json(res, 201, result.rows[0]);
}

/**
 * PUT /api/artifacts/:id
 */
export async function handleUpdateArtifact(req, res, params, id) {
  if (!validateUUID(id)) {
    return json(res, 400, { error: 'Invalid artifact ID format' });
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' });
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json(res, 400, { error: 'Request body must be a JSON object' });
  }

  // Collect only updatable fields that were provided
  const setClauses = [];
  const values = [];
  let idx = 1;

  for (const [key, value] of Object.entries(body)) {
    if (!UPDATABLE_FIELDS.has(key)) continue;

    // JSONB fields need serialization
    if (['tool_metadata', 'type_metadata', 'marketplace_metadata', 'content'].includes(key)) {
      setClauses.push(`${key} = $${idx}`);
      values.push(JSON.stringify(value));
    } else {
      setClauses.push(`${key} = $${idx}`);
      values.push(value);
    }
    idx++;
  }

  if (setClauses.length === 0) {
    return json(res, 400, { error: 'No updatable fields provided' });
  }

  setClauses.push(`updated_at = NOW()`);
  values.push(id);

  const result = await db.query(
    `UPDATE artifacts SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    return json(res, 404, { error: 'Artifact not found' });
  }

  json(res, 200, result.rows[0]);
}

/**
 * DELETE /api/artifacts/:id
 */
export async function handleDeleteArtifact(req, res, params, id) {
  if (!validateUUID(id)) {
    return json(res, 400, { error: 'Invalid artifact ID format' });
  }

  const result = await db.query(
    'DELETE FROM artifacts WHERE id = $1 RETURNING id',
    [id]
  );

  if (result.rows.length === 0) {
    return json(res, 404, { error: 'Artifact not found' });
  }

  res.writeHead(204);
  res.end();
}
