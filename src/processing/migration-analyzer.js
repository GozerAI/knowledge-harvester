// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';

/**
 * Analyze workflows and suggest cross-tool migrations.
 * For each workflow, finds similar workflows in other tool types
 * using embedding similarity.
 *
 * @param {number} limit - Max number of workflows to analyze
 * @returns {{ analyzed: number, suggestions: number }}
 */
export async function analyzeMigrations(limit = 50) {
  const result = await db.query(
    `SELECT w.id, w.workflow_name, w.tool_type, w.primary_category,
            w.node_types, w.estimated_complexity, w.embedding
     FROM workflows w
     LEFT JOIN workflow_migrations m ON m.source_workflow_id = w.id
     WHERE w.quality_score >= 60 AND w.embedding IS NOT NULL AND m.id IS NULL
     ORDER BY w.quality_score DESC
     LIMIT $1`,
    [limit]
  );

  if (result.rows.length === 0) {
    logger.info('No workflows to analyze for migrations');
    return { analyzed: 0, suggestions: 0 };
  }

  logger.info(`Analyzing ${result.rows.length} workflows for migration suggestions`);
  let analyzed = 0;
  let suggestions = 0;

  for (const row of result.rows) {
    try {
      // Find similar workflows in different tool types using cosine similarity
      const similar = await db.query(
        `SELECT id, workflow_name, tool_type, primary_category,
                estimated_complexity, quality_score,
                1 - (embedding <=> $1) as similarity
         FROM workflows
         WHERE tool_type != $2 AND embedding IS NOT NULL AND quality_score >= 40
         ORDER BY embedding <=> $1
         LIMIT 5`,
        [row.embedding, row.tool_type]
      );

      for (const match of similar.rows) {
        if (match.similarity < 0.5) continue;

        const difficulty = assessMigrationDifficulty(row, match);
        const notes = generateMigrationNotes(row, match);

        await db.query(
          `INSERT INTO workflow_migrations
             (source_workflow_id, target_tool_type, migration_difficulty,
              migration_notes, equivalent_workflow_id, confidence)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (source_workflow_id, target_tool_type) DO NOTHING`,
          [row.id, match.tool_type, difficulty, notes, match.id, match.similarity]
        );
        suggestions++;
      }
      analyzed++;
    } catch (err) {
      logger.error('Migration analysis failed', { id: row.id, error: err.message });
    }
  }

  logger.info('Migration analysis complete', { analyzed, suggestions });
  return { analyzed, suggestions };
}

// Tool ecosystem compatibility groups
export const TOOL_GROUPS = {
  'python-orchestration': ['airflow', 'prefect', 'dagster', 'luigi'],
  'ai-agent': ['langchain', 'crewai', 'autogen', 'langgraph', 'dify', 'flowise'],
  'no-code-automation': ['n8n', 'zapier', 'make', 'activepieces', 'pipedream', 'ifttt'],
  'k8s-native': ['argo', 'tekton'],
  'ci-cd': ['github-actions', 'tekton'],
  'data-engineering': ['airflow', 'prefect', 'dagster', 'dbt', 'luigi'],
  'streaming': ['kafka-connect', 'camel', 'node-red'],
  'enterprise-bpm': ['camunda', 'camel'],
};

/**
 * Assess how difficult a migration would be between two workflows.
 * Tools in the same ecosystem group are easier to migrate between.
 *
 * @param {object} source - Source workflow row
 * @param {object} target - Target workflow row
 * @returns {'easy'|'moderate'|'hard'}
 */
export function assessMigrationDifficulty(source, target) {
  // Check if tools are in the same ecosystem group
  for (const tools of Object.values(TOOL_GROUPS)) {
    if (tools.includes(source.tool_type) && tools.includes(target.tool_type)) {
      return 'easy';
    }
  }

  // Cross-ecosystem migration is harder
  const complexityDiff = complexityOrdinal(target.estimated_complexity) -
                          complexityOrdinal(source.estimated_complexity);
  if (Math.abs(complexityDiff) > 1) return 'hard';

  return 'moderate';
}

function complexityOrdinal(complexity) {
  const map = { simple: 0, moderate: 1, complex: 2 };
  return map[complexity] ?? 1;
}

/**
 * Generate human-readable migration notes.
 *
 * @param {object} source - Source workflow row
 * @param {object} target - Target/match workflow row
 * @returns {string}
 */
export function generateMigrationNotes(source, target) {
  const sameCategory = source.primary_category === target.primary_category;
  const parts = [];

  parts.push(`Migrate from ${source.tool_type} to ${target.tool_type}`);
  if (sameCategory) {
    parts.push(`Both serve ${source.primary_category} use cases`);
  }
  parts.push(`Target workflow: "${target.workflow_name}" (quality: ${target.quality_score})`);

  return parts.join('. ') + '.';
}
