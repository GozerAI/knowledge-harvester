// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';

/**
 * Score unscored workflows using the quality scoring algorithm from the spec.
 * Queries DB for workflows with quality_score=0, calculates a score, and updates.
 *
 * @param {number} limit - Max number of workflows to score in this run
 * @returns {{ scored: number }}
 */
export async function scoreWorkflows(limit = 100) {
  const result = await db.query(
    `SELECT id, workflow_name, original_description, source,
            node_count, has_code_node, trigger_type,
            credentials_required, has_description, has_documentation,
            workflow_json
     FROM workflows
     WHERE quality_score = 0
     ORDER BY discovered_at DESC
     LIMIT $1`,
    [limit]
  );

  if (result.rows.length === 0) {
    logger.info('No workflows to score');
    return { scored: 0 };
  }

  logger.info(`Scoring ${result.rows.length} workflows`);
  let scored = 0;

  for (const row of result.rows) {
    const score = calculateScore(row);
    await db.query(
      'UPDATE workflows SET quality_score = $1 WHERE id = $2',
      [score, row.id]
    );
    scored++;
  }

  logger.info('Scoring complete', { scored });
  return { scored };
}

/**
 * Quality scoring algorithm from the spec.
 * Scores 0-100 based on completeness, complexity, source quality, and usability.
 */
function calculateScore(w) {
  let score = 0;

  // ── Completeness (0-30 points) ──
  if (w.workflow_name && !w.workflow_name.includes('Untitled')) {
    score += 10;
  }
  if (w.original_description?.length > 50) score += 10;
  if (w.original_description?.length > 200) score += 10;

  // ── Complexity value (0-25 points) ──
  const nodeCount = w.node_count || 0;
  if (nodeCount >= 3) score += 5;
  if (nodeCount >= 5) score += 5;
  if (nodeCount >= 8) score += 5;
  if (nodeCount >= 12) score += 5;
  if (w.has_code_node) score += 5; // Custom logic = more valuable

  // ── Source quality (0-20 points) ──
  if (w.source === 'n8n-community') {
    score += 20; // Pre-validated by n8n team
  } else if (w.source === 'activepieces' || w.source === 'node-red') {
    score += 15; // Curated template/flow libraries
  } else if (w.source === 'github') {
    score += 10;
  } else if (w.source === 'windmill' || w.source === 'temporal' || w.source === 'airflow') {
    score += 10; // Code-based workflows from GitHub
  } else if (w.source === 'prefect' || w.source === 'dagster' || w.source === 'langgraph') {
    score += 10; // Code-based workflows from GitHub
  } else if (w.source === 'github-agents' || w.source === 'github-zapier-make') {
    score += 10;
  } else if (w.source === 'comfyui' || w.source === 'dify' || w.source === 'flowise') {
    score += 10; // Code-based workflows from GitHub
  } else if (w.source === 'pipedream' || w.source === 'argo' || w.source === 'luigi') {
    score += 10; // Code-based workflows from GitHub
  } else if (['tekton', 'github-actions', 'mlflow', 'dbt', 'camunda', 'kafka-connect', 'camel'].includes(w.source)) {
    score += 10;
  } else if (w.source === 'home-assistant') {
    score += 15; // Curated automation library
  } else if (w.source === 'reddit') {
    score += 5;
  }

  // ── Usability (0-25 points) ──
  const credCount = w.credentials_required?.length || 0;
  if (credCount === 0) {
    score += 10; // No auth required = easier to use
  } else if (credCount <= 2) {
    score += 5;
  }

  if (w.trigger_type === 'webhook') score += 5; // Common trigger patterns
  if (w.trigger_type === 'cron') score += 5;

  if (!w.has_code_node) score += 5; // No-code friendly

  return Math.min(score, 100);
}
