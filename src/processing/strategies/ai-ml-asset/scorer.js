// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * AI/ML Asset Scorer — Quality scoring for AI/ML artifact assets.
 *
 * Scores 0-100 based on:
 *   - Completeness (0-25): name, description, documentation
 *   - ML depth (0-30): framework, model type, hyperparams, metrics
 *   - Reproducibility (0-25): dataset refs, GPU config, experiment tracking
 *   - Usability (0-20): structure, imports, code quality
 */

import { db } from '../../../db/client.js';
import { logger } from '../../../utils/logger.js';

/**
 * Score unscored ai_ml_asset artifacts.
 */
export async function scoreAiMlAssets(limit = 100) {
  const result = await db.query(
    `SELECT id, name, description, source, tool_type, type_metadata
     FROM artifacts
     WHERE artifact_type = 'ai_ml_asset' AND quality_score = 0
     ORDER BY discovered_at DESC
     LIMIT $1`,
    [limit]
  );

  if (result.rows.length === 0) {
    logger.info('No AI/ML assets to score');
    return { scored: 0 };
  }

  logger.info(`Scoring ${result.rows.length} AI/ML assets`);
  let scored = 0;

  for (const row of result.rows) {
    const meta = typeof row.type_metadata === 'string'
      ? JSON.parse(row.type_metadata) : (row.type_metadata || {});
    const score = calculateAiMlScore(row, meta);

    await db.query(
      'UPDATE artifacts SET quality_score = $1 WHERE id = $2',
      [score, row.id]
    );
    scored++;
  }

  logger.info('AI/ML asset scoring complete', { scored });
  return { scored };
}

/**
 * Calculate quality score for an AI/ML asset.
 */
export function calculateAiMlScore(row, meta) {
  let score = 0;

  // ── Completeness (0-25) ──
  if (row.name && !row.name.includes('Untitled')) score += 8;
  if (row.description?.length > 20) score += 8;
  if (row.description?.length > 100) score += 9;

  // ── ML Depth (0-30) ──
  if (meta.framework) score += 8;
  if (meta.model_type) score += 5;
  if (meta.optimizer) score += 4;
  if (meta.loss_function) score += 4;

  // Metrics tracked
  const metrics = meta.metrics || [];
  if (metrics.length >= 1) score += 3;
  if (metrics.length >= 3) score += 3;

  // Hyperparameters documented
  const hpCount = Object.keys(meta.hyperparameters || {}).length;
  if (hpCount >= 1) score += 3;

  // ── Reproducibility (0-25) ──
  // Dataset references
  const dsCount = (meta.dataset_refs || meta.datasets || []).length;
  if (dsCount >= 1) score += 5;
  if (dsCount >= 3) score += 3;

  // GPU configuration
  if (meta.has_gpu_config) score += 4;

  // Experiment tracking
  if (meta.has_wandb) score += 5;
  if (meta.hasMlflow || meta.has_mlflow) score += 5;

  // Model card specifics
  if (meta.base_model) score += 3;

  // ── Usability (0-20) ──
  // Notebook structure
  if (meta.ml_type === 'notebook') {
    if ((meta.code_cell_count || 0) >= 5) score += 5;
    if ((meta.markdown_cell_count || 0) >= 3) score += 5;
    if (meta.has_visualizations) score += 5;
    if (meta.has_data_loading) score += 5;
  } else if (meta.ml_type === 'model-card') {
    if (meta.license) score += 5;
    if (meta.pipeline_tag) score += 5;
    if ((meta.languages || []).length > 0) score += 5;
    if ((meta.tags || []).length >= 3) score += 5;
  } else {
    // Training configs
    const importCount = (meta.imports || []).length;
    if (importCount >= 3) score += 5;
    if (importCount >= 5) score += 5;
    if (meta.has_model_training) score += 5;
    if (hpCount >= 3) score += 5;
  }

  return Math.min(score, 100);
}
