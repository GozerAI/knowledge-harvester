// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Count total connections in an n8n workflow.
 * Handles the nested format: { "NodeName": { "main": [[{node,type,index}]] } }
 */
export function countConnections(workflow) {
  let count = 0;
  for (const [, nodeConns] of Object.entries(workflow.connections || {})) {
    for (const [, outputs] of Object.entries(nodeConns)) {
      if (Array.isArray(outputs)) {
        for (const outputGroup of outputs) {
          if (Array.isArray(outputGroup)) {
            count += outputGroup.length;
          }
        }
      }
    }
  }
  return count;
}

/**
 * Detect the trigger type of a workflow.
 * Returns: 'webhook' | 'cron' | 'event' | 'manual'
 */
export function detectTriggerType(workflow) {
  const triggerNodes = (workflow.nodes || []).filter(n =>
    n.type?.includes('Trigger') ||
    n.type?.includes('trigger') ||
    n.type === 'n8n-nodes-base.webhook' ||
    n.type === 'n8n-nodes-base.cron' ||
    n.type === 'n8n-nodes-base.scheduleTrigger'
  );

  if (triggerNodes.length === 0) return 'manual';

  const t = triggerNodes[0].type;
  if (t.includes('webhook') || t.includes('Webhook')) return 'webhook';
  if (t.includes('cron') || t.includes('schedule') || t.includes('Schedule')) return 'cron';
  if (t.includes('Trigger') || t.includes('trigger')) return 'event';
  return 'other';
}

/**
 * Extract normalized credential type names from workflow nodes.
 */
export function extractCredentials(workflow) {
  const creds = new Set();
  for (const node of workflow.nodes || []) {
    if (node.credentials) {
      for (const credType of Object.keys(node.credentials)) {
        const normalized = credType
          .replace(/Api$/i, '')
          .replace(/OAuth2$/i, '')
          .replace(/Credentials$/i, '')
          .toLowerCase();
        creds.add(normalized);
      }
    }
  }
  return [...creds];
}

/**
 * Estimate workflow complexity: 'simple' | 'moderate' | 'complex'
 */
export function estimateComplexity(workflow) {
  const nodes = workflow.nodes || [];
  const nodeCount = nodes.length;
  const hasCodeNode = nodes.some(n =>
    n.type === 'n8n-nodes-base.code' ||
    n.type === 'n8n-nodes-base.function' ||
    n.type === 'n8n-nodes-base.functionItem'
  );
  const hasLoops = nodes.some(n =>
    n.type === 'n8n-nodes-base.splitInBatches' ||
    n.type?.includes('Loop')
  );
  const hasBranching = nodes.some(n =>
    n.type === 'n8n-nodes-base.if' ||
    n.type === 'n8n-nodes-base.switch'
  );

  let complexity = 0;
  if (nodeCount > 10) complexity++;
  if (nodeCount > 20) complexity++;
  if (hasCodeNode) complexity++;
  if (hasLoops) complexity++;
  if (hasBranching) complexity++;

  if (complexity >= 3) return 'complex';
  if (complexity >= 1) return 'moderate';
  return 'simple';
}

/**
 * Extract a human-readable name from a file path.
 * e.g. "workflows/lead-capture-crm.json" → "Lead Capture Crm"
 */
export function extractNameFromPath(filePath) {
  const filename = filePath.split('/').pop() || filePath;
  return filename
    .replace('.json', '')
    .replace(/-/g, ' ')
    .replace(/_/g, ' ')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
