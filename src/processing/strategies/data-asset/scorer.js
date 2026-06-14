// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Data Asset Scorer — Quality scoring for data asset artifacts.
 *
 * Scores 0-100 based on:
 *   - Completeness (0-25): name, description, comments
 *   - Structure (0-30): table/column count, relationships, indexes
 *   - Best practices (0-25): constraints, tests, reversibility
 *   - Usability (0-20): documentation, naming quality
 */

import { db } from '../../../db/client.js';
import { logger } from '../../../utils/logger.js';

export async function scoreDataAssets(limit = 100) {
  const result = await db.query(
    `SELECT id, name, description, source, tool_type, type_metadata
     FROM artifacts
     WHERE artifact_type = 'data_asset' AND quality_score = 0
     ORDER BY discovered_at DESC LIMIT $1`,
    [limit]
  );

  if (result.rows.length === 0) {
    logger.info('No data assets to score');
    return { scored: 0 };
  }

  logger.info(`Scoring ${result.rows.length} data assets`);
  let scored = 0;

  for (const row of result.rows) {
    const meta = typeof row.type_metadata === 'string'
      ? JSON.parse(row.type_metadata) : (row.type_metadata || {});
    const score = calculateDataAssetScore(row, meta);
    await db.query('UPDATE artifacts SET quality_score = $1 WHERE id = $2', [score, row.id]);
    scored++;
  }

  logger.info('Data asset scoring complete', { scored });
  return { scored };
}

export function calculateDataAssetScore(row, meta) {
  let score = 0;

  // ── Completeness (0-25) ──
  if (row.name && !row.name.includes('Untitled')) score += 8;
  if (row.description?.length > 20) score += 8;
  if (meta.hasComments) score += 9;

  // ── Structure (0-30) ──
  const tableCount = meta.table_count || meta.ref_count || 0;
  if (tableCount >= 1) score += 5;
  if (tableCount >= 3) score += 5;
  if (tableCount >= 5) score += 5;

  const columnCount = meta.column_count || meta.field_count || 0;
  if (columnCount >= 5) score += 5;
  if (columnCount >= 15) score += 5;

  if ((meta.index_count || 0) > 0) score += 5;

  // ── Best Practices (0-25) ──
  if (meta.has_constraints) score += 7;
  if ((meta.foreign_keys || []).length > 0) score += 5;
  if (meta.has_tests) score += 5;
  if (meta.is_reversible || meta.has_rollback) score += 4;
  if (meta.has_materialization) score += 4;

  // ── Usability (0-20) ──
  if (meta.has_schema) score += 5;
  if (meta.has_connection) score += 5;
  if ((meta.sources || []).length > 0) score += 5;
  if ((meta.refs || []).length > 0) score += 5;

  return Math.min(score, 100);
}
