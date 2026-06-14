// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Infrastructure Config Scorer — Quality scoring for infra artifacts.
 *
 * Scores 0-100 based on:
 *   - Completeness (0-30): has name, description, documentation
 *   - Complexity value (0-25): resource/service count, module usage
 *   - Source quality (0-20): based on source type
 *   - Usability (0-25): has variables, outputs, is self-contained
 */

import { db } from '../../../db/client.js';
import { logger } from '../../../utils/logger.js';

/**
 * Score unscored infra_config artifacts.
 */
export async function scoreInfraConfigs(limit = 100) {
  const result = await db.query(
    `SELECT id, name, description, source, tool_type, type_metadata
     FROM artifacts
     WHERE artifact_type = 'infra_config' AND quality_score = 0
     ORDER BY discovered_at DESC
     LIMIT $1`,
    [limit]
  );

  if (result.rows.length === 0) {
    logger.info('No infra configs to score');
    return { scored: 0 };
  }

  logger.info(`Scoring ${result.rows.length} infra configs`);
  let scored = 0;

  for (const row of result.rows) {
    const meta = typeof row.type_metadata === 'string'
      ? JSON.parse(row.type_metadata) : (row.type_metadata || {});
    const score = calculateInfraScore(row, meta);

    await db.query(
      'UPDATE artifacts SET quality_score = $1 WHERE id = $2',
      [score, row.id]
    );
    scored++;
  }

  logger.info('Infra config scoring complete', { scored });
  return { scored };
}

/**
 * Calculate quality score for an infra config artifact.
 */
export function calculateInfraScore(row, meta) {
  let score = 0;

  // ── Completeness (0-30) ──
  if (row.name && !row.name.includes('Untitled')) score += 10;
  if (row.description?.length > 20) score += 10;
  if (row.description?.length > 100) score += 10;

  // ── Complexity value (0-25) ──
  const resourceCount = meta.resource_count || meta.service_count || meta.container_count || meta.task_count || 0;
  if (resourceCount >= 1) score += 5;
  if (resourceCount >= 3) score += 5;
  if (resourceCount >= 5) score += 5;
  if (resourceCount >= 10) score += 5;

  // Module/dependency usage
  const modules = meta.modules || meta.modules_used || meta.dependencies || [];
  if (modules.length > 0) score += 5;

  // ── Source quality (0-20) ──
  const sourceScores = {
    'terraform': 12,
    'helm': 12,
    'ansible': 12,
    'k8s-manifests': 10,
    'docker-compose': 10,
  };
  score += sourceScores[row.source] || 10;

  // ── Usability (0-25) ──
  // Variables/configurability
  const varCount = meta.variables_count || meta.values_keys?.length || 0;
  if (varCount >= 1) score += 5;
  if (varCount >= 5) score += 5;

  // Outputs/documentation
  const hasOutputs = (meta.outputs_count || 0) > 0;
  if (hasOutputs) score += 5;

  // Self-contained (has providers/images specified)
  const hasProviders = (meta.providers?.length || meta.images?.length || 0) > 0;
  if (hasProviders) score += 5;

  // Health/observability
  const hasHealth = meta.has_healthcheck || meta.has_probes || meta.has_handlers || false;
  if (hasHealth) score += 5;

  return Math.min(score, 100);
}
