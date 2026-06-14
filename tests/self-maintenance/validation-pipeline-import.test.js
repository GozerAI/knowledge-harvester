// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #886 — Validation Pipeline (source import)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateSchema, validateContent, validateConsistency, validateCompleteness, validateUrlFormat, validateArtifact, VALIDATION_STAGES } from '../../src/self-maintenance/validation-pipeline.js';

describe('Validation Pipeline (source import)', () => {
  describe('VALIDATION_STAGES', () => {
    it('should define 5 stages', () => { assert.equal(VALIDATION_STAGES.length, 5); });
    it('should include schema', () => { assert.ok(VALIDATION_STAGES.includes('schema')); });
    it('should include content', () => { assert.ok(VALIDATION_STAGES.includes('content')); });
    it('should include consistency', () => { assert.ok(VALIDATION_STAGES.includes('consistency')); });
  });

  describe('validateSchema', () => {
    it('should pass with id and type', () => {
      assert.ok(validateSchema({ id: '1', artifact_type: 'wf' }).valid);
    });
    it('should fail without id', () => {
      assert.ok(!validateSchema({ artifact_type: 'wf' }).valid);
    });
  });

  describe('validateContent', () => {
    it('should pass with valid name', () => {
      assert.ok(validateContent({ name: 'Valid' }).valid);
    });
    it('should fail with empty name', () => {
      assert.ok(!validateContent({ name: '' }).valid);
    });
    it('should fail with name > 500', () => {
      assert.ok(!validateContent({ name: 'x'.repeat(501) }).valid);
    });
  });

  describe('validateConsistency', () => {
    it('should pass with score in range', () => {
      assert.ok(validateConsistency({ quality_score: 50 }).valid);
    });
    it('should fail with score > 100', () => {
      assert.ok(!validateConsistency({ quality_score: 101 }).valid);
    });
    it('should detect updated_at before created_at', () => {
      const r = validateConsistency({
        created_at: '2026-03-01', updated_at: '2025-01-01',
      });
      assert.ok(!r.valid);
    });
  });

  describe('validateCompleteness', () => {
    it('should pass with required fields', () => {
      assert.ok(validateCompleteness({ name: 'T', artifact_type: 'wf' }).valid);
    });
    it('should warn for missing recommended fields', () => {
      const r = validateCompleteness({ name: 'T', artifact_type: 'wf' });
      assert.ok(r.warnings.length > 0);
    });
  });

  describe('validateUrlFormat', () => {
    it('should pass valid https', () => {
      assert.ok(validateUrlFormat({ source_url: 'https://github.com' }).valid);
    });
    it('should fail ftp', () => {
      assert.ok(!validateUrlFormat({ source_url: 'ftp://x.com' }).valid);
    });
  });

  describe('validateArtifact (full pipeline)', () => {
    it('should pass a valid artifact', () => {
      const r = validateArtifact({
        id: '1', name: 'Test', artifact_type: 'workflow',
        quality_score: 50, source_url: 'https://github.com/x',
      });
      assert.ok(r.valid);
      assert.equal(r.errors.length, 0);
    });

    it('should fail an empty artifact', () => {
      const r = validateArtifact({});
      assert.ok(!r.valid);
      assert.ok(r.errors.length > 0);
    });

    it('should collect errors from all stages', () => {
      const r = validateArtifact({ quality_score: 200 });
      assert.ok(r.errors.some(e => e.includes('id')));
      assert.ok(r.errors.some(e => e.includes('Quality score')));
    });

    it('should include all stage results', () => {
      const r = validateArtifact({ id: '1', name: 'T', artifact_type: 'wf' });
      assert.ok('schema' in r.stages);
      assert.ok('content' in r.stages);
      assert.ok('consistency' in r.stages);
      assert.ok('completeness' in r.stages);
      assert.ok('url_format' in r.stages);
    });
  });
});
