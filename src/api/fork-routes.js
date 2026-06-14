// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Fork / Remix tracking API for artifacts.
 *
 * Routes handled:
 *   POST /api/artifacts/:id/fork
 *   GET  /api/artifacts/:id/forks
 */

import { randomUUID } from 'node:crypto';
import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';

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
 * Build the data object for a new forked artifact.
 * @param {object} original   - Row from the artifacts table
 * @param {string} authorName
 * @param {string|undefined} modifications - Optional description of changes
 * @returns {object}
 */
export function buildForkData(original, authorName, modifications) {
  const originalMeta = original.type_metadata
    ? (typeof original.type_metadata === 'string'
        ? JSON.parse(original.type_metadata)
        : original.type_metadata)
    : {};

  const type_metadata = {
    ...originalMeta,
    forked_from: original.id,
    fork_modifications: modifications || null,
  };

  return {
    id: randomUUID(),
    artifact_type: original.artifact_type,
    source: original.source,
    source_url: original.source_url || null,
    source_id: original.source_id || null,
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    content: original.content,
    name: original.name ? `Fork of ${original.name}` : 'Forked artifact',
    description: original.description || '',
    author_username: authorName,
    author_profile_url: null,
    language: original.language || null,
    tool_type: original.tool_type || null,
    tool_metadata: original.tool_metadata
      ? (typeof original.tool_metadata === 'string' ? original.tool_metadata : JSON.stringify(original.tool_metadata))
      : '{}',
    tags: original.tags || [],
    type_metadata: JSON.stringify(type_metadata),
    primary_category: original.primary_category || null,
    secondary_categories: original.secondary_categories || '{}',
    quality_score: original.quality_score || 0,
    complexity_score: original.complexity_score || 0,
    has_description: Boolean(original.description),
    has_documentation: original.has_documentation || false,
    is_complete: original.is_complete ?? true,
    validation_status: 'untested',
    processing_status: 'raw',
    marketplace_metadata: '{}',
  };
}

/**
 * Determine whether an artifact is a fork.
 * @param {object} artifact - Artifact row (type_metadata may be object or JSON string)
 * @returns {boolean}
 */
export function isFork(artifact) {
  if (!artifact || !artifact.type_metadata) return false;
  try {
    const meta = typeof artifact.type_metadata === 'string'
      ? JSON.parse(artifact.type_metadata)
      : artifact.type_metadata;
    return Boolean(meta.forked_from);
  } catch {
    return false;
  }
}

// ── Route handlers ────────────────────────────────────────────────────────────

/**
 * POST /api/artifacts/:id/fork
 */
export async function handleForkArtifact(req, res, _params, artifactId) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' });
  }

  if (!body.author_name || typeof body.author_name !== 'string' || body.author_name.trim() === '') {
    return json(res, 400, { error: 'author_name is required' });
  }

  try {
    const originalResult = await db.query(
      `SELECT id, artifact_type, source, source_url, source_id, content, name,
              description, author_username, author_profile_url, language, tool_type,
              tool_metadata, tags, type_metadata, primary_category, secondary_categories,
              quality_score, complexity_score, has_description, has_documentation,
              is_complete, validation_status
       FROM artifacts WHERE id = $1`,
      [artifactId]
    );

    if (originalResult.rows.length === 0) {
      return json(res, 404, { error: 'Artifact not found' });
    }

    const original = originalResult.rows[0];
    const forkData = buildForkData(original, body.author_name.trim(), body.modifications || null);

    const insertResult = await db.query(
      `INSERT INTO artifacts (
         id, artifact_type, source, source_url, source_id,
         discovered_at, updated_at, content, name, description,
         author_username, author_profile_url, language, tool_type,
         tool_metadata, tags, type_metadata, primary_category, secondary_categories,
         quality_score, complexity_score, has_description, has_documentation,
         is_complete, validation_status, processing_status, marketplace_metadata
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8::jsonb, $9, $10,
         $11, $12, $13, $14,
         $15::jsonb, $16, $17::jsonb, $18, $19::jsonb,
         $20, $21, $22, $23,
         $24, $25, $26, $27::jsonb
       ) RETURNING id, name, artifact_type, author_username, type_metadata, discovered_at`,
      [
        forkData.id, forkData.artifact_type, forkData.source, forkData.source_url, forkData.source_id,
        forkData.discovered_at, forkData.updated_at, forkData.content, forkData.name, forkData.description,
        forkData.author_username, forkData.author_profile_url, forkData.language, forkData.tool_type,
        forkData.tool_metadata, forkData.tags, forkData.type_metadata, forkData.primary_category, forkData.secondary_categories,
        forkData.quality_score, forkData.complexity_score, forkData.has_description, forkData.has_documentation,
        forkData.is_complete, forkData.validation_status, forkData.processing_status, forkData.marketplace_metadata,
      ]
    );

    logger.info('Artifact forked', { original_id: artifactId, fork_id: forkData.id });
    return json(res, 201, insertResult.rows[0]);
  } catch (err) {
    logger.error('Failed to fork artifact', { error: err.message });
    return json(res, 500, { error: 'Internal server error' });
  }
}

/**
 * GET /api/artifacts/:id/forks
 */
export async function handleListForks(req, res, _params, artifactId) {
  try {
    const result = await db.query(
      `SELECT id, name, artifact_type, author_username, type_metadata, discovered_at, quality_score
       FROM artifacts
       WHERE type_metadata->>'forked_from' = $1
       ORDER BY discovered_at DESC`,
      [artifactId]
    );

    return json(res, 200, {
      fork_count: result.rows.length,
      forks: result.rows,
    });
  } catch (err) {
    logger.error('Failed to list forks', { error: err.message });
    return json(res, 500, { error: 'Internal server error' });
  }
}
