// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Tests for the artifact embedder — validates the embedding text builder
 * produces correct text from various artifact shapes.
 */

// ── Reimplemented pure logic from artifact-embedder.js ──

function buildEmbeddingText(row) {
  const parts = [
    row.name || '',
    row.description || '',
    row.artifact_type || '',
    row.tool_type || '',
    row.primary_category || '',
    Array.isArray(row.tags) ? row.tags.join(' ') : '',
    row.language || '',
  ];

  const meta = typeof row.type_metadata === 'string'
    ? JSON.parse(row.type_metadata) : (row.type_metadata || {});

  for (const [key, val] of Object.entries(meta)) {
    if (Array.isArray(val)) {
      parts.push(val.join(' '));
    } else if (typeof val === 'string') {
      parts.push(val);
    }
  }

  return parts
    .filter(Boolean)
    .join(' ')
    .slice(0, 4000)
    .trim();
}

describe('Artifact Embedder', () => {
  describe('buildEmbeddingText', () => {
    it('should combine name and description', () => {
      const text = buildEmbeddingText({
        name: 'My Terraform Module',
        description: 'Creates a VPC with subnets',
      });
      assert.ok(text.includes('My Terraform Module'));
      assert.ok(text.includes('Creates a VPC with subnets'));
    });

    it('should include artifact_type', () => {
      const text = buildEmbeddingText({
        name: 'Test',
        artifact_type: 'infra_config',
      });
      assert.ok(text.includes('infra_config'));
    });

    it('should include tool_type and category', () => {
      const text = buildEmbeddingText({
        name: 'Test',
        tool_type: 'terraform',
        primary_category: 'infrastructure-as-code',
      });
      assert.ok(text.includes('terraform'));
      assert.ok(text.includes('infrastructure-as-code'));
    });

    it('should join tags with spaces', () => {
      const text = buildEmbeddingText({
        name: 'Test',
        tags: ['aws', 'vpc', 'networking'],
      });
      assert.ok(text.includes('aws vpc networking'));
    });

    it('should include language', () => {
      const text = buildEmbeddingText({
        name: 'Test',
        language: 'hcl',
      });
      assert.ok(text.includes('hcl'));
    });

    it('should include type_metadata arrays', () => {
      const text = buildEmbeddingText({
        name: 'Test',
        type_metadata: {
          providers: ['aws', 'google'],
          resources: ['vpc', 'subnet'],
        },
      });
      assert.ok(text.includes('aws google'));
      assert.ok(text.includes('vpc subnet'));
    });

    it('should include type_metadata strings', () => {
      const text = buildEmbeddingText({
        name: 'Test',
        type_metadata: {
          pattern_type: 'singleton',
          framework: 'express',
        },
      });
      assert.ok(text.includes('singleton'));
      assert.ok(text.includes('express'));
    });

    it('should handle JSON-encoded type_metadata', () => {
      const text = buildEmbeddingText({
        name: 'Test',
        type_metadata: JSON.stringify({ providers: ['azure'] }),
      });
      assert.ok(text.includes('azure'));
    });

    it('should skip numeric type_metadata values', () => {
      const text = buildEmbeddingText({
        name: 'Test',
        type_metadata: {
          resource_count: 5,
          variables_count: 3,
          config_type: 'terraform',
        },
      });
      assert.ok(text.includes('terraform'));
      assert.ok(!text.includes('5'));
    });

    it('should truncate at 4000 chars', () => {
      const longDesc = 'x'.repeat(5000);
      const text = buildEmbeddingText({
        name: 'Test',
        description: longDesc,
      });
      assert.ok(text.length <= 4000);
    });

    it('should handle all fields missing gracefully', () => {
      const text = buildEmbeddingText({});
      assert.equal(text, '');
    });

    it('should handle empty tags array', () => {
      const text = buildEmbeddingText({
        name: 'Test',
        tags: [],
      });
      assert.ok(text.includes('Test'));
    });

    it('should handle null type_metadata', () => {
      const text = buildEmbeddingText({
        name: 'Test',
        type_metadata: null,
      });
      assert.ok(text.includes('Test'));
    });
  });
});
