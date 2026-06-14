// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * API Spec Scorer — Quality scoring for API specification artifacts.
 *
 * Scores 0-100 based on:
 *   - Completeness (0-25): title, description, documentation
 *   - Coverage (0-30): endpoint count, schema count, methods
 *   - Best practices (0-25): security, examples, parameters
 *   - Usability (0-20): descriptions on operations, consistent naming
 */

import { db } from '../../../db/client.js';
import { logger } from '../../../utils/logger.js';

/**
 * Score unscored api_spec artifacts.
 */
export async function scoreApiSpecs(limit = 100) {
  const result = await db.query(
    `SELECT id, name, description, source, tool_type, type_metadata
     FROM artifacts
     WHERE artifact_type = 'api_spec' AND quality_score = 0
     ORDER BY discovered_at DESC
     LIMIT $1`,
    [limit]
  );

  if (result.rows.length === 0) {
    logger.info('No API specs to score');
    return { scored: 0 };
  }

  logger.info(`Scoring ${result.rows.length} API specs`);
  let scored = 0;

  for (const row of result.rows) {
    const meta = typeof row.type_metadata === 'string'
      ? JSON.parse(row.type_metadata) : (row.type_metadata || {});
    const score = calculateApiSpecScore(row, meta);
    await db.query('UPDATE artifacts SET quality_score = $1 WHERE id = $2', [score, row.id]);
    scored++;
  }

  logger.info('API spec scoring complete', { scored });
  return { scored };
}

/**
 * Calculate quality score for an API spec artifact.
 */
export function calculateApiSpecScore(row, meta) {
  let score = 0;

  // ── Completeness (0-25) ──
  if (row.name && !row.name.includes('Untitled')) score += 8;
  if (row.description?.length > 20) score += 8;
  if (meta.api_title) score += 9;

  // ── Coverage (0-30) ──
  const endpointCount = meta.endpoint_count || meta.query_count || meta.rpc_count || meta.channel_count || 0;
  if (endpointCount >= 1) score += 5;
  if (endpointCount >= 5) score += 5;
  if (endpointCount >= 10) score += 5;
  if (endpointCount >= 20) score += 5;

  const schemaCount = meta.schema_count || meta.type_count || meta.message_count || 0;
  if (schemaCount >= 1) score += 5;
  if (schemaCount >= 5) score += 5;

  // ── Best Practices (0-25) ──
  if (meta.has_security) score += 8;
  if (meta.has_examples) score += 5;
  if (meta.has_parameters) score += 4;
  if (meta.has_streaming) score += 4;
  if (meta.has_directives) score += 4;

  // ── Usability (0-20) ──
  if (meta.hasDescriptions) score += 10;

  // Multiple HTTP methods or query types suggest well-designed API
  const methodCount = meta.method_count || 0;
  if (methodCount >= 2) score += 5;
  if (methodCount >= 4) score += 5;

  return Math.min(score, 100);
}
