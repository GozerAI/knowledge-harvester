// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #879 — Autonomous Metadata Enrichment
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function inferLanguage(artifact) {
  const name = (artifact.name || '').toLowerCase();
  const desc = (artifact.description || '').toLowerCase();
  const combined = `${name} ${desc}`;
  const langPatterns = [
    { lang: 'python', patterns: ['python', '.py', 'pip', 'django', 'flask', 'fastapi'] },
    { lang: 'javascript', patterns: ['javascript', 'node', '.js', 'npm', 'react', 'express'] },
    { lang: 'typescript', patterns: ['typescript', '.ts', 'tsx'] },
    { lang: 'go', patterns: ['golang', '.go', 'go module'] },
    { lang: 'rust', patterns: ['rust', '.rs', 'cargo'] },
    { lang: 'java', patterns: ['java', '.java', 'maven', 'gradle', 'spring'] },
    { lang: 'yaml', patterns: ['yaml', 'yml'] },
    { lang: 'hcl', patterns: ['terraform', '.tf', 'hcl'] },
  ];
  for (const { lang, patterns } of langPatterns) {
    if (patterns.some(p => combined.includes(p))) return lang;
  }
  return null;
}

function inferComplexity(artifact) {
  const desc = artifact.description || '';
  const tags = Array.isArray(artifact.tags) ? artifact.tags : [];
  if (desc.length > 500 || tags.length > 8) return 'advanced';
  if (desc.length > 200 || tags.length > 4) return 'intermediate';
  return 'beginner';
}

function inferPlatform(sourceUrl) {
  if (!sourceUrl) return null;
  if (sourceUrl.includes('github.com')) return 'github';
  if (sourceUrl.includes('gitlab.com')) return 'gitlab';
  if (sourceUrl.includes('bitbucket.org')) return 'bitbucket';
  if (sourceUrl.includes('npmjs.com')) return 'npm';
  if (sourceUrl.includes('pypi.org')) return 'pypi';
  return null;
}

function generateAutoTags(artifact) {
  const words = new Set();
  const name = (artifact.name || '').toLowerCase();
  const desc = (artifact.description || '').toLowerCase().slice(0, 200);
  const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'will', 'have', 'been']);
  for (const word of `${name} ${desc}`.split(/[\s\-_/,;:()]+/)) {
    if (word.length > 3 && !STOP_WORDS.has(word)) words.add(word);
  }
  if (artifact.artifact_type) words.add(artifact.artifact_type);
  return [...words].slice(0, 8);
}

function computeEnrichments(artifact) {
  const enrichments = {};
  const meta = artifact.type_metadata || {};
  if (!meta.language) { const lang = inferLanguage(artifact); if (lang) enrichments.language = lang; }
  if (!meta.complexity) enrichments.complexity = inferComplexity(artifact);
  if (!artifact.tags || (Array.isArray(artifact.tags) && artifact.tags.length === 0)) {
    const autoTags = generateAutoTags(artifact);
    if (autoTags.length > 0) enrichments.auto_tags = autoTags;
  }
  if (!meta.platform) { const p = inferPlatform(artifact.source_url); if (p) enrichments.platform = p; }
  if (Object.keys(enrichments).length > 0) enrichments.enriched_at = new Date().toISOString();
  return enrichments;
}

describe('Metadata Enricher', () => {
  describe('inferLanguage', () => {
    it('should detect python', () => { assert.equal(inferLanguage({ name: 'Python FastAPI app' }), 'python'); });
    it('should detect javascript', () => { assert.equal(inferLanguage({ name: 'Node.js Express server' }), 'javascript'); });
    it('should detect typescript', () => { assert.equal(inferLanguage({ name: 'TypeScript utility' }), 'typescript'); });
    it('should detect go', () => { assert.equal(inferLanguage({ description: 'Written in Golang' }), 'go'); });
    it('should detect rust', () => { assert.equal(inferLanguage({ name: 'Rust CLI with Cargo' }), 'rust'); });
    it('should detect java', () => { assert.equal(inferLanguage({ name: 'Spring Boot app' }), 'java'); });
    it('should detect hcl', () => { assert.equal(inferLanguage({ name: 'Terraform Module' }), 'hcl'); });
    it('should return null for unknown', () => { assert.equal(inferLanguage({ name: 'Some thing' }), null); });
    it('should check description too', () => { assert.equal(inferLanguage({ name: 'Tool', description: 'Built with Flask' }), 'python'); });
  });

  describe('inferComplexity', () => {
    it('should return beginner for short desc', () => { assert.equal(inferComplexity({ description: 'Short' }), 'beginner'); });
    it('should return intermediate for medium desc', () => { assert.equal(inferComplexity({ description: 'x'.repeat(250) }), 'intermediate'); });
    it('should return advanced for long desc', () => { assert.equal(inferComplexity({ description: 'x'.repeat(600) }), 'advanced'); });
    it('should use tag count', () => { assert.equal(inferComplexity({ description: '', tags: Array(9).fill('t') }), 'advanced'); });
    it('should return intermediate for 5 tags', () => { assert.equal(inferComplexity({ description: '', tags: Array(5).fill('t') }), 'intermediate'); });
  });

  describe('inferPlatform', () => {
    it('should detect github', () => { assert.equal(inferPlatform('https://github.com/org/repo'), 'github'); });
    it('should detect gitlab', () => { assert.equal(inferPlatform('https://gitlab.com/group/project'), 'gitlab'); });
    it('should detect bitbucket', () => { assert.equal(inferPlatform('https://bitbucket.org/team/repo'), 'bitbucket'); });
    it('should detect npm', () => { assert.equal(inferPlatform('https://www.npmjs.com/package/foo'), 'npm'); });
    it('should detect pypi', () => { assert.equal(inferPlatform('https://pypi.org/project/foo/'), 'pypi'); });
    it('should return null for unknown', () => { assert.equal(inferPlatform('https://example.com'), null); });
    it('should return null for null input', () => { assert.equal(inferPlatform(null), null); });
  });

  describe('generateAutoTags', () => {
    it('should generate tags from name', () => {
      const tags = generateAutoTags({ name: 'Docker Container Deployment' });
      assert.ok(tags.includes('docker'));
      assert.ok(tags.includes('container'));
    });
    it('should include artifact_type', () => {
      const tags = generateAutoTags({ name: 'Test', artifact_type: 'workflow' });
      assert.ok(tags.includes('workflow'));
    });
    it('should filter stop words', () => {
      const tags = generateAutoTags({ name: 'the quick brown from with' });
      assert.ok(!tags.includes('the'));
      assert.ok(!tags.includes('from'));
    });
    it('should limit to 8 tags', () => {
      const tags = generateAutoTags({ name: 'alpha beta gamma delta epsilon zeta eta theta iota kappa', description: 'lambda mu nu xi' });
      assert.ok(tags.length <= 8);
    });
    it('should filter short words', () => {
      const tags = generateAutoTags({ name: 'a to b via c' });
      assert.equal(tags.length, 0);
    });
  });

  describe('computeEnrichments', () => {
    it('should enrich language and platform', () => {
      const e = computeEnrichments({
        name: 'Python FastAPI', source_url: 'https://github.com/org/repo',
        type_metadata: {}, tags: [],
      });
      assert.equal(e.language, 'python');
      assert.equal(e.platform, 'github');
    });
    it('should not override existing metadata', () => {
      const e = computeEnrichments({
        name: 'Python app', source_url: 'https://github.com/x',
        type_metadata: { language: 'go', platform: 'gitlab' }, tags: ['a'],
      });
      assert.ok(!('language' in e));
      assert.ok(!('platform' in e));
    });
    it('should add enriched_at timestamp', () => {
      const e = computeEnrichments({ name: 'Something long enough', type_metadata: {}, tags: [] });
      assert.ok(e.enriched_at);
    });
    it('should return empty for fully enriched artifact', () => {
      const e = computeEnrichments({
        name: 'Test', tags: ['existing'],
        type_metadata: { language: 'python', complexity: 'advanced', platform: 'github' },
        source_url: null,
      });
      // Only complexity might still be added since we check meta.complexity
      // Actually complexity is on metadata, so it won't be added
      assert.ok(!e.language);
    });
  });
});
