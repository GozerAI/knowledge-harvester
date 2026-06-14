// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Code Pattern Scorer — Quality scoring for code pattern artifacts.
 *
 * Scores 0-100 based on:
 *   - Completeness (0-25): name, description, documentation
 *   - Structure (0-25): classes, functions, imports, organization
 *   - Quality signals (0-25): types, error handling, tests, async
 *   - Source quality (0-25): language, framework detection, stars
 */

import { db } from '../../../db/client.js';
import { logger } from '../../../utils/logger.js';

/**
 * Score unscored code_pattern artifacts.
 */
export async function scoreCodePatterns(limit = 100) {
  const result = await db.query(
    `SELECT id, name, description, source, tool_type, type_metadata
     FROM artifacts
     WHERE artifact_type = 'code_pattern' AND quality_score = 0
     ORDER BY discovered_at DESC
     LIMIT $1`,
    [limit]
  );

  if (result.rows.length === 0) {
    logger.info('No code patterns to score');
    return { scored: 0 };
  }

  logger.info(`Scoring ${result.rows.length} code patterns`);
  let scored = 0;

  for (const row of result.rows) {
    const meta = typeof row.type_metadata === 'string'
      ? JSON.parse(row.type_metadata) : (row.type_metadata || {});
    const score = calculateCodePatternScore(row, meta);

    await db.query(
      'UPDATE artifacts SET quality_score = $1 WHERE id = $2',
      [score, row.id]
    );
    scored++;
  }

  logger.info('Code pattern scoring complete', { scored });
  return { scored };
}

/**
 * Calculate quality score for a code pattern artifact.
 */
export function calculateCodePatternScore(row, meta) {
  let score = 0;

  // ── Completeness (0-25) ──
  if (row.name && !row.name.includes('Untitled')) score += 8;
  if (row.description?.length > 20) score += 8;
  if (row.description?.length > 100) score += 9;

  // ── Structure (0-25) ──
  const funcCount = meta.function_count || 0;
  const classCount = meta.class_count || 0;
  const importCount = meta.import_count || 0;
  const lineCount = meta.line_count || 0;

  // Has meaningful structure
  if (funcCount >= 1) score += 5;
  if (funcCount >= 3) score += 3;
  if (classCount >= 1) score += 5;
  if (importCount >= 2) score += 4;

  // Not too short, not too bloated
  if (lineCount >= 20 && lineCount <= 500) score += 4;
  if (lineCount > 500 && lineCount <= 2000) score += 2;

  // Decorator usage (indicates framework usage)
  if ((meta.decorator_count || 0) > 0) score += 4;

  // ── Quality signals (0-25) ──
  if (meta.has_types) score += 5;
  if (meta.has_error_handling) score += 5;
  if (meta.has_tests) score += 8;
  if (meta.has_async) score += 3;

  // Has docstrings/documentation
  if (meta.has_documentation) score += 4;

  // ── Source quality (0-25) ──
  // Framework detection means well-structured code
  if (meta.framework) score += 10;

  // Language quality (typed > untyped for patterns)
  const typedLanguages = ['typescript', 'go', 'rust', 'java', 'kotlin', 'csharp'];
  if (typedLanguages.includes(meta.language)) score += 8;
  else if (['python', 'javascript'].includes(meta.language)) score += 5;
  else score += 3;

  // Multiple imports suggest real-world usage
  if (importCount >= 5) score += 7;
  else if (importCount >= 3) score += 4;

  return Math.min(score, 100);
}
