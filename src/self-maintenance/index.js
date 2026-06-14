// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Self-Maintenance Module Index
 *
 * #866-#890 — Autonomous knowledge base maintenance capabilities.
 */

export { scoreSourceReliability, calculateFactors, computeWeightedScore, classifyTier, RELIABILITY_WEIGHTS } from './reliability-scorer.js';
export { monitorFreshness, classifyAge, generateAlerts, getCategoryFreshness, AGE_BUCKETS } from './freshness-monitor.js';
export { detectDuplicates, normalizedSimilarity, deduplicateGroups, mergeDuplicates, DEDUP_THRESHOLD } from './dedup-merger.js';
export { identifyGaps, EXPECTED_DOMAINS } from './gap-identifier.js';
export { analyzeTaxonomyUsage, areSimilarCategories, applyMerge } from './taxonomy-restructurer.js';
export { verifyCitations, isUrl, classifyUrlPlatform } from './citation-verifier.js';
export { detectConflicts, resolveConflict, CONFLICT_TYPES, RESOLUTION_STRATEGIES } from './conflict-resolver.js';
export { expandSources, extractOrgUrl, extractOrgName, extractDomain } from './source-expander.js';
export { calculateQualityScore, batchScoreQuality, QUALITY_DIMENSIONS } from './quality-scorer.js';
export { maintainGraph, MAINTENANCE_OPS } from './graph-maintainer.js';
export { validateCrossReferences, VALIDATION_DIMENSIONS } from './cross-ref-validator.js';
export { findArchiveCandidates, archiveArtifacts, restoreArtifacts, ARCHIVE_POLICIES } from './archiver.js';
export { optimizeIndexes, applyIndex, TARGET_COLUMNS, INDEX_DEFINITIONS } from './index-optimizer.js';
export { computeEnrichments, batchEnrich, inferLanguage, inferComplexity, inferPlatform, generateAutoTags } from './metadata-enricher.js';
export { exportArtifacts, formatJson, formatCsv, formatMarkdown, formatYaml, csvEscape, yamlEscape, SUPPORTED_FORMATS } from './export-formatter.js';
export { computeContentHash, detectChanges, trackVersions, getVersionHistory } from './version-tracker.js';
export { analyzeAccessPatterns, ANALYSIS_DIMENSIONS } from './access-analyzer.js';
export { getRecommendations, computeRecommendationScore, tagOverlap } from './recommender.js';
export { generateArtifactSummary, generateCategorySummary, batchSummarize, IMPORTANT_TERMS } from './summarizer.js';
export { validateArtifact, batchValidate, validateSchema, validateContent, validateConsistency, validateCompleteness, validateUrlFormat, VALIDATION_STAGES } from './validation-pipeline.js';
export { enforceRetention, classifyRetentionTier, checkRetention, DEFAULT_POLICIES } from './retention-policy.js';
export { processFeedback, recordFeedback, isValidFeedback, computeAdjustment, FEEDBACK_TYPES, FEEDBACK_WEIGHTS } from './feedback-integrator.js';
export { assessCompleteness, assessFieldPopulation, COMPLETENESS_DIMENSIONS } from './completeness-assessor.js';
export { recordProvenance, getProvenance, getProvenanceSummary, isValidEvent, createProvenanceRecord, PROVENANCE_EVENTS } from './provenance-tracker.js';
