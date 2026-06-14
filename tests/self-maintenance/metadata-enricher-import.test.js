// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #879 — Metadata Enricher (source import)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inferLanguage, inferComplexity, inferPlatform, generateAutoTags, computeEnrichments } from '../../src/self-maintenance/metadata-enricher.js';

describe('Metadata Enricher (source import)', () => {
  describe('inferLanguage', () => {
    it('should detect python', () => { assert.equal(inferLanguage({ name: 'Python FastAPI app' }), 'python'); });
    it('should detect javascript', () => { assert.equal(inferLanguage({ name: 'Node.js Express server' }), 'javascript'); });
    it('should detect typescript', () => { assert.equal(inferLanguage({ name: 'TypeScript utility' }), 'typescript'); });
    it('should detect go', () => { assert.equal(inferLanguage({ description: 'Written in Golang' }), 'go'); });
    it('should detect rust', () => { assert.equal(inferLanguage({ name: 'Rust CLI with Cargo' }), 'rust'); });
    it('should detect java', () => { assert.equal(inferLanguage({ name: 'Spring Boot app' }), 'java'); });
    it('should detect hcl', () => { assert.equal(inferLanguage({ name: 'Terraform Module' }), 'hcl'); });
    it('should return null for unknown', () => { assert.equal(inferLanguage({ name: 'Some thing' }), null); });
  });

  describe('inferComplexity', () => {
    it('should return beginner for short desc', () => { assert.equal(inferComplexity({ description: 'Short' }), 'beginner'); });
    it('should return intermediate for medium desc', () => { assert.equal(inferComplexity({ description: 'x'.repeat(250) }), 'intermediate'); });
    it('should return advanced for long desc', () => { assert.equal(inferComplexity({ description: 'x'.repeat(600) }), 'advanced'); });
    it('should use tag count', () => { assert.equal(inferComplexity({ description: '', tags: Array(9).fill('t') }), 'advanced'); });
  });

  describe('inferPlatform', () => {
    it('should detect github', () => { assert.equal(inferPlatform('https://github.com/org/repo'), 'github'); });
    it('should detect gitlab', () => { assert.equal(inferPlatform('https://gitlab.com/group/project'), 'gitlab'); });
    it('should detect npm', () => { assert.equal(inferPlatform('https://www.npmjs.com/package/foo'), 'npm'); });
    it('should return null for null', () => { assert.equal(inferPlatform(null), null); });
  });

  describe('generateAutoTags', () => {
    it('should generate tags from name', () => {
      const tags = generateAutoTags({ name: 'Docker Container Deployment' });
      assert.ok(tags.includes('docker'));
    });
    it('should include artifact_type', () => {
      const tags = generateAutoTags({ name: 'Test', artifact_type: 'workflow' });
      assert.ok(tags.includes('workflow'));
    });
    it('should limit to 8 tags', () => {
      const tags = generateAutoTags({ name: 'alpha beta gamma delta epsilon zeta eta theta iota kappa' });
      assert.ok(tags.length <= 8);
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
        name: 'Python app',
        type_metadata: { language: 'go', platform: 'gitlab' }, tags: ['a'],
      });
      assert.ok(!('language' in e));
      assert.ok(!('platform' in e));
    });
    it('should add enriched_at when enrichments found', () => {
      const e = computeEnrichments({ name: 'Something long enough', type_metadata: {}, tags: [] });
      assert.ok(e.enriched_at);
    });
  });
});
