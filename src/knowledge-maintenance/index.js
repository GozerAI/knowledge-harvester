// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Knowledge Maintenance Module Index
 *
 * Self-Sufficiency: Knowledge Self-Maintenance (#866-#890)
 * Self-Updating (#918, #943)
 */

// Knowledge Self-Maintenance
export { scoreSourceReliability } from './source-reliability-scorer.js';
export { monitorFreshness } from './freshness-monitor.js';
export { detectAndMergeDuplicates } from './duplicate-detector.js';
export { identifyKnowledgeGaps } from './gap-identifier.js';
export { restructureTaxonomy } from './taxonomy-restructurer.js';
export { verifyCitations } from './citation-verifier.js';
export { resolveConflicts } from './conflict-resolver.js';
export { expandSourceDiscovery } from './source-discovery-expansion.js';
export { scoreContentQuality, calculateQualityScore } from './content-quality-scorer.js';
export { maintainKnowledgeGraph } from './knowledge-graph-maintainer.js';
export { validateCrossReferences } from './cross-reference-validator.js';
export { archiveKnowledge, getArchivalStats } from './knowledge-archival.js';
export { optimizeIndexing } from './indexing-optimizer.js';
export { enrichMetadata, computeEnrichments } from './metadata-enricher.js';
export { exportKnowledge } from './export-formatter.js';
export { trackVersions, getVersionHistory } from './version-tracker.js';
export { analyzeAccessPatterns } from './access-pattern-analyzer.js';
export { recommendKnowledge, recommendTopKnowledge } from './knowledge-recommender.js';
export { summarizeKnowledge, generateArtifactSummary, generateCategoryDigest } from './knowledge-summarizer.js';
export { translateKnowledge } from './knowledge-translator.js';
export { runValidationPipeline } from './validation-pipeline.js';
export { applyRetentionPolicies, getRetentionStatus } from './retention-policy.js';
export { integrateFeedback } from './feedback-integrator.js';
export { assessCompleteness } from './completeness-assessor.js';
export { recordProvenance, getProvenanceChain, trackBatchProvenance } from './provenance-tracker.js';

// Self-Updating
export { autoUpdateDependencies } from './npm-auto-updater.js';
export { optimizeConfig, persistOptimizedConfig } from './config-self-optimizer.js';
