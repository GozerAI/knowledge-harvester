// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Batch import/export route handlers for artifacts.
 *
 * Import: validates each item individually, bulk inserts valid ones,
 *         collects per-item errors for partial failures.
 * Export: accepts an array of IDs and returns matching artifacts.
 */

import { db } from '../db/client.js';
import { validateUUID, validateBody, json } from './middleware.js';

const BATCH_SIZE_LIMIT = 100;

// ── Body reader ──────────────────────────────────────────────────────────────

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

// ── Handlers ─────────────────────────────────────────────────────────────────

/**
 * POST /api/artifacts/batch
 * Accepts { artifacts: [...] }, validates and bulk inserts each item.
 * Returns { imported: number, errors: [{ index, errors }] }
 */
export async function handleBatchImport(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' });
  }

  if (!body || !Array.isArray(body.artifacts)) {
    return json(res, 400, { error: 'Request body must include an artifacts array' });
  }

  if (body.artifacts.length === 0) {
    return json(res, 200, { imported: 0, errors: [] });
  }

  if (body.artifacts.length > BATCH_SIZE_LIMIT) {
    return json(res, 400, {
      error: `Batch size exceeds limit of ${BATCH_SIZE_LIMIT}`,
      provided: body.artifacts.length,
    });
  }

  const itemErrors = [];
  const validItems = [];

  for (let i = 0; i < body.artifacts.length; i++) {
    const item = body.artifacts[i];
    const { valid, errors } = validateBody(item, ['artifact_type', 'name', 'content']);
    if (!valid) {
      itemErrors.push({ index: i, errors });
    } else {
      validItems.push({ index: i, item });
    }
  }

  if (validItems.length === 0) {
    return json(res, 200, { imported: 0, errors: itemErrors });
  }

  // Bulk insert valid items sequentially (avoids building a giant multi-row VALUES)
  let importedCount = 0;

  for (const { index, item } of validItems) {
    try {
      await db.query(
        `INSERT INTO artifacts (
           artifact_type, name, description, source, source_url, source_id,
           content, language, tool_type, tool_metadata, tags,
           type_metadata, quality_score, has_description, has_documentation,
           is_complete, validation_status, publishing_status, marketplace_metadata
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT (source, source_id) DO NOTHING`,
        [
          item.artifact_type,
          item.name,
          item.description || '',
          item.source || 'api',
          item.source_url || '',
          item.source_id || '',
          JSON.stringify(item.content),
          item.language || null,
          item.tool_type || null,
          JSON.stringify(item.tool_metadata || {}),
          item.tags || [],
          JSON.stringify(item.type_metadata || {}),
          item.quality_score || 0,
          item.has_description || false,
          item.has_documentation || false,
          item.is_complete !== undefined ? item.is_complete : true,
          item.validation_status || 'untested',
          item.publishing_status || 'raw',
          JSON.stringify(item.marketplace_metadata || {}),
        ]
      );
      importedCount++;
    } catch (err) {
      itemErrors.push({ index, errors: [err.message] });
    }
  }

  json(res, 200, { imported: importedCount, errors: itemErrors });
}

/**
 * POST /api/artifacts/batch/export
 * Accepts { ids: [...] } and returns matching artifacts.
 * Missing IDs are silently omitted (not an error).
 */
export async function handleBatchExport(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' });
  }

  if (!body || !Array.isArray(body.ids)) {
    return json(res, 400, { error: 'Request body must include an ids array' });
  }

  if (body.ids.length === 0) {
    return json(res, 200, { artifacts: [] });
  }

  if (body.ids.length > BATCH_SIZE_LIMIT) {
    return json(res, 400, {
      error: `Batch size exceeds limit of ${BATCH_SIZE_LIMIT}`,
      provided: body.ids.length,
    });
  }

  // Validate all IDs up front — skip invalid ones, don't fail the whole request
  const validIds = body.ids.filter(id => validateUUID(id));

  if (validIds.length === 0) {
    return json(res, 200, { artifacts: [] });
  }

  // Build $1,$2,... placeholders
  const placeholders = validIds.map((_, i) => `$${i + 1}`).join(',');

  const result = await db.query(
    `SELECT id, artifact_type, name, description, source, source_url,
            language, tool_type, tags, primary_category, secondary_categories,
            quality_score, complexity_score, content, type_metadata,
            tool_metadata, marketplace_metadata, publishing_status,
            has_description, has_documentation, is_complete,
            validation_status, discovered_at, updated_at
     FROM artifacts WHERE id IN (${placeholders})`,
    validIds
  );

  json(res, 200, { artifacts: result.rows });
}
