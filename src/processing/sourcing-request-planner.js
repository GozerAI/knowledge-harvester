// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { listAvailableHarvesterSources } from '../harvesters/source-catalog.js';

const ROLE_SOURCE_MAP = {
  cro: ['sales-playbooks', 'sales-enablement', 'customer-success-playbooks', 'vendor-assessments', 'legal-contracts'],
  cpo: ['product-requirements', 'release-checklists', 'customer-onboarding', 'support-playbooks', 'incident-postmortems'],
  cmo: ['sales-enablement', 'sales-playbooks', 'customer-success-playbooks', 'product-requirements', 'support-playbooks'],
  cfo: ['finance-controls', 'vendor-assessments', 'legal-contracts', 'board-governance', 'compliance-controls'],
  clo: ['legal-contracts', 'privacy-governance', 'security-policies', 'vendor-assessments', 'board-governance'],
  chro: ['employee-handbooks', 'hr-onboarding', 'privacy-governance', 'security-policies'],
  coo: ['runbooks', 'incident-postmortems', 'board-governance', 'finance-controls', 'compliance-controls'],
};

const DOMAIN_SOURCE_MAP = {
  revenue: ['sales-playbooks', 'sales-enablement', 'customer-success-playbooks', 'vendor-assessments'],
  sales: ['sales-playbooks', 'sales-enablement', 'customer-success-playbooks'],
  marketing: ['sales-enablement', 'sales-playbooks', 'customer-success-playbooks', 'product-requirements'],
  product: ['product-requirements', 'release-checklists', 'customer-onboarding', 'support-playbooks', 'incident-postmortems'],
  legal: ['legal-contracts', 'privacy-governance', 'board-governance', 'vendor-assessments'],
  finance: ['finance-controls', 'vendor-assessments', 'board-governance', 'legal-contracts'],
  people: ['employee-handbooks', 'hr-onboarding', 'privacy-governance'],
  privacy: ['privacy-governance', 'security-policies', 'legal-contracts', 'compliance-controls'],
  security: ['security-policies', 'compliance-controls', 'privacy-governance', 'incident-postmortems'],
  support: ['support-playbooks', 'customer-success-playbooks', 'incident-postmortems', 'customer-onboarding'],
  governance: ['board-governance', 'compliance-controls', 'security-policies', 'privacy-governance'],
};

const DOMAIN_CATEGORY_MAP = {
  revenue: ['enablement-doc', 'support-doc', 'product-doc'],
  sales: ['enablement-doc', 'support-doc'],
  marketing: ['enablement-doc', 'product-doc'],
  product: ['product-doc', 'checklist', 'support-doc', 'postmortem'],
  legal: ['legal-doc', 'policy'],
  finance: ['finance-doc', 'policy', 'checklist'],
  people: ['people-doc', 'policy', 'checklist'],
  privacy: ['policy', 'legal-doc'],
  security: ['policy', 'postmortem', 'checklist'],
  support: ['support-doc', 'runbook', 'postmortem'],
  governance: ['policy', 'legal-doc'],
};

const DOMAIN_ARTIFACT_TYPE_MAP = {
  revenue: ['documentation'],
  sales: ['documentation'],
  marketing: ['documentation'],
  product: ['documentation'],
  legal: ['documentation'],
  finance: ['documentation'],
  people: ['documentation'],
  privacy: ['documentation'],
  security: ['documentation'],
  support: ['documentation'],
  governance: ['documentation'],
};

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeStringList(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
}

function collectKeywordMatches(keywords, map) {
  const matches = new Set();
  for (const keyword of keywords) {
    const values = map[keyword];
    if (!values) continue;
    for (const value of values) matches.add(value);
  }
  return [...matches];
}

export function deriveSourcingKeywords(request = {}) {
  const raw = [
    request.domain,
    request.topic,
    request.objective,
    ...(request.researchQuestions || []),
  ].join(' ');

  return [...new Set(
    raw
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .map((part) => part.trim())
      .filter((part) => part.length >= 3)
  )];
}

export function recommendSourcesForRequest(request = {}, { availableSources = listAvailableHarvesterSources() } = {}) {
  const requested = normalizeStringList(request.preferredSources);
  const roleKey = normalizeKey(request.requesterRole);
  const domainKey = normalizeKey(request.domain);
  const keywords = deriveSourcingKeywords(request);
  const roleSources = ROLE_SOURCE_MAP[roleKey] || [];
  const domainSources = DOMAIN_SOURCE_MAP[domainKey] || [];
  const keywordSources = collectKeywordMatches(keywords, DOMAIN_SOURCE_MAP);

  const candidateSources = [...new Set([
    ...requested,
    ...roleSources,
    ...domainSources,
    ...keywordSources,
  ])];

  const supported = candidateSources.filter((source) => availableSources.includes(source));
  const unsupported = candidateSources.filter((source) => !availableSources.includes(source));

  return {
    requested,
    supported,
    unsupported,
  };
}

function recommendCategories(request = {}) {
  const explicit = normalizeStringList(request.categories);
  const domainCategories = DOMAIN_CATEGORY_MAP[normalizeKey(request.domain)] || [];
  return [...new Set([...explicit, ...domainCategories])];
}

function recommendArtifactTypes(request = {}) {
  const explicit = normalizeStringList(request.artifactTypes);
  const domainTypes = DOMAIN_ARTIFACT_TYPE_MAP[normalizeKey(request.domain)] || [];
  return [...new Set([...explicit, ...domainTypes])];
}

function classifyCoverage(totalArtifacts) {
  if (totalArtifacts === 0) return 'none';
  if (totalArtifacts < 5) return 'low';
  if (totalArtifacts < 20) return 'moderate';
  return 'strong';
}

async function queryCoverage(database, { categories, searchTerm }) {
  const likeTerm = `%${searchTerm || ''}%`;
  const hasCategories = categories.length > 0;
  const params = hasCategories ? [categories, likeTerm] : [likeTerm];
  const predicate = hasCategories
    ? `(primary_category = ANY($1) OR name ILIKE $2 OR COALESCE(description, '') ILIKE $2)`
    : `(name ILIKE $1 OR COALESCE(description, '') ILIKE $1)`;

  const [totalResult, byTypeResult, byCategoryResult, bySourceResult] = await Promise.all([
    database.query(
      `SELECT COUNT(*)::int AS total
       FROM artifacts
       WHERE ${predicate}`,
      params,
    ),
    database.query(
      `SELECT artifact_type, COUNT(*)::int AS count
       FROM artifacts
       WHERE ${predicate}
       GROUP BY artifact_type
       ORDER BY count DESC, artifact_type ASC
       LIMIT 10`,
      params,
    ),
    database.query(
      `SELECT COALESCE(primary_category, 'unknown') AS category, COUNT(*)::int AS count
       FROM artifacts
       WHERE ${predicate}
       GROUP BY COALESCE(primary_category, 'unknown')
       ORDER BY count DESC, category ASC
       LIMIT 10`,
      params,
    ),
    database.query(
      `SELECT source, COUNT(*)::int AS count
       FROM artifacts
       WHERE source IS NOT NULL AND ${predicate}
       GROUP BY source
       ORDER BY count DESC, source ASC
       LIMIT 10`,
      params,
    ),
  ]);

  return {
    total_artifacts: totalResult.rows[0]?.total || 0,
    by_type: byTypeResult.rows,
    by_category: byCategoryResult.rows,
    by_source: bySourceResult.rows,
  };
}

export async function buildSourcingQualification(database, request = {}, options = {}) {
  const topic = normalizeText(request.topic);
  const objective = normalizeText(request.objective);
  const searchTerm = topic || objective || normalizeText(request.domain);
  const categories = recommendCategories(request);
  const artifactTypes = recommendArtifactTypes(request);
  const sourceRecommendation = recommendSourcesForRequest(request, options);
  const coverage = await queryCoverage(database, { categories, searchTerm });

  return {
    search_term: searchTerm,
    keywords: deriveSourcingKeywords(request).slice(0, 24),
    suggested_categories: categories,
    suggested_artifact_types: artifactTypes,
    recommended_sources: sourceRecommendation.supported,
    unsupported_requested_sources: sourceRecommendation.unsupported,
    requested_sources: sourceRecommendation.requested,
    current_coverage: {
      ...coverage,
      status: classifyCoverage(coverage.total_artifacts),
    },
    recommendation: coverage.total_artifacts === 0
      ? 'No existing coverage. Dispatch targeted harvesting immediately.'
      : coverage.total_artifacts < 5
        ? 'Low existing coverage. Dispatch targeted harvesting and review claim quality after ingest.'
        : 'Existing coverage available. Use targeted harvesting only for freshness and domain expansion.',
  };
}
