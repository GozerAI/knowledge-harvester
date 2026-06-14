// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { createHash } from 'node:crypto';

/**
 * Compute SHA-256 hex digest of a string.
 */
export function sha256(str) {
  return createHash('sha256').update(str).digest('hex');
}

/**
 * Generate a deterministic hash of an n8n workflow's structure.
 * Ignores node IDs, positions, and names — only considers node types
 * and connection topology (source type → target type).
 *
 * n8n connection format:
 *   connections = {
 *     "NodeName": {
 *       "main": [
 *         [ { "node": "TargetName", "type": "main", "index": 0 } ]
 *       ]
 *     }
 *   }
 */
export function generateWorkflowHash(workflowJson) {
  const nodes = workflowJson.nodes || [];

  // Build a lookup: node name/id → node type
  const nodeTypeMap = new Map();
  for (const n of nodes) {
    if (n.name) nodeTypeMap.set(n.name, n.type);
    if (n.id) nodeTypeMap.set(String(n.id), n.type);
  }

  const normalized = {
    // Sorted list of node types
    nodes: nodes
      .map(n => n.type)
      .filter(Boolean)
      .sort(),
    // Sorted list of "sourceType->targetType" connection strings
    connections: Object.entries(workflowJson.connections || {})
      .flatMap(([sourceName, connOutputs]) => {
        const sourceType = nodeTypeMap.get(sourceName) || 'unknown';
        // connOutputs = { main: [[{node, type, index}], ...] }
        return Object.values(connOutputs).flatMap(outputGroups => {
          if (!Array.isArray(outputGroups)) return [];
          return outputGroups.flatMap(group => {
            if (!Array.isArray(group)) return [];
            return group.map(c => {
              const targetType = nodeTypeMap.get(c.node) || 'unknown';
              return `${sourceType}->${targetType}`;
            });
          });
        });
      })
      .sort(),
  };

  return sha256(JSON.stringify(normalized));
}

/**
 * Generate a deterministic hash for generic content (non-n8n).
 * Used for AI agent code, Zapier configs, Make scenarios, etc.
 * Normalizes whitespace and sorts JSON keys for consistency.
 *
 * @param {string|object} content - Source code string or JSON config
 * @param {string} framework - Framework identifier (langchain, crewai, etc.)
 * @returns {string} SHA-256 hex digest
 */
export function generateContentHash(content, framework = 'generic') {
  let normalized;
  if (typeof content === 'string') {
    // For source code: strip comments, normalize whitespace
    normalized = content
      .replace(/\r\n/g, '\n')       // Normalize line endings
      .replace(/#.*$/gm, '')         // Strip Python comments
      .replace(/\/\/.*$/gm, '')      // Strip JS comments
      .replace(/\s+/g, ' ')          // Normalize whitespace
      .trim();
  } else {
    // For JSON configs: sort keys deterministically
    normalized = JSON.stringify(content, Object.keys(content).sort());
  }
  return sha256(`${framework}:${normalized}`);
}
