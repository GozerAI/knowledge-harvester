// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Partial response for large artifacts (item #81).
 *
 * Supports field selection (sparse fieldsets) and range-based content
 * retrieval so clients can request only the data they need.
 */

import { db } from '../db/client.js';
import { validateUUID, json } from './middleware.js';

/**
 * Default fields returned for artifact listing (lightweight).
 */
const SUMMARY_FIELDS = [
  'id', 'name', 'artifact_type', 'source', 'quality_score',
  'primary_category', 'tags', 'discovered_at', 'updated_at',
];

/**
 * All available fields for artifact detail.
 */
const ALL_FIELDS = [
  'id', 'hash', 'artifact_type', 'source', 'source_url', 'source_id',
  'name', 'description', 'author_username', 'author_profile_url',
  'language', 'tool_type', 'tool_metadata', 'tags', 'type_metadata',
  'content', 'primary_category', 'secondary_categories',
  'quality_score', 'complexity_score', 'complexity_breakdown',
  'has_description', 'has_documentation', 'is_complete',
  'validation_status', 'publishing_status', 'price_tier',
  'marketplace_metadata', 'discovered_at', 'updated_at',
  'enriched_at', 'published_at',
];

/**
 * Parse a ?fields= query parameter into a validated field list.
 * @param {string|null} fieldsParam - Comma-separated field names
 * @returns {{ fields: string[], isPartial: boolean }}
 */
export function parseFieldSelection(fieldsParam) {
  if (!fieldsParam) {
    return { fields: ALL_FIELDS, isPartial: false };
  }

  const requested = fieldsParam.split(',')
    .map(f => f.trim().toLowerCase())
    .filter(Boolean);

  // Always include id
  if (!requested.includes('id')) {
    requested.unshift('id');
  }

  // Validate against allowed fields
  const valid = requested.filter(f => ALL_FIELDS.includes(f));

  return {
    fields: valid.length > 0 ? valid : SUMMARY_FIELDS,
    isPartial: true,
  };
}

/**
 * Parse Range header for content-range requests.
 * Supports: bytes=start-end, items=start-end
 * @param {string|null} rangeHeader
 * @returns {{ type: string, start: number, end: number }|null}
 */
export function parseRangeHeader(rangeHeader) {
  if (!rangeHeader) return null;

  const match = rangeHeader.match(/^(bytes|items)=(\d+)-(\d*)$/);
  if (!match) return null;

  return {
    type: match[1],
    start: parseInt(match[2], 10),
    end: match[3] ? parseInt(match[3], 10) : -1,
  };
}

/**
 * Build a SELECT clause from field list.
 * @param {string[]} fields
 * @returns {string}
 */
export function buildSelectClause(fields) {
  return fields.join(', ');
}

/**
 * Apply partial response to an artifact object.
 * Removes fields not in the selection.
 *
 * @param {object} artifact
 * @param {string[]} fields
 * @returns {object}
 */
export function applyFieldMask(artifact, fields) {
  const fieldSet = new Set(fields);
  const result = {};
  for (const [key, value] of Object.entries(artifact)) {
    if (fieldSet.has(key)) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * GET /api/artifacts/:id/partial
 * Returns artifact with field selection and optional content range.
 */
export async function handlePartialArtifact(req, res, params, id) {
  if (!validateUUID(id)) {
    return json(res, 400, { error: 'Invalid artifact ID format' });
  }

  const fieldsParam = params.get('fields');
  const { fields, isPartial } = parseFieldSelection(fieldsParam);

  // Build optimized SELECT
  const selectClause = buildSelectClause(fields);

  const result = await db.query(
    `SELECT ${selectClause} FROM artifacts WHERE id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    return json(res, 404, { error: 'Artifact not found' });
  }

  let artifact = result.rows[0];

  // Handle content range for large content field
  const rangeHeader = req.headers['range'];
  const range = parseRangeHeader(rangeHeader);

  if (range && artifact.content) {
    const contentStr = typeof artifact.content === 'string'
      ? artifact.content
      : JSON.stringify(artifact.content);

    const totalSize = contentStr.length;
    const start = range.start;
    const end = range.end === -1 ? totalSize - 1 : Math.min(range.end, totalSize - 1);

    if (start >= totalSize) {
      res.writeHead(416, {
        'Content-Range': `bytes */${totalSize}`,
      });
      return res.end();
    }

    artifact = { ...artifact, content: contentStr.slice(start, end + 1) };

    res.writeHead(206, {
      'Content-Type': 'application/json',
      'Content-Range': `bytes ${start}-${end}/${totalSize}`,
      'Accept-Ranges': 'bytes',
    });
    return res.end(JSON.stringify(artifact));
  }

  // Add partial response headers
  const headers = { 'Content-Type': 'application/json' };
  if (isPartial) {
    headers['X-Partial-Response'] = 'true';
    headers['X-Available-Fields'] = ALL_FIELDS.join(',');
  }

  const status = isPartial ? 200 : 200;
  res.writeHead(status, headers);
  res.end(JSON.stringify(artifact));
}

/**
 * Apply partial response to a list of artifacts.
 * @param {Array<object>} artifacts
 * @param {string[]} fields
 * @returns {Array<object>}
 */
export function applyFieldMaskBatch(artifacts, fields) {
  return artifacts.map(a => applyFieldMask(a, fields));
}

export { SUMMARY_FIELDS, ALL_FIELDS };
