// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';

/**
 * Multi-dimensional complexity scoring (0-100 across 5 dimensions of 0-20 each).
 *
 * Dimensions:
 *   - Structural (0-20): node count, branching/parallel, loops
 *   - Integration (0-20): unique external services, credential count
 *   - Logic (0-20): code nodes, conditional logic, error handling
 *   - Data (0-20): data transformation steps, schema manipulation
 *   - Operational (0-20): scheduling, retry logic, monitoring
 *
 * Pipeline step: runs after classification/scoring.
 */

/**
 * Analyze complexity for workflows that haven't been scored yet.
 *
 * @param {number} limit - Max number of workflows to analyze
 * @returns {{ analyzed: number }}
 */
export async function analyzeComplexity(limit = 100) {
  const result = await db.query(
    `SELECT id, workflow_name, workflow_json, node_count, node_types,
            has_code_node, trigger_type, credentials_required,
            estimated_complexity, tool_type
     FROM workflows
     WHERE complexity_score = 0 AND quality_score > 0
     ORDER BY quality_score DESC
     LIMIT $1`,
    [limit]
  );

  if (result.rows.length === 0) {
    logger.info('No workflows to analyze for complexity');
    return { analyzed: 0 };
  }

  logger.info(`Analyzing complexity for ${result.rows.length} workflows`);
  let analyzed = 0;

  for (const row of result.rows) {
    try {
      const breakdown = calculateComplexityBreakdown(row);

      await db.query(
        `UPDATE workflows
         SET complexity_score = $1, complexity_breakdown = $2
         WHERE id = $3`,
        [breakdown.total, JSON.stringify(breakdown), row.id]
      );
      analyzed++;
    } catch (err) {
      logger.error('Complexity analysis failed', { id: row.id, error: err.message });
    }
  }

  logger.info('Complexity analysis complete', { analyzed });
  return { analyzed };
}

/**
 * Calculate multi-dimensional complexity breakdown for a workflow.
 *
 * @param {object} row - Workflow row from DB
 * @returns {{ structural: number, integration: number, logic: number, data: number, operational: number, total: number }}
 */
export function calculateComplexityBreakdown(row) {
  const structural = scoreStructural(row);
  const integration = scoreIntegration(row);
  const logic = scoreLogic(row);
  const data = scoreData(row);
  const operational = scoreOperational(row);
  const total = structural + integration + logic + data + operational;

  return { structural, integration, logic, data, operational, total };
}

// ── Structural (0-20): node count, branching/parallel, loops ──

function scoreStructural(row) {
  let score = 0;
  const nodeCount = row.node_count || 0;
  const json = row.workflow_json || {};
  const nodeTypes = row.node_types || [];

  // Node count scaling
  if (nodeCount >= 3) score += 2;
  if (nodeCount >= 6) score += 3;
  if (nodeCount >= 10) score += 3;
  if (nodeCount >= 20) score += 2;

  // Branching / parallel paths
  const connections = json.connections || json.edges || {};
  const connectionCount = typeof connections === 'object'
    ? Object.keys(connections).length
    : 0;
  if (connectionCount > nodeCount) score += 3; // More connections than nodes = branching
  if (connectionCount > nodeCount * 1.5) score += 2;

  // Loops / iteration patterns
  const loopIndicators = ['SplitInBatches', 'Loop', 'foreach', 'map', 'Iterator', 'while'];
  const hasLoop = nodeTypes.some(t =>
    loopIndicators.some(l => t.toLowerCase().includes(l.toLowerCase()))
  );
  if (hasLoop) score += 5;

  return Math.min(score, 20);
}

// ── Integration (0-20): unique external services, credential count ──

function scoreIntegration(row) {
  let score = 0;
  const creds = row.credentials_required || [];
  const nodeTypes = row.node_types || [];

  // Credential count
  if (creds.length >= 1) score += 3;
  if (creds.length >= 3) score += 4;
  if (creds.length >= 5) score += 3;

  // Unique service types (heuristic: distinct node type prefixes)
  const servicePrefixes = new Set(
    nodeTypes.map(t => t.split(/[._]/)[0].toLowerCase()).filter(Boolean)
  );
  if (servicePrefixes.size >= 2) score += 3;
  if (servicePrefixes.size >= 4) score += 4;
  if (servicePrefixes.size >= 6) score += 3;

  return Math.min(score, 20);
}

// ── Logic (0-20): code nodes, conditional logic, error handling ──

function scoreLogic(row) {
  let score = 0;
  const nodeTypes = row.node_types || [];

  // Code nodes
  if (row.has_code_node) score += 6;

  // Conditional logic
  const conditionalIndicators = ['IF', 'Switch', 'Filter', 'condition', 'branch', 'Choice'];
  const hasConditional = nodeTypes.some(t =>
    conditionalIndicators.some(c => t.toLowerCase().includes(c.toLowerCase()))
  );
  if (hasConditional) score += 5;

  // Error handling
  const errorIndicators = ['ErrorTrigger', 'catch', 'retry', 'error', 'fallback', 'ErrorHandler'];
  const hasErrorHandling = nodeTypes.some(t =>
    errorIndicators.some(e => t.toLowerCase().includes(e.toLowerCase()))
  );
  if (hasErrorHandling) score += 5;

  // Multiple code/function nodes
  const codeNodeCount = nodeTypes.filter(t =>
    ['Code', 'Function', 'Script', 'Execute', 'python', 'javascript'].some(c =>
      t.toLowerCase().includes(c.toLowerCase())
    )
  ).length;
  if (codeNodeCount >= 2) score += 4;

  return Math.min(score, 20);
}

// ── Data (0-20): data transformation steps, schema manipulation ──

function scoreData(row) {
  let score = 0;
  const nodeTypes = row.node_types || [];
  const json = row.workflow_json || {};

  // Data transformation nodes
  const dataIndicators = [
    'Set', 'Merge', 'Aggregate', 'Transform', 'Map', 'Reduce',
    'Spreadsheet', 'CSV', 'JSON', 'XML', 'HTML', 'Markdown',
    'ItemLists', 'SplitOut', 'Concatenate',
  ];
  const dataNodeCount = nodeTypes.filter(t =>
    dataIndicators.some(d => t.toLowerCase().includes(d.toLowerCase()))
  ).length;

  if (dataNodeCount >= 1) score += 4;
  if (dataNodeCount >= 3) score += 4;
  if (dataNodeCount >= 5) score += 4;

  // Database/storage interactions
  const storageIndicators = [
    'Postgres', 'MySQL', 'MongoDB', 'Redis', 'S3', 'GCS',
    'BigQuery', 'Snowflake', 'SQLite', 'Elasticsearch',
  ];
  const hasStorage = nodeTypes.some(t =>
    storageIndicators.some(s => t.toLowerCase().includes(s.toLowerCase()))
  );
  if (hasStorage) score += 4;

  // Schema complexity (JSON depth in workflow_json as proxy)
  const jsonStr = JSON.stringify(json);
  if (jsonStr.length > 5000) score += 2;
  if (jsonStr.length > 20000) score += 2;

  return Math.min(score, 20);
}

// ── Operational (0-20): scheduling, retry logic, monitoring ──

function scoreOperational(row) {
  let score = 0;
  const nodeTypes = row.node_types || [];
  const triggerType = row.trigger_type || '';

  // Scheduling
  if (triggerType === 'cron' || triggerType === 'schedule') score += 5;

  // Retry / wait logic
  const retryIndicators = ['Wait', 'Delay', 'Retry', 'Backoff', 'timeout', 'Sleep'];
  const hasRetry = nodeTypes.some(t =>
    retryIndicators.some(r => t.toLowerCase().includes(r.toLowerCase()))
  );
  if (hasRetry) score += 5;

  // Monitoring / alerting
  const monitorIndicators = [
    'Slack', 'Email', 'Telegram', 'Discord', 'PagerDuty',
    'Webhook', 'Notification', 'Alert', 'SMS',
  ];
  const monitorCount = nodeTypes.filter(t =>
    monitorIndicators.some(m => t.toLowerCase().includes(m.toLowerCase()))
  ).length;
  if (monitorCount >= 1) score += 4;
  if (monitorCount >= 3) score += 3;

  // Webhook trigger (operational integration point)
  if (triggerType === 'webhook') score += 3;

  return Math.min(score, 20);
}
