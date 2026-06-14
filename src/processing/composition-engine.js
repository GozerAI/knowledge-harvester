// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';

/**
 * Composition Engine — Identifies workflows that can be combined into
 * larger pipelines. Finds complementary pairs/groups based on category
 * compatibility, tool overlap, and credential sharing.
 *
 * Pipeline step: runs after classification and scoring.
 */

// Category flow rules: source_category → compatible downstream categories
const CATEGORY_FLOWS = {
  'data-processing':       ['data-pipeline', 'ml-data-ops', 'devops-monitoring'],
  'data-pipeline':         ['ml-data-ops', 'data-processing', 'devops-monitoring'],
  'lead-gen-crm':          ['customer-support', 'content-marketing', 'ecommerce'],
  'customer-support':      ['lead-gen-crm', 'content-marketing'],
  'content-marketing':     ['lead-gen-crm', 'ecommerce'],
  'ai-agent':              ['data-processing', 'content-marketing', 'customer-support'],
  'integration-pipeline':  ['data-pipeline', 'data-processing', 'devops-monitoring'],
  'orchestration':         ['data-pipeline', 'devops-monitoring', 'ml-data-ops'],
  'ml-data-ops':           ['ai-agent', 'data-processing', 'devops-monitoring'],
  'devops-monitoring':     ['orchestration', 'security-automation'],
  'security-automation':   ['devops-monitoring'],
  'ecommerce':             ['finance-accounting', 'customer-support', 'content-marketing'],
  'finance-accounting':    ['ecommerce', 'data-processing'],
  'ai-image-generation':   ['content-marketing', 'ecommerce'],
  'multi-step-automation': ['data-processing', 'integration-pipeline'],
  'general-productivity':  ['content-marketing', 'data-processing'],
};

/**
 * Generate workflow compositions by finding complementary workflows
 * that could be combined into larger pipelines.
 *
 * @param {number} limit - Max number of source workflows to consider
 * @returns {{ compositions: number }}
 */
export async function generateCompositions(limit = 50) {
  const result = await db.query(
    `SELECT id, workflow_name, tool_type, primary_category,
            credentials_required, quality_score, node_types
     FROM workflows
     WHERE quality_score >= 50 AND primary_category IS NOT NULL
     ORDER BY quality_score DESC
     LIMIT $1`,
    [limit]
  );

  if (result.rows.length === 0) {
    logger.info('No workflows available for composition');
    return { compositions: 0 };
  }

  logger.info(`Finding compositions among ${result.rows.length} workflows`);
  let compositions = 0;
  const seen = new Set();

  for (const source of result.rows) {
    const compatible = findCompatibleWorkflows(source, result.rows);

    for (const target of compatible) {
      // Deduplicate: sort IDs to create a stable key
      const pairKey = [source.id, target.id].sort().join(':');
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      const compositionType = source.tool_type === target.tool_type
        ? 'sequential'
        : 'cross-tool';

      const name = `${source.workflow_name} → ${target.workflow_name}`;
      const description = buildCompositionDescription(source, target);
      const connections = buildSuggestedConnections(source, target);
      const totalQuality = source.quality_score + target.quality_score;

      try {
        await db.query(
          `INSERT INTO workflow_compositions
             (name, description, component_workflow_ids, composition_type,
              suggested_connections, total_quality_score)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            name,
            description,
            [source.id, target.id],
            compositionType,
            JSON.stringify(connections),
            totalQuality,
          ]
        );
        compositions++;
      } catch (err) {
        logger.error('Failed to insert composition', {
          source: source.id,
          target: target.id,
          error: err.message,
        });
      }
    }
  }

  logger.info('Composition generation complete', { compositions });
  return { compositions };
}

/**
 * Find workflows that are compatible with the given source workflow
 * for pipeline composition.
 *
 * Compatibility criteria:
 *   - Category compatibility (source category feeds into target category)
 *   - Same tool_type preferred but cross-tool also valid
 *   - Credential overlap bonus (shared services = easier to compose)
 *
 * @param {object} workflow - Source workflow row
 * @param {object[]} candidates - Array of candidate workflow rows
 * @returns {object[]} Compatible workflows sorted by compatibility score
 */
export function findCompatibleWorkflows(workflow, candidates) {
  const sourceCategory = workflow.primary_category;
  const compatibleCategories = CATEGORY_FLOWS[sourceCategory] || [];

  if (compatibleCategories.length === 0) return [];

  const scored = [];

  for (const candidate of candidates) {
    if (candidate.id === workflow.id) continue;
    if (!compatibleCategories.includes(candidate.primary_category)) continue;

    let score = 0;

    // Category compatibility (base score)
    score += 10;

    // Same tool_type bonus
    if (candidate.tool_type === workflow.tool_type) {
      score += 5;
    }

    // Credential overlap bonus (shared services = easier integration)
    const sourceCreds = new Set(workflow.credentials_required || []);
    const targetCreds = candidate.credentials_required || [];
    const sharedCreds = targetCreds.filter(c => sourceCreds.has(c));
    score += sharedCreds.length * 3;

    // Quality bonus
    if (candidate.quality_score >= 70) score += 3;
    if (candidate.quality_score >= 90) score += 2;

    scored.push({ ...candidate, _compatibilityScore: score });
  }

  // Sort by compatibility score descending, take top 3
  scored.sort((a, b) => b._compatibilityScore - a._compatibilityScore);
  return scored.slice(0, 3);
}

function buildCompositionDescription(source, target) {
  const parts = [
    `Pipeline combining ${source.primary_category} and ${target.primary_category} workflows.`,
  ];

  if (source.tool_type === target.tool_type) {
    parts.push(`Both use ${source.tool_type}.`);
  } else {
    parts.push(`Cross-tool: ${source.tool_type} → ${target.tool_type}.`);
  }

  // Mention shared credentials
  const sourceCreds = new Set(source.credentials_required || []);
  const shared = (target.credentials_required || []).filter(c => sourceCreds.has(c));
  if (shared.length > 0) {
    parts.push(`Shared credentials: ${shared.join(', ')}.`);
  }

  return parts.join(' ');
}

function buildSuggestedConnections(source, target) {
  const connections = [];

  // Suggest output-to-input connection
  connections.push({
    from: { workflow_id: source.id, type: 'output' },
    to: { workflow_id: target.id, type: 'input' },
    method: source.tool_type === target.tool_type ? 'native' : 'webhook',
    notes: `Connect ${source.workflow_name} output to ${target.workflow_name} input`,
  });

  return connections;
}
