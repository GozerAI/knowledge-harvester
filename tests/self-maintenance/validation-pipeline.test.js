// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #886 — Autonomous Knowledge Validation Pipeline
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function validateSchema(artifact) {
  const errors = [];
  if (!artifact.id) errors.push('Missing id');
  if (!artifact.artifact_type) errors.push('Missing artifact_type');
  return { valid: errors.length === 0, errors };
}

function validateContent(artifact) {
  const errors = [];
  if (!artifact.name || artifact.name.trim().length === 0) errors.push('Empty name');
  if (artifact.name && artifact.name.length > 500) errors.push('Name exceeds 500 chars');
  if (artifact.description && artifact.description.length > 50000) errors.push('Description exceeds 50000 chars');
  return { valid: errors.length === 0, errors };
}

function validateConsistency(artifact) {
  const errors = [];
  if (artifact.quality_score != null) {
    if (artifact.quality_score < 0 || artifact.quality_score > 100) {
      errors.push(`Quality score ${artifact.quality_score} out of range [0-100]`);
    }
  }
  return { valid: errors.length === 0, errors };
}

function validateCompleteness(artifact) {
  const errors = [];
  const requiredFields = ['name', 'artifact_type'];
  for (const field of requiredFields) { if (!artifact[field]) errors.push(`Missing required field: ${field}`); }
  const warnings = [];
  const desiredFields = ['description', 'primary_category', 'source_url'];
  for (const field of desiredFields) { if (!artifact[field]) warnings.push(`Missing recommended field: ${field}`); }
  return { valid: errors.length === 0, errors, warnings };
}

function validateUrlFormat(artifact) {
  const errors = [];
  if (artifact.source_url) {
    try {
      const u = new URL(artifact.source_url);
      if (!['http:', 'https:'].includes(u.protocol)) errors.push(`Invalid URL protocol: ${u.protocol}`);
    } catch { errors.push(`Malformed URL: ${artifact.source_url}`); }
  }
  return { valid: errors.length === 0, errors };
}

describe('Validation Pipeline', () => {
  describe('validateSchema', () => {
    it('should pass with id and type', () => {
      assert.ok(validateSchema({ id: '1', artifact_type: 'workflow' }).valid);
    });
    it('should fail without id', () => {
      assert.ok(!validateSchema({ artifact_type: 'workflow' }).valid);
    });
    it('should fail without artifact_type', () => {
      assert.ok(!validateSchema({ id: '1' }).valid);
    });
    it('should report both missing fields', () => {
      const result = validateSchema({});
      assert.equal(result.errors.length, 2);
    });
  });

  describe('validateContent', () => {
    it('should pass with valid name', () => {
      assert.ok(validateContent({ name: 'Valid Name' }).valid);
    });
    it('should fail with empty name', () => {
      assert.ok(!validateContent({ name: '' }).valid);
    });
    it('should fail with null name', () => {
      assert.ok(!validateContent({ name: null }).valid);
    });
    it('should fail with name > 500 chars', () => {
      assert.ok(!validateContent({ name: 'x'.repeat(501) }).valid);
    });
    it('should pass with name at 500 chars', () => {
      assert.ok(validateContent({ name: 'x'.repeat(500) }).valid);
    });
    it('should fail with description > 50000 chars', () => {
      assert.ok(!validateContent({ name: 'ok', description: 'x'.repeat(50001) }).valid);
    });
  });

  describe('validateConsistency', () => {
    it('should pass with score in range', () => {
      assert.ok(validateConsistency({ quality_score: 50 }).valid);
    });
    it('should fail with negative score', () => {
      assert.ok(!validateConsistency({ quality_score: -1 }).valid);
    });
    it('should fail with score > 100', () => {
      assert.ok(!validateConsistency({ quality_score: 101 }).valid);
    });
    it('should pass with null score', () => {
      assert.ok(validateConsistency({ quality_score: null }).valid);
    });
    it('should pass boundary 0', () => {
      assert.ok(validateConsistency({ quality_score: 0 }).valid);
    });
    it('should pass boundary 100', () => {
      assert.ok(validateConsistency({ quality_score: 100 }).valid);
    });
  });

  describe('validateCompleteness', () => {
    it('should pass with required fields', () => {
      assert.ok(validateCompleteness({ name: 'Test', artifact_type: 'workflow' }).valid);
    });
    it('should fail without name', () => {
      assert.ok(!validateCompleteness({ artifact_type: 'workflow' }).valid);
    });
    it('should include warnings for missing recommended fields', () => {
      const result = validateCompleteness({ name: 'Test', artifact_type: 'workflow' });
      assert.ok(result.warnings.length > 0);
    });
    it('should have no warnings when all fields present', () => {
      const result = validateCompleteness({
        name: 'Test', artifact_type: 'workflow',
        description: 'desc', primary_category: 'cat', source_url: 'http://x.com',
      });
      assert.equal(result.warnings.length, 0);
    });
  });

  describe('validateUrlFormat', () => {
    it('should pass valid https URL', () => {
      assert.ok(validateUrlFormat({ source_url: 'https://github.com/org/repo' }).valid);
    });
    it('should pass valid http URL', () => {
      assert.ok(validateUrlFormat({ source_url: 'http://example.com' }).valid);
    });
    it('should fail with malformed URL', () => {
      assert.ok(!validateUrlFormat({ source_url: 'not-a-url' }).valid);
    });
    it('should fail with ftp protocol', () => {
      assert.ok(!validateUrlFormat({ source_url: 'ftp://files.example.com/data' }).valid);
    });
    it('should pass with no URL', () => {
      assert.ok(validateUrlFormat({ source_url: null }).valid);
    });
  });
});
