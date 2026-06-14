// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #705 — Autonomous Data Quality Improvement
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Re-implement check functions for testing ──

function checkMissingName(artifact) {
  if (!artifact.name || artifact.name.trim() === '') {
    return { description: 'Artifact has no name', fix: { name: `untitled-${artifact.artifact_type || 'artifact'}-${artifact.id}` } };
  }
  return null;
}

function checkMissingDescription(artifact) {
  if (!artifact.description || artifact.description.trim().length < 10) {
    const autoDesc = artifact.name ? `${artifact.artifact_type || 'Artifact'}: ${artifact.name}` : null;
    return { description: 'Artifact has no or very short description', fix: autoDesc ? { description: autoDesc } : null };
  }
  return null;
}

function checkLowQualityName(artifact) {
  if (!artifact.name) return null;
  const name = artifact.name.trim();
  if (name.length < 4 || /^[a-f0-9-]+$/i.test(name)) {
    return { description: `Artifact name "${name}" appears to be an ID or too short`, fix: null };
  }
  if (name === name.toUpperCase() && name.length > 5) {
    return { description: `Artifact name "${name}" is all uppercase`, fix: { name: titleCase(name) } };
  }
  return null;
}

function checkMissingTags(artifact) {
  const tags = artifact.tags;
  if (!tags || (Array.isArray(tags) && tags.length === 0)) {
    if (artifact.name) {
      const autoTags = artifact.name.toLowerCase().split(/[\s\-_/]+/).filter(w => w.length > 3).slice(0, 5);
      if (autoTags.length > 0) return { description: 'Artifact has no tags', fix: { tags: JSON.stringify(autoTags) } };
    }
    return { description: 'Artifact has no tags', fix: null };
  }
  return null;
}

function checkInvalidUrl(artifact) {
  if (!artifact.source_url) return null;
  try { new URL(artifact.source_url); return null; } catch { return { description: `Invalid source URL: ${artifact.source_url}` }; }
}

function titleCase(str) {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function countBy(arr, field) {
  const counts = {};
  for (const item of arr) { counts[item[field]] = (counts[item[field]] || 0) + 1; }
  return counts;
}

describe('Data Quality Improver', () => {
  describe('checkMissingName', () => {
    it('should detect missing name', () => {
      assert.ok(checkMissingName({ id: '1', name: null }));
    });

    it('should detect empty name', () => {
      assert.ok(checkMissingName({ id: '1', name: '' }));
    });

    it('should detect whitespace-only name', () => {
      assert.ok(checkMissingName({ id: '1', name: '   ' }));
    });

    it('should pass valid name', () => {
      assert.equal(checkMissingName({ id: '1', name: 'Valid Name' }), null);
    });

    it('should generate fix with artifact type', () => {
      const result = checkMissingName({ id: '42', name: null, artifact_type: 'workflow' });
      assert.ok(result.fix.name.includes('workflow'));
    });

    it('should generate fix with artifact id', () => {
      const result = checkMissingName({ id: '42', name: null });
      assert.ok(result.fix.name.includes('42'));
    });
  });

  describe('checkMissingDescription', () => {
    it('should detect missing description', () => {
      assert.ok(checkMissingDescription({ name: 'Test', description: null }));
    });

    it('should detect short description', () => {
      assert.ok(checkMissingDescription({ name: 'Test', description: 'Short' }));
    });

    it('should pass adequate description', () => {
      assert.equal(checkMissingDescription({ name: 'Test', description: 'This is a sufficiently long description for testing purposes' }), null);
    });

    it('should generate fix from name when available', () => {
      const result = checkMissingDescription({ name: 'My Workflow', description: null, artifact_type: 'workflow' });
      assert.ok(result.fix);
      assert.ok(result.fix.description.includes('My Workflow'));
    });

    it('should not generate fix when name is also missing', () => {
      const result = checkMissingDescription({ name: null, description: null });
      assert.equal(result.fix, null);
    });
  });

  describe('checkLowQualityName', () => {
    it('should detect UUID-like names', () => {
      assert.ok(checkLowQualityName({ name: 'a1b2c3d4-e5f6' }));
    });

    it('should detect very short names', () => {
      assert.ok(checkLowQualityName({ name: 'abc' }));
    });

    it('should detect all-uppercase names', () => {
      const result = checkLowQualityName({ name: 'TERRAFORM MODULE' });
      assert.ok(result);
      assert.ok(result.fix);
      assert.equal(result.fix.name, 'Terraform Module');
    });

    it('should pass normal names', () => {
      assert.equal(checkLowQualityName({ name: 'Docker Deployment Setup' }), null);
    });

    it('should handle null name', () => {
      assert.equal(checkLowQualityName({ name: null }), null);
    });

    it('should flag short names like API as too short', () => {
      const result = checkLowQualityName({ name: 'API' });
      assert.ok(result);
      assert.ok(result.description.includes('too short'));
    });
  });

  describe('checkMissingTags', () => {
    it('should detect missing tags', () => {
      assert.ok(checkMissingTags({ name: 'Docker Setup', tags: null }));
    });

    it('should detect empty tags array', () => {
      assert.ok(checkMissingTags({ name: 'Docker Setup', tags: [] }));
    });

    it('should pass valid tags', () => {
      assert.equal(checkMissingTags({ name: 'Test', tags: ['docker', 'deploy'] }), null);
    });

    it('should auto-generate tags from name', () => {
      const result = checkMissingTags({ name: 'Docker Container Deployment', tags: [] });
      assert.ok(result.fix);
      const tags = JSON.parse(result.fix.tags);
      assert.ok(tags.includes('docker'));
    });

    it('should not generate tags if name has only short words', () => {
      const result = checkMissingTags({ name: 'A to B', tags: null });
      assert.equal(result.fix, null);
    });
  });

  describe('checkInvalidUrl', () => {
    it('should pass valid URLs', () => {
      assert.equal(checkInvalidUrl({ source_url: 'https://github.com/org/repo' }), null);
    });

    it('should detect invalid URLs', () => {
      assert.ok(checkInvalidUrl({ source_url: 'not-a-url' }));
    });

    it('should pass null URL', () => {
      assert.equal(checkInvalidUrl({ source_url: null }), null);
    });

    it('should pass http URLs', () => {
      assert.equal(checkInvalidUrl({ source_url: 'http://example.com' }), null);
    });
  });

  describe('titleCase', () => {
    it('should title case a string', () => {
      assert.equal(titleCase('hello world'), 'Hello World');
    });

    it('should handle uppercase input', () => {
      assert.equal(titleCase('DOCKER COMPOSE'), 'Docker Compose');
    });

    it('should handle single word', () => {
      assert.equal(titleCase('terraform'), 'Terraform');
    });
  });

  describe('countBy', () => {
    it('should count by severity', () => {
      const items = [
        { severity: 'high' }, { severity: 'low' }, { severity: 'high' },
      ];
      const counts = countBy(items, 'severity');
      assert.equal(counts.high, 2);
      assert.equal(counts.low, 1);
    });
  });
});
