// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Strategy Registry — Maps (artifact_type, phase) to processing functions.
 *
 * Each artifact type can register its own normalize, classify, score,
 * package, and complexity strategies. The pipeline dispatches to the
 * registered strategy, falling back to a default if none is registered.
 *
 * Phases: 'normalize', 'classify', 'score', 'package', 'complexity'
 */

const strategies = new Map();

/**
 * Register a strategy function for a given artifact type and phase.
 *
 * @param {string} artifactType - e.g. 'workflow', 'code_pattern', 'infra_config'
 * @param {string} phase - e.g. 'normalize', 'classify', 'score', 'package', 'complexity'
 * @param {Function} fn - The strategy function
 */
export function registerStrategy(artifactType, phase, fn) {
  if (typeof fn !== 'function') {
    throw new Error(`Strategy for ${artifactType}:${phase} must be a function`);
  }
  const key = `${artifactType}:${phase}`;
  strategies.set(key, fn);
}

/**
 * Get the strategy function for a given artifact type and phase.
 * Falls back to the 'default' strategy if no type-specific one exists.
 *
 * @param {string} artifactType
 * @param {string} phase
 * @returns {Function|null}
 */
export function getStrategy(artifactType, phase) {
  return strategies.get(`${artifactType}:${phase}`)
    || strategies.get(`default:${phase}`)
    || null;
}

/**
 * Check if a strategy is registered for a given artifact type and phase.
 *
 * @param {string} artifactType
 * @param {string} phase
 * @returns {boolean}
 */
export function hasStrategy(artifactType, phase) {
  return strategies.has(`${artifactType}:${phase}`)
    || strategies.has(`default:${phase}`);
}

/**
 * List all registered strategies.
 * @returns {string[]} Array of 'artifactType:phase' keys
 */
export function listStrategies() {
  return [...strategies.keys()];
}

/**
 * Clear all registered strategies (useful for testing).
 */
export function clearStrategies() {
  strategies.clear();
}

/**
 * Register multiple strategies at once for a given artifact type.
 *
 * @param {string} artifactType
 * @param {object} phaseMap - { normalize: fn, classify: fn, score: fn, ... }
 */
export function registerType(artifactType, phaseMap) {
  for (const [phase, fn] of Object.entries(phaseMap)) {
    registerStrategy(artifactType, phase, fn);
  }
}

// ─── Valid artifact types and phases ───

export const ARTIFACT_TYPES = [
  'workflow',
  'code_pattern',
  'api_spec',
  'infra_config',
  'ai_ml_asset',
  'data_asset',
  'documentation',
  'wiki_page',
];

export const PHASES = [
  'normalize',
  'classify',
  'score',
  'package',
  'complexity',
  'validate',
];
