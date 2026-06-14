// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Autonomy Module Index — Autonomous Learning capabilities.
 *
 * #693 Knowledge Gap Detection
 * #697 Source Discovery
 * #701 Taxonomy Evolution
 * #705 Data Quality Improvement
 * #709 Content Freshness Management
 */

export { detectKnowledgeGaps, gapSummary } from './knowledge-gap-detector.js';
export { discoverSources, persistDiscoveredSources } from './source-discovery.js';
export { analyzeTaxonomy, applyProposal } from './taxonomy-evolution.js';
export { improveDataQuality, getQualityReport } from './data-quality-improver.js';
export { analyzeFreshness, markRefreshed, getFreshnessTrend } from './content-freshness-manager.js';
