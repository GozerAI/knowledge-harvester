// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Workflow Validator — Linting and validation for workflow artifacts.
 *
 * Checks:
 *   - Node connectivity: all nodes reachable, no orphans
 *   - Missing credentials: referenced credential names not in a configured set
 *   - Error handling: presence of error/catch node types
 *
 * Returns { is_connected, missing_credentials, has_error_handling, validation_score }.
 */

// Node type patterns that represent error handling
const ERROR_NODE_TYPES = new Set([
  'n8n-nodes-base.errorTrigger',
  'n8n-nodes-base.stopAndError',
  'n8n-nodes-base.set',  // Often used for error state setting
  '@n8n/n8n-nodes-langchain.chainLlm', // LLM chains can have fallback
]);

const ERROR_TYPE_PATTERNS = [
  /error/i,
  /catch/i,
  /fallback/i,
  /onError/i,
  /fail/i,
];

/**
 * Validate a workflow artifact.
 *
 * @param {string|object} content - Workflow content (JSON string or parsed object)
 * @param {object} typeMetadata - Existing type_metadata from normalization
 * @returns {{ is_connected: boolean, missing_credentials: string[], has_error_handling: boolean, validation_score: number }}
 */
export function validateWorkflow(content, typeMetadata) {
  // Parse content if it's a string
  let workflowData = null;

  if (content && typeof content === 'object' && !Array.isArray(content)) {
    workflowData = content;
  } else if (typeof content === 'string') {
    try {
      workflowData = JSON.parse(content);
    } catch {
      // Non-JSON workflow (code-based like Python Airflow DAGs, etc.)
      return validateCodeWorkflow(content, typeMetadata);
    }
  } else if (content === null || content === undefined || content === '') {
    return { is_connected: false, missing_credentials: [], has_error_handling: false, validation_score: 0 };
  }

  // Handle n8n-style workflow with nodes + connections
  if (workflowData && (workflowData.nodes || workflowData.workflow?.nodes)) {
    return validateN8nWorkflow(workflowData, typeMetadata);
  }

  // Handle generic node-based workflow
  if (workflowData && Array.isArray(workflowData.nodes)) {
    return validateGenericNodeWorkflow(workflowData, typeMetadata);
  }

  // Fallback: treat as raw content
  return validateCodeWorkflow(typeof content === 'string' ? content : JSON.stringify(content), typeMetadata);
}

// ── n8n Workflow Validation ──

function validateN8nWorkflow(workflowData, typeMetadata) {
  const wf = workflowData.workflow || workflowData;
  const nodes = Array.isArray(wf.nodes) ? wf.nodes : [];
  const connections = wf.connections || {};

  const missing_credentials = [];
  const has_error_handling = detectErrorHandling(nodes);

  // ── Connectivity ──
  const is_connected = checkN8nConnectivity(nodes, connections);

  // ── Missing credentials ──
  const configuredCredentials = new Set(
    (typeMetadata?.credentials_required || []).map(c => (typeof c === 'string' ? c : c.name))
  );

  for (const node of nodes) {
    if (!node.credentials) continue;
    for (const [credType, credDef] of Object.entries(node.credentials)) {
      const credName = typeof credDef === 'object' ? credDef.name : credDef;
      if (credName && !configuredCredentials.has(credName) && !configuredCredentials.has(credType)) {
        missing_credentials.push(credName || credType);
      }
    }
  }

  const validation_score = calculateWorkflowScore({ is_connected, missing_credentials, has_error_handling, nodeCount: nodes.length });

  return {
    is_connected,
    missing_credentials: [...new Set(missing_credentials)],
    has_error_handling,
    validation_score,
  };
}

/**
 * Check n8n connectivity: every node (except trigger) should be reachable
 * from at least one connection, or be a source of connections.
 */
function checkN8nConnectivity(nodes, connections) {
  if (nodes.length === 0) return true;
  if (nodes.length === 1) return true;

  const nodeNames = new Set(nodes.map(n => n.name).filter(Boolean));
  const connected = new Set();

  // Nodes that are sources of connections
  for (const [sourceName, outputs] of Object.entries(connections)) {
    connected.add(sourceName);
    // Nodes that are targets of connections
    for (const outputGroup of Object.values(outputs)) {
      for (const connections_arr of outputGroup) {
        for (const conn of (connections_arr || [])) {
          if (conn?.node) connected.add(conn.node);
        }
      }
    }
  }

  // Orphan = a node that has no connections at all and is not a trigger
  let orphanCount = 0;
  for (const node of nodes) {
    if (!node.name) continue;
    const isTrigger = /trigger/i.test(node.type || '') || /trigger/i.test(node.name || '');
    if (!connected.has(node.name) && !isTrigger) {
      orphanCount++;
    }
  }

  // Allow up to 1 orphan for single-output utility nodes
  return orphanCount <= 1;
}

function detectErrorHandling(nodes) {
  for (const node of nodes) {
    const nodeType = node.type || '';
    if (ERROR_NODE_TYPES.has(nodeType)) return true;

    const nodeName = node.name || '';
    for (const pattern of ERROR_TYPE_PATTERNS) {
      if (pattern.test(nodeType) || pattern.test(nodeName)) return true;
    }

    // Check if node has continueOnFail set
    if (node.parameters?.continueOnFail === true) return true;
    if (node.onError === 'continueErrorOutput' || node.onError === 'continueRegularOutput') return true;
  }
  return false;
}

// ── Generic Node Workflow Validation ──

function validateGenericNodeWorkflow(workflowData, typeMetadata) {
  const nodes = workflowData.nodes || [];
  const edges = workflowData.edges || workflowData.connections || [];
  const missing_credentials = [];

  const is_connected = checkGenericConnectivity(nodes, edges);
  const has_error_handling = detectErrorHandlingGeneric(nodes);

  // Credential refs — look for credential_id or credential fields
  for (const node of nodes) {
    const credRef = node.credential_id || node.credentials || node.auth;
    if (credRef && typeof credRef === 'string') {
      // We don't have a configured set to compare against, so flag non-empty refs
      // that look like placeholder values
      if (/placeholder|<[^>]+>|YOUR_/.test(credRef)) {
        missing_credentials.push(credRef);
      }
    }
  }

  const validation_score = calculateWorkflowScore({ is_connected, missing_credentials, has_error_handling, nodeCount: nodes.length });

  return {
    is_connected,
    missing_credentials: [...new Set(missing_credentials)],
    has_error_handling,
    validation_score,
  };
}

function checkGenericConnectivity(nodes, edges) {
  if (nodes.length <= 1) return true;

  const nodeIds = new Set(nodes.map(n => n.id || n.name).filter(Boolean));
  const connected = new Set();

  for (const edge of edges) {
    if (edge.source) connected.add(edge.source);
    if (edge.target) connected.add(edge.target);
    if (edge.from) connected.add(edge.from);
    if (edge.to) connected.add(edge.to);
  }

  // Count how many nodes are isolated
  let isolated = 0;
  for (const id of nodeIds) {
    if (!connected.has(id)) isolated++;
  }

  return isolated === 0 || isolated / nodeIds.size < 0.2;
}

function detectErrorHandlingGeneric(nodes) {
  for (const node of nodes) {
    const typeStr = (node.type || node.kind || '').toLowerCase();
    const nameStr = (node.name || node.label || '').toLowerCase();
    for (const pattern of ERROR_TYPE_PATTERNS) {
      if (pattern.test(typeStr) || pattern.test(nameStr)) return true;
    }
  }
  return false;
}

// ── Code-based Workflow Validation (Airflow, Prefect, etc.) ──

function validateCodeWorkflow(content, typeMetadata) {
  const src = typeof content === 'string' ? content : '';
  const missing_credentials = [];

  // Connectivity: look for task dependencies (>> or << in Airflow, .set_upstream/downstream)
  const hasTaskDeps = />>/.test(src) || /<</.test(src) ||
    /\.set_upstream\b/.test(src) || /\.set_downstream\b/.test(src) ||
    /depends_on\s*=/.test(src) || /upstream_tasks\s*=/.test(src) ||
    /after\s*\(/.test(src);

  // For code workflows, connectivity is inferred from task dependency declarations
  const is_connected = hasTaskDeps || (src.match(/@task\b/g) || []).length <= 1;

  // Error handling: try/except, on_failure_callback, catch blocks
  const has_error_handling =
    (/\btry\s*:/.test(src) && /\bexcept\b/.test(src)) ||
    /on_failure_callback\s*=/.test(src) ||
    /on_retry_callback\s*=/.test(src) ||
    /retries\s*=\s*[1-9]/.test(src) ||
    /\.catch\s*\(/.test(src);

  // Credential refs: look for placeholder patterns
  const credRefs = src.match(/(?:password|api_key|token|secret)\s*=\s*['"]<[^>]+>['"]/gi) || [];
  for (const ref of credRefs) {
    missing_credentials.push(ref.split('=')[0].trim());
  }

  const taskCount = (src.match(/@task\b/g) || src.match(/\bPythonOperator\b/g) || []).length;
  const nodeCount = Math.max(taskCount, 1);

  const validation_score = calculateWorkflowScore({ is_connected, missing_credentials, has_error_handling, nodeCount });

  return {
    is_connected,
    missing_credentials: [...new Set(missing_credentials)],
    has_error_handling,
    validation_score,
  };
}

/**
 * Calculate validation score for a workflow (0-100).
 */
function calculateWorkflowScore({ is_connected, missing_credentials, has_error_handling, nodeCount }) {
  let score = 100;

  if (!is_connected) score -= 35;
  if (!has_error_handling) score -= 20;

  // Each missing credential deducts up to -30 total
  score -= Math.min(missing_credentials.length * 10, 30);

  // Bonus for non-trivial workflows
  if (nodeCount >= 3) score = Math.min(100, score + 5);

  return Math.max(0, Math.min(100, score));
}
