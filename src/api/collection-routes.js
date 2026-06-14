// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Curated Collections API.
 *
 * Table: collections
 *   id UUID, name TEXT, slug TEXT UNIQUE, description TEXT,
 *   author_name TEXT, is_public BOOLEAN, artifact_ids UUID[],
 *   artifact_count INTEGER, created_at TIMESTAMPTZ
 *
 * Routes handled:
 *   POST   /api/collections
 *   GET    /api/collections
 *   GET    /api/collections/:idOrSlug
 *   PUT    /api/collections/:id
 *   DELETE /api/collections/:id
 *   POST   /api/collections/:id/artifacts
 *   DELETE /api/collections/:id/artifacts/:artifactId
 */

import { randomUUID } from 'node:crypto';
import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { parsePagination, validateUUID } from './middleware.js';

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Generate a URL-safe slug from a collection name.
 * - Lowercases
 * - Replaces spaces with hyphens
 * - Strips all non-alphanumeric/hyphen characters
 * - Collapses consecutive hyphens
 * - Trims leading/trailing hyphens
 * - Truncates to 200 characters
 * @param {string} name
 * @returns {string}
 */
export function generateSlug(name) {
  if (typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200);
}

/**
 * Validate a collection creation body.
 * @param {object} body
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateCollection(body) {
  const errors = [];

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: ['Body must be a non-null object'] };
  }

  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    errors.push('name is required and must be a non-empty string');
  }

  if (!body.author_name || typeof body.author_name !== 'string' || !body.author_name.trim()) {
    errors.push('author_name is required and must be a non-empty string');
  }

  if (body.is_public !== undefined && typeof body.is_public !== 'boolean') {
    errors.push('is_public must be a boolean');
  }

  return { valid: errors.length === 0, errors };
}

// ── Route handlers ────────────────────────────────────────────────────────────

/**
 * POST /api/collections
 */
export async function handleCreateCollection(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' });
  }

  const { valid, errors } = validateCollection(body);
  if (!valid) {
    return json(res, 400, { error: 'Validation failed', details: errors });
  }

  const { name, description, author_name, is_public } = body;
  const id = randomUUID();
  const baseSlug = generateSlug(name.trim());

  try {
    // Handle duplicate slug by appending a short fragment of the UUID
    let slug = baseSlug;
    const existing = await db.query('SELECT slug FROM collections WHERE slug = $1', [slug]);
    if (existing.rows.length > 0) {
      slug = `${baseSlug}-${id.slice(0, 8)}`;
    }

    const result = await db.query(
      `INSERT INTO collections (id, name, slug, description, author_name, is_public, artifact_ids, artifact_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0)
       RETURNING id, name, slug, description, author_name, is_public, artifact_count, created_at`,
      [
        id,
        name.trim(),
        slug,
        description || null,
        author_name.trim(),
        is_public !== undefined ? is_public : true,
        [],
      ]
    );

    logger.info('Collection created', { id, name: name.trim() });
    return json(res, 201, result.rows[0]);
  } catch (err) {
    logger.error('Failed to create collection', { error: err.message });
    return json(res, 500, { error: 'Internal server error' });
  }
}

/**
 * GET /api/collections
 */
export async function handleListCollections(req, res, params) {
  const { limit, offset } = parsePagination(params);
  const isPublicParam = params.get('is_public');
  // Default to only public collections
  const isPublic = isPublicParam === 'false' ? false : true;

  try {
    const countResult = await db.query(
      'SELECT COUNT(*) as count FROM collections WHERE is_public = $1',
      [isPublic]
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const result = await db.query(
      `SELECT id, name, slug, description, author_name, is_public, artifact_count, created_at
       FROM collections
       WHERE is_public = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [isPublic, limit, offset]
    );

    return json(res, 200, {
      total,
      limit,
      offset,
      collections: result.rows,
    });
  } catch (err) {
    logger.error('Failed to list collections', { error: err.message });
    return json(res, 500, { error: 'Internal server error' });
  }
}

/**
 * GET /api/collections/:idOrSlug
 * Accepts either a UUID or a slug string.
 */
export async function handleGetCollection(req, res, _params, idOrSlug) {
  try {
    const isUUID = validateUUID(idOrSlug);
    const whereClause = isUUID ? 'id = $1' : 'slug = $1';

    const collectionResult = await db.query(
      `SELECT id, name, slug, description, author_name, is_public, artifact_ids, artifact_count, created_at
       FROM collections WHERE ${whereClause}`,
      [idOrSlug]
    );

    if (collectionResult.rows.length === 0) {
      return json(res, 404, { error: 'Collection not found' });
    }

    const collection = collectionResult.rows[0];
    const artifactIds = collection.artifact_ids || [];

    let artifacts = [];
    if (artifactIds.length > 0) {
      const artifactsResult = await db.query(
        `SELECT id, name, artifact_type, primary_category, quality_score, author_username, discovered_at
         FROM artifacts
         WHERE id = ANY($1::uuid[])
         ORDER BY discovered_at DESC`,
        [artifactIds]
      );
      artifacts = artifactsResult.rows;
    }

    return json(res, 200, { ...collection, artifacts });
  } catch (err) {
    logger.error('Failed to get collection', { error: err.message });
    return json(res, 500, { error: 'Internal server error' });
  }
}

/**
 * PUT /api/collections/:id
 */
export async function handleUpdateCollection(req, res, _params, id) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' });
  }

  const updates = {};
  const values = [];
  let idx = 1;

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return json(res, 400, { error: 'name must be a non-empty string' });
    }
    updates.name = `name = $${idx}`;
    values.push(body.name.trim());
    idx++;
  }

  if (body.description !== undefined) {
    updates.description = `description = $${idx}`;
    values.push(body.description);
    idx++;
  }

  if (body.is_public !== undefined) {
    if (typeof body.is_public !== 'boolean') {
      return json(res, 400, { error: 'is_public must be a boolean' });
    }
    updates.is_public = `is_public = $${idx}`;
    values.push(body.is_public);
    idx++;
  }

  if (Object.keys(updates).length === 0) {
    return json(res, 400, { error: 'No valid fields to update' });
  }

  values.push(id);
  const setClause = Object.values(updates).join(', ');

  try {
    const result = await db.query(
      `UPDATE collections SET ${setClause}
       WHERE id = $${idx}
       RETURNING id, name, slug, description, author_name, is_public, artifact_count, created_at`,
      values
    );

    if (result.rows.length === 0) {
      return json(res, 404, { error: 'Collection not found' });
    }

    return json(res, 200, result.rows[0]);
  } catch (err) {
    logger.error('Failed to update collection', { error: err.message });
    return json(res, 500, { error: 'Internal server error' });
  }
}

/**
 * DELETE /api/collections/:id
 */
export async function handleDeleteCollection(req, res, _params, id) {
  try {
    const result = await db.query(
      'DELETE FROM collections WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return json(res, 404, { error: 'Collection not found' });
    }

    res.writeHead(204);
    res.end();
  } catch (err) {
    logger.error('Failed to delete collection', { error: err.message });
    return json(res, 500, { error: 'Internal server error' });
  }
}

/**
 * POST /api/collections/:id/artifacts
 * Appends an artifact to the collection.
 */
export async function handleAddToCollection(req, res, _params, collectionId) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' });
  }

  if (!body.artifact_id || !validateUUID(body.artifact_id)) {
    return json(res, 400, { error: 'artifact_id must be a valid UUID' });
  }

  try {
    const result = await db.query(
      `UPDATE collections
       SET artifact_ids = array_append(artifact_ids, $1::uuid),
           artifact_count = artifact_count + 1
       WHERE id = $2
       RETURNING id, name, artifact_ids, artifact_count`,
      [body.artifact_id, collectionId]
    );

    if (result.rows.length === 0) {
      return json(res, 404, { error: 'Collection not found' });
    }

    return json(res, 200, result.rows[0]);
  } catch (err) {
    logger.error('Failed to add artifact to collection', { error: err.message });
    return json(res, 500, { error: 'Internal server error' });
  }
}

/**
 * DELETE /api/collections/:id/artifacts/:artifactId
 * Removes an artifact from the collection. Idempotent — no error if not present.
 */
export async function handleRemoveFromCollection(req, res, _params, collectionId, artifactId) {
  try {
    // Only decrement if the artifact is actually in the array
    const result = await db.query(
      `UPDATE collections
       SET artifact_ids = array_remove(artifact_ids, $1::uuid),
           artifact_count = GREATEST(0, artifact_count - (
             CASE WHEN $1::uuid = ANY(artifact_ids) THEN 1 ELSE 0 END
           ))
       WHERE id = $2
       RETURNING id, name, artifact_ids, artifact_count`,
      [artifactId, collectionId]
    );

    if (result.rows.length === 0) {
      return json(res, 404, { error: 'Collection not found' });
    }

    return json(res, 200, result.rows[0]);
  } catch (err) {
    logger.error('Failed to remove artifact from collection', { error: err.message });
    return json(res, 500, { error: 'Internal server error' });
  }
}
