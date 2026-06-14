// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Documentation Scorer — Quality scoring for documentation artifacts.
 *
 * Scores 0-100 based on:
 *   - Content depth (0-30): word count, sections, reading time
 *   - Structure (0-25): headings, lists, tables, code blocks
 *   - Richness (0-25): links, images, examples, code samples
 *   - Metadata (0-20): front matter, TOC, descriptions
 */

import { db } from '../../../db/client.js';
import { logger } from '../../../utils/logger.js';

export async function scoreDocumentation(limit = 100) {
  const result = await db.query(
    `SELECT id, name, description, source, tool_type, type_metadata
     FROM artifacts
     WHERE artifact_type = 'documentation' AND quality_score = 0
     ORDER BY discovered_at DESC LIMIT $1`,
    [limit]
  );

  if (result.rows.length === 0) {
    logger.info('No documentation to score');
    return { scored: 0 };
  }

  logger.info(`Scoring ${result.rows.length} documentation artifacts`);
  let scored = 0;

  for (const row of result.rows) {
    const meta = typeof row.type_metadata === 'string'
      ? JSON.parse(row.type_metadata) : (row.type_metadata || {});
    const score = calculateDocScore(row, meta);
    await db.query('UPDATE artifacts SET quality_score = $1 WHERE id = $2', [score, row.id]);
    scored++;
  }

  logger.info('Documentation scoring complete', { scored });
  return { scored };
}

export function calculateDocScore(row, meta) {
  let score = 0;

  // ── Content Depth (0-30) ──
  const wordCount = meta.word_count || 0;
  if (wordCount >= 100) score += 5;
  if (wordCount >= 300) score += 5;
  if (wordCount >= 500) score += 5;
  if (wordCount >= 1000) score += 5;

  const sectionCount = meta.section_count || 0;
  if (sectionCount >= 2) score += 5;
  if (sectionCount >= 5) score += 5;

  // ── Structure (0-25) ──
  if ((meta.heading_count || 0) >= 3) score += 5;
  if ((meta.bullet_list_count || 0) >= 3) score += 5;
  if ((meta.numbered_list_count || 0) >= 1) score += 5;
  if (meta.has_tables) score += 5;
  if ((meta.code_block_count || 0) >= 1) score += 5;

  // ── Richness (0-25) ──
  if ((meta.link_count || 0) >= 2) score += 5;
  if ((meta.external_link_count || 0) >= 1) score += 5;
  if ((meta.image_count || 0) >= 1) score += 5;
  if ((meta.code_block_count || 0) >= 3) score += 5;
  if ((meta.code_languages || []).length >= 2) score += 5;

  // ── Metadata (0-20) ──
  if (row.name && !row.name.includes('Untitled')) score += 5;
  if (row.description?.length > 20) score += 5;
  if (meta.has_front_matter) score += 5;
  if (meta.has_toc) score += 5;

  return Math.min(score, 100);
}
