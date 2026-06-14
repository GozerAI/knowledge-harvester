// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Workflow Strategy — Re-exports existing workflow processing logic
 * as a registered strategy for the unified artifact pipeline.
 *
 * This file bridges the existing workflow-specific processors
 * into the strategy registry without changing any of the existing code.
 */

import { registerType } from '../../registry.js';
import { normalizeWorkflow } from '../../normalizer.js';
import { classifyWorkflows } from '../../classifier.js';
import { scoreWorkflows } from '../../scorer.js';
import { packageWorkflows } from '../../packager.js';
import { analyzeComplexity } from '../../complexity-analyzer.js';

/**
 * Normalize a raw workflow from any of the 27 sources.
 * Delegates to the existing normalizeWorkflow() which handles
 * all source-specific normalizers via its switch/case.
 */
function normalize(source, rawData) {
  return normalizeWorkflow(source, rawData);
}

/**
 * Classify workflows — wraps existing classifyWorkflows().
 * The strategy interface expects (limit) => result.
 */
function classify(limit) {
  return classifyWorkflows(limit);
}

/**
 * Score workflows — wraps existing scoreWorkflows().
 */
function score(limit) {
  return scoreWorkflows(limit);
}

/**
 * Package workflows — wraps existing packageWorkflows().
 */
function packageFn(limit) {
  return packageWorkflows(limit);
}

/**
 * Complexity analysis — wraps existing analyzeComplexity().
 */
function complexity(limit) {
  return analyzeComplexity(limit);
}

/**
 * Register all workflow strategies in the registry.
 * Call this during initialization.
 */
export function registerWorkflowStrategies() {
  registerType('workflow', {
    normalize,
    classify,
    score,
    package: packageFn,
    complexity,
  });
}

// Export individual functions for direct use
export { normalize, classify, score, packageFn as package, complexity };
