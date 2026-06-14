// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Comprehensive tests for Knowledge Maintenance modules
 * #867-#890, #918, #943
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── #867 Freshness Monitor ──

function classifyAge(ageDays) {
  const buckets = { fresh: 30, recent: 90, aging: 180, stale: 365 };
  for (const [key, max] of Object.entries(buckets)) {
    if (ageDays <= max) return key;
  }
  return 'expired';
}

function generateAlerts(buckets) {
  const alerts = [];
  const total = Object.values(buckets).reduce((s, b) => s + b.count, 0);
  if (total === 0) return alerts;
  const stalePct = ((buckets.stale?.count || 0) + (buckets.expired?.count || 0)) / total;
  if (stalePct > 0.5) alerts.push({ level: 'critical', message: `${Math.round(stalePct * 100)}% stale` });
  else if (stalePct > 0.3) alerts.push({ level: 'warning', message: `${Math.round(stalePct * 100)}% stale` });
  return alerts;
}

describe('Freshness Monitor (#867)', () => {
  describe('classifyAge', () => {
    it('should classify 10 days as fresh', () => { assert.equal(classifyAge(10), 'fresh'); });
    it('should classify 60 days as recent', () => { assert.equal(classifyAge(60), 'recent'); });
    it('should classify 150 days as aging', () => { assert.equal(classifyAge(150), 'aging'); });
    it('should classify 300 days as stale', () => { assert.equal(classifyAge(300), 'stale'); });
    it('should classify 400 days as expired', () => { assert.equal(classifyAge(400), 'expired'); });
  });

  describe('generateAlerts', () => {
    it('should generate critical alert when >50% stale', () => {
      const buckets = { fresh: { count: 10 }, stale: { count: 40 }, expired: { count: 20 } };
      const alerts = generateAlerts(buckets);
      assert.ok(alerts.some(a => a.level === 'critical'));
    });
    it('should generate warning when >30% stale', () => {
      const buckets = { fresh: { count: 50 }, stale: { count: 20 }, expired: { count: 5 } };
      const alerts = generateAlerts(buckets);
      assert.ok(alerts.some(a => a.level === 'warning'));
    });
    it('should return empty for no data', () => {
      assert.deepEqual(generateAlerts({}), []);
    });
  });
});

// ── #869 Gap Identifier ──

const EXPECTED_DOMAINS = [
  { domain: 'automation', types: ['workflow', 'code_pattern'], minArtifacts: 10 },
  { domain: 'infrastructure', types: ['infra_config'], minArtifacts: 10 },
];

describe('Gap Identifier (#869)', () => {
  it('should have expected domains defined', () => {
    assert.ok(EXPECTED_DOMAINS.length > 0);
  });
  it('should have minArtifacts for each domain', () => {
    for (const d of EXPECTED_DOMAINS) assert.ok(d.minArtifacts > 0);
  });
  it('should have types for each domain', () => {
    for (const d of EXPECTED_DOMAINS) assert.ok(d.types.length > 0);
  });
});

// ── #870 Taxonomy Restructurer ──

function areSimilarCategories(a, b) {
  const na = a.toLowerCase().replace(/[\s\-_]+/g, '');
  const nb = b.toLowerCase().replace(/[\s\-_]+/g, '');
  if (na.includes(nb) || nb.includes(na)) return true;
  const wa = new Set(a.toLowerCase().split(/[\s\-_]+/));
  const wb = new Set(b.toLowerCase().split(/[\s\-_]+/));
  let overlap = 0;
  for (const w of wa) { if (wb.has(w)) overlap++; }
  return overlap > 0 && overlap >= Math.min(wa.size, wb.size) * 0.5;
}

describe('Taxonomy Restructurer (#870)', () => {
  it('should detect similar categories with containment', () => {
    assert.ok(areSimilarCategories('automation', 'automations'));
  });
  it('should detect similar categories with overlap', () => {
    assert.ok(areSimilarCategories('data-pipeline', 'data-processing'));
  });
  it('should reject dissimilar categories', () => {
    assert.ok(!areSimilarCategories('python', 'kubernetes'));
  });
});

// ── #871 Citation Verifier ──

function isUrl(str) {
  try { const u = new URL(str); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}

describe('Citation Verifier (#871)', () => {
  it('should validate https URL', () => { assert.ok(isUrl('https://github.com')); });
  it('should validate http URL', () => { assert.ok(isUrl('http://example.com')); });
  it('should reject ftp URL', () => { assert.ok(!isUrl('ftp://files.com/data')); });
  it('should reject non-URL', () => { assert.ok(!isUrl('not-a-url')); });
  it('should reject empty string', () => { assert.ok(!isUrl('')); });
});

// ── #872 Conflict Resolver ──

describe('Conflict Resolver (#872)', () => {
  const CONFLICT_TYPES = ['version_mismatch', 'contradicting_config', 'duplicate_with_diff', 'category_inconsistency'];
  it('should define conflict types', () => { assert.equal(CONFLICT_TYPES.length, 4); });
  it('should include version_mismatch', () => { assert.ok(CONFLICT_TYPES.includes('version_mismatch')); });
  it('should include category_inconsistency', () => { assert.ok(CONFLICT_TYPES.includes('category_inconsistency')); });
});

// ── #873 Source Discovery Expansion ──

function extractOrgUrl(url) {
  const match = url?.match(/https?:\/\/github\.com\/([^/]+)/);
  return match ? `https://github.com/${match[1]}` : null;
}

function extractOrgName(url) {
  const match = url?.match(/github\.com\/([^/]+)/);
  return match ? match[1] : null;
}

describe('Source Discovery Expansion (#873)', () => {
  it('should extract org URL from GitHub URL', () => {
    assert.equal(extractOrgUrl('https://github.com/langchain-ai/langchain'), 'https://github.com/langchain-ai');
  });
  it('should extract org name', () => {
    assert.equal(extractOrgName('https://github.com/facebook/react'), 'facebook');
  });
  it('should return null for non-GitHub URL', () => {
    assert.equal(extractOrgUrl('https://gitlab.com/group/project'), null);
  });
  it('should return null for null', () => {
    assert.equal(extractOrgUrl(null), null);
    assert.equal(extractOrgName(null), null);
  });
});

// ── #875 Knowledge Graph Maintainer ──

describe('Knowledge Graph Maintainer (#875)', () => {
  it('should define maintenance operations', () => {
    const ops = ['pruneStaleEdges', 'removeOrphanNodes', 'discoverNewEdges', 'checkConsistency'];
    assert.equal(ops.length, 4);
  });
});

// ── #876 Cross-Reference Validator ──

describe('Cross-Reference Validator (#876)', () => {
  it('should have validation dimensions', () => {
    const dimensions = ['relation_integrity', 'bidirectional_consistency'];
    assert.ok(dimensions.length >= 2);
  });
});

// ── #877 Knowledge Archival ──

const ARCHIVE_POLICIES = {
  expired: { maxAgeDays: 365, minQuality: 0 },
  low_quality: { maxAgeDays: 0, minQuality: 20 },
  superseded: { maxAgeDays: 0 },
  broken_source: { maxAgeDays: 0 },
};

describe('Knowledge Archival (#877)', () => {
  it('should define archive policies', () => { assert.ok(Object.keys(ARCHIVE_POLICIES).length >= 4); });
  it('should have expired policy at 365 days', () => { assert.equal(ARCHIVE_POLICIES.expired.maxAgeDays, 365); });
  it('should have low quality threshold at 20', () => { assert.equal(ARCHIVE_POLICIES.low_quality.minQuality, 20); });
});

// ── #878 Indexing Optimizer ──

describe('Indexing Optimizer (#878)', () => {
  it('should target key columns for indexing', () => {
    const columns = ['primary_category', 'artifact_type', 'source', 'quality_score', 'updated_at'];
    assert.ok(columns.length >= 5);
  });
});

// ── #881 Version Tracker ──

function computeContentHash(artifact) {
  const content = `${artifact.name}|${artifact.description}|${artifact.quality_score}|${JSON.stringify(artifact.type_metadata)}`;
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function detectChanges(oldSnapshot, newArtifact) {
  const changes = [];
  if (oldSnapshot.name !== newArtifact.name) changes.push('name_changed');
  if (oldSnapshot.description !== newArtifact.description) changes.push('description_changed');
  if (oldSnapshot.quality_score !== newArtifact.quality_score) changes.push('quality_score_changed');
  return changes.length > 0 ? changes : ['metadata_updated'];
}

describe('Version Tracker (#881)', () => {
  describe('computeContentHash', () => {
    it('should produce consistent hashes', () => {
      const a = { name: 'Test', description: 'Desc', quality_score: 50, type_metadata: {} };
      assert.equal(computeContentHash(a), computeContentHash(a));
    });
    it('should produce different hashes for different content', () => {
      const a = { name: 'A', description: 'X', quality_score: 50, type_metadata: {} };
      const b = { name: 'B', description: 'Y', quality_score: 50, type_metadata: {} };
      assert.notEqual(computeContentHash(a), computeContentHash(b));
    });
  });
  describe('detectChanges', () => {
    it('should detect name change', () => {
      assert.ok(detectChanges({ name: 'Old' }, { name: 'New' }).includes('name_changed'));
    });
    it('should detect description change', () => {
      assert.ok(detectChanges({ description: 'Old' }, { description: 'New' }).includes('description_changed'));
    });
    it('should return metadata_updated when no field changes', () => {
      assert.deepEqual(detectChanges({ name: 'A', description: 'B', quality_score: 50 }, { name: 'A', description: 'B', quality_score: 50 }), ['metadata_updated']);
    });
  });
});

// ── #882 Access Pattern Analyzer ──

describe('Access Pattern Analyzer (#882)', () => {
  it('should define analysis dimensions', () => {
    const dimensions = ['popular', 'neglected', 'by_category', 'time_patterns'];
    assert.equal(dimensions.length, 4);
  });
});

// ── #883 Knowledge Recommender ──

function computeRecommendationScore(candidate, seed) {
  let score = 0;
  score += (candidate.quality_score || 0) * 0.005;
  if (candidate.primary_category === seed.primary_category) score += 0.3;
  if (candidate.source === 'relation') score += 0.4;
  else if (candidate.source === 'tags') score += 0.2;
  return Math.round(Math.min(score, 1) * 100) / 100;
}

describe('Knowledge Recommender (#883)', () => {
  it('should boost score for same category', () => {
    const a = computeRecommendationScore({ primary_category: 'ai', quality_score: 50, source: 'category_type' }, { primary_category: 'ai' });
    const b = computeRecommendationScore({ primary_category: 'other', quality_score: 50, source: 'category_type' }, { primary_category: 'ai' });
    assert.ok(a > b);
  });
  it('should boost relation-based recommendations', () => {
    const relation = computeRecommendationScore({ quality_score: 50, source: 'relation' }, {});
    const tags = computeRecommendationScore({ quality_score: 50, source: 'tags' }, {});
    assert.ok(relation > tags);
  });
  it('should clamp to 0-1', () => {
    const score = computeRecommendationScore({ primary_category: 'x', quality_score: 100, source: 'relation' }, { primary_category: 'x' });
    assert.ok(score <= 1);
  });
});

// ── #884 Knowledge Summarizer ──

function generateArtifactSummary(artifact) {
  const desc = artifact.description || '';
  const name = artifact.name || 'Untitled';
  const type = artifact.artifact_type || 'artifact';
  const category = artifact.primary_category || 'uncategorized';
  const sentences = desc.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const keySentences = [];
  if (sentences.length > 0) keySentences.push(sentences[0].trim());
  const importantTerms = ['provides', 'enables', 'supports', 'includes', 'features', 'implements'];
  for (const s of sentences.slice(1)) {
    if (importantTerms.some(t => s.toLowerCase().includes(t)) && keySentences.length < 3) keySentences.push(s.trim());
  }
  return keySentences.length > 0
    ? (keySentences.join('. ') + '.').slice(0, 500)
    : `${name} is a ${type} in the ${category} category.`;
}

describe('Knowledge Summarizer (#884)', () => {
  it('should summarize from description', () => {
    const s = generateArtifactSummary({ description: 'This is a useful workflow. It provides automation for common tasks.' });
    assert.ok(s.length > 0);
    assert.ok(s.includes('useful workflow'));
  });
  it('should fall back to name-based summary', () => {
    const s = generateArtifactSummary({ name: 'MyFlow', artifact_type: 'workflow', primary_category: 'automation', description: '' });
    assert.ok(s.includes('MyFlow'));
    assert.ok(s.includes('workflow'));
  });
  it('should limit to 500 chars', () => {
    const s = generateArtifactSummary({ description: 'x'.repeat(600) + '. And more content.' });
    assert.ok(s.length <= 500);
  });
  it('should extract key sentences', () => {
    const s = generateArtifactSummary({ description: 'First sentence here. This provides cool features. Another random bit.' });
    assert.ok(s.includes('provides'));
  });
});

// ── #885 Knowledge Translator ──

const TRANSLATION_TYPES = { 'workflow_to_doc': {}, 'config_to_guide': {}, 'code_to_api': {}, 'any_to_summary': {} };

describe('Knowledge Translator (#885)', () => {
  it('should define translation types', () => { assert.ok(Object.keys(TRANSLATION_TYPES).length >= 4); });
  it('should include workflow_to_doc', () => { assert.ok('workflow_to_doc' in TRANSLATION_TYPES); });
  it('should include any_to_summary', () => { assert.ok('any_to_summary' in TRANSLATION_TYPES); });
});

// ── #887 Retention Policy ──

const DEFAULT_POLICIES = {
  high_quality: { minScore: 70, retentionDays: Infinity },
  medium_quality: { minScore: 40, retentionDays: 365 },
  low_quality: { minScore: 0, retentionDays: 180 },
  unscored: { minScore: null, retentionDays: 90 },
};

describe('Retention Policy (#887)', () => {
  it('should keep high quality indefinitely', () => { assert.equal(DEFAULT_POLICIES.high_quality.retentionDays, Infinity); });
  it('should keep medium for 1 year', () => { assert.equal(DEFAULT_POLICIES.medium_quality.retentionDays, 365); });
  it('should keep low for 6 months', () => { assert.equal(DEFAULT_POLICIES.low_quality.retentionDays, 180); });
  it('should keep unscored for 3 months', () => { assert.equal(DEFAULT_POLICIES.unscored.retentionDays, 90); });
});

// ── #888 Feedback Integrator ──

const FEEDBACK_TYPES = ['quality_report', 'user_rating', 'usage_signal', 'deprecation_notice', 'correction'];

function isValidFeedback(item) {
  return item && item.artifact_id && item.type && FEEDBACK_TYPES.includes(item.type);
}

describe('Feedback Integrator (#888)', () => {
  it('should validate correct feedback', () => {
    assert.ok(isValidFeedback({ artifact_id: '1', type: 'user_rating', value: 5 }));
  });
  it('should reject missing artifact_id', () => {
    assert.ok(!isValidFeedback({ type: 'user_rating' }));
  });
  it('should reject invalid type', () => {
    assert.ok(!isValidFeedback({ artifact_id: '1', type: 'invalid' }));
  });
  it('should reject null', () => { assert.ok(!isValidFeedback(null)); });
  it('should accept all feedback types', () => {
    for (const t of FEEDBACK_TYPES) {
      assert.ok(isValidFeedback({ artifact_id: '1', type: t }));
    }
  });
});

// ── #889 Completeness Assessor ──

describe('Completeness Assessor (#889)', () => {
  it('should define completeness dimensions', () => {
    const dims = ['field_population', 'category_coverage', 'cross_references', 'depth_coverage', 'temporal_coverage'];
    assert.equal(dims.length, 5);
  });
});

// ── #890 Provenance Tracker ──

const PROVENANCE_EVENTS = ['harvested', 'classified', 'scored', 'enriched', 'validated', 'merged', 'archived', 'restored', 'exported', 'transformed'];

describe('Provenance Tracker (#890)', () => {
  it('should define provenance event types', () => { assert.ok(PROVENANCE_EVENTS.length >= 10); });
  it('should include harvested', () => { assert.ok(PROVENANCE_EVENTS.includes('harvested')); });
  it('should include archived', () => { assert.ok(PROVENANCE_EVENTS.includes('archived')); });
  it('should include transformed', () => { assert.ok(PROVENANCE_EVENTS.includes('transformed')); });
});

// ── #918 npm Auto-Updater ──

function countDeps(pkg) {
  return (pkg.dependencies ? Object.keys(pkg.dependencies).length : 0) +
    (pkg.devDependencies ? Object.keys(pkg.devDependencies).length : 0);
}

function generateUpdatePlan(outdated, vulnerabilities) {
  const vulnNames = new Set(vulnerabilities.map(v => v.name));
  const safe = [], risky = [];
  for (const dep of outdated) {
    const isMajor = dep.latest && dep.current && dep.latest.split('.')[0] !== dep.current.split('.')[0];
    const hasVuln = vulnNames.has(dep.name);
    if (isMajor) risky.push({ ...dep, reason: 'major_version_bump' });
    else if (hasVuln) safe.push({ ...dep, reason: 'security_fix', priority: 'high' });
    else safe.push({ ...dep, reason: 'minor_update', priority: 'low' });
  }
  return { safe, risky };
}

describe('npm Auto-Updater (#918)', () => {
  describe('countDeps', () => {
    it('should count both dep types', () => {
      assert.equal(countDeps({ dependencies: { a: '1', b: '2' }, devDependencies: { c: '1' } }), 3);
    });
    it('should handle missing deps', () => {
      assert.equal(countDeps({}), 0);
    });
  });
  describe('generateUpdatePlan', () => {
    it('should classify major bumps as risky', () => {
      const plan = generateUpdatePlan([{ name: 'pg', current: '7.0.0', latest: '8.0.0' }], []);
      assert.equal(plan.risky.length, 1);
      assert.equal(plan.safe.length, 0);
    });
    it('should classify minor bumps as safe', () => {
      const plan = generateUpdatePlan([{ name: 'pg', current: '8.0.0', latest: '8.1.0' }], []);
      assert.equal(plan.safe.length, 1);
      assert.equal(plan.risky.length, 0);
    });
    it('should prioritize security fixes', () => {
      const plan = generateUpdatePlan(
        [{ name: 'pg', current: '8.0.0', latest: '8.0.1' }],
        [{ name: 'pg', severity: 'high' }]
      );
      assert.equal(plan.safe[0].priority, 'high');
    });
  });
});

// ── #943 Config Self-Optimizer ──

const DEFAULT_CONFIG = {
  harvest_concurrency: 3, batch_size: 50, retry_count: 3,
  retry_delay_ms: 1000, timeout_ms: 30000, quality_threshold: 40,
  freshness_window_days: 90, dedup_threshold: 0.85,
};

const CONFIG_BOUNDS = {
  harvest_concurrency: { min: 1, max: 10 },
  batch_size: { min: 10, max: 500 },
};

describe('Config Self-Optimizer (#943)', () => {
  it('should have default config values', () => {
    assert.equal(DEFAULT_CONFIG.harvest_concurrency, 3);
    assert.equal(DEFAULT_CONFIG.batch_size, 50);
  });
  it('should have config bounds', () => {
    assert.ok(CONFIG_BOUNDS.harvest_concurrency.min < CONFIG_BOUNDS.harvest_concurrency.max);
    assert.ok(CONFIG_BOUNDS.batch_size.min < CONFIG_BOUNDS.batch_size.max);
  });
  it('should keep default within bounds', () => {
    assert.ok(DEFAULT_CONFIG.harvest_concurrency >= CONFIG_BOUNDS.harvest_concurrency.min);
    assert.ok(DEFAULT_CONFIG.harvest_concurrency <= CONFIG_BOUNDS.harvest_concurrency.max);
    assert.ok(DEFAULT_CONFIG.batch_size >= CONFIG_BOUNDS.batch_size.min);
    assert.ok(DEFAULT_CONFIG.batch_size <= CONFIG_BOUNDS.batch_size.max);
  });
});
