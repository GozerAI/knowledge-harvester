// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Unified Pipeline Orchestrator — Runs the processing pipeline
 * for both legacy workflows (workflows table) and new artifacts (artifacts table).
 *
 * The pipeline is the same sequence regardless of artifact type:
 *   migrate → harvest → classify → score → embed → package → guide →
 *   complexity → migrations → compose → facets
 *
 * For each step, the orchestrator dispatches to the appropriate strategy
 * based on artifact_type, falling back to the existing workflow-specific
 * processors for backward compatibility.
 */

import { logger } from '../utils/logger.js';
import { getStrategy, ARTIFACT_TYPES } from './registry.js';

/**
 * Run a specific processing phase for a given artifact type.
 * Falls back to null if no strategy is registered.
 *
 * @param {string} artifactType - The artifact type to process
 * @param {string} phase - The phase to run
 * @param  {...any} args - Arguments for the strategy function
 * @returns {any} Result from the strategy, or null if no strategy found
 */
export async function runPhase(artifactType, phase, ...args) {
  const strategy = getStrategy(artifactType, phase);
  if (!strategy) {
    logger.debug(`No strategy registered for ${artifactType}:${phase}, skipping`);
    return null;
  }
  logger.info(`Running ${phase} for ${artifactType}`);
  return strategy(...args);
}

/**
 * Run a processing phase across all registered artifact types.
 *
 * @param {string} phase - The phase to run
 * @param  {...any} args - Arguments passed to each strategy
 * @returns {Map<string, any>} Results keyed by artifact type
 */
export async function runPhaseAll(phase, ...args) {
  const results = new Map();
  for (const type of ARTIFACT_TYPES) {
    const strategy = getStrategy(type, phase);
    if (strategy) {
      try {
        results.set(type, await strategy(...args));
      } catch (err) {
        logger.error(`Phase ${phase} failed for ${type}`, { error: err.message });
        results.set(type, { error: err.message });
      }
    }
  }
  return results;
}

/**
 * Get stats across both workflows and artifacts tables.
 *
 * @returns {{ workflows: object, artifacts: object }}
 */
export async function getUnifiedStats(db) {
  const workflowStats = await db.query(`
    SELECT
      source, tool_type,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE quality_score >= 70) as high_quality,
      ROUND(AVG(quality_score)) as avg_quality,
      COUNT(*) FILTER (WHERE primary_category IS NOT NULL) as classified
    FROM workflows
    GROUP BY source, tool_type
    ORDER BY total DESC
  `);

  const artifactStats = await db.query(`
    SELECT
      artifact_type, source, tool_type,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE quality_score >= 70) as high_quality,
      ROUND(AVG(quality_score)) as avg_quality,
      COUNT(*) FILTER (WHERE primary_category IS NOT NULL) as classified
    FROM artifacts
    GROUP BY artifact_type, source, tool_type
    ORDER BY total DESC
  `);

  const artifactTotals = await db.query(`
    SELECT artifact_type, COUNT(*) as count
    FROM artifacts GROUP BY artifact_type ORDER BY count DESC
  `);

  return {
    workflows: workflowStats.rows,
    artifacts: artifactStats.rows,
    artifact_totals: artifactTotals.rows,
  };
}
