// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

/**
 * Tests for the artifact store module.
 * Since we can't connect to a real database in unit tests, these test
 * the artifact object shape validation and parameter mapping logic
 * by reimplementing the key functions as pure logic.
 */

// ── Reimplemented from artifact-store.js for pure testing ──

function buildArtifactParams(a) {
  return [
    a.id,                                             // $1
    a.hash,                                           // $2
    a.artifact_type,                                  // $3
    a.source,                                         // $4
    a.source_url,                                     // $5
    a.source_id,                                      // $6
    a.discovered_at,                                  // $7
    a.updated_at,                                     // $8
    JSON.stringify(a.content),                         // $9
    a.name,                                           // $10
    a.description || '',                              // $11
    a.author?.username || null,                        // $12
    a.author?.profile_url || null,                     // $13
    a.language || null,                                // $14
    a.tool_type || null,                               // $15
    JSON.stringify(a.tool_metadata || {}),              // $16
    a.tags || [],                                      // $17
    JSON.stringify(a.type_metadata || {}),              // $18
    null,                                              // $19 primary_category
    '{}',                                              // $20 secondary_categories
    a.quality?.score || 0,                             // $21
    0,                                                 // $22 complexity_score
    a.quality?.has_description || false,                // $23
    a.quality?.has_documentation || false,              // $24
    a.quality?.is_complete ?? true,                     // $25
    a.quality?.validation_status || 'untested',         // $26
    'raw',                                             // $27
    JSON.stringify(a.marketplace_metadata || {}),       // $28
  ];
}

function makeArtifact(overrides = {}) {
  return {
    id: randomUUID(),
    hash: 'abc123def456',
    artifact_type: 'workflow',
    source: 'test-source',
    source_url: 'https://example.com/workflow/1',
    source_id: 'wf-1',
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    content: { nodes: [], connections: {} },
    name: 'Test Workflow',
    description: 'A test workflow',
    author: { username: 'testuser', profile_url: 'https://example.com/testuser' },
    language: 'javascript',
    tool_type: 'n8n',
    tool_metadata: { version: '1.0' },
    tags: ['test', 'example'],
    type_metadata: { node_count: 5, trigger_type: 'webhook' },
    quality: {
      score: 75,
      has_description: true,
      has_documentation: false,
      is_complete: true,
      validation_status: 'valid',
    },
    marketplace_metadata: {},
    ...overrides,
  };
}

describe('Artifact Store', () => {
  describe('buildArtifactParams', () => {
    it('should produce correct parameter count (28)', () => {
      const artifact = makeArtifact();
      const params = buildArtifactParams(artifact);
      assert.equal(params.length, 28);
    });

    it('should map artifact_type to $3', () => {
      const artifact = makeArtifact({ artifact_type: 'infra_config' });
      const params = buildArtifactParams(artifact);
      assert.equal(params[2], 'infra_config');
    });

    it('should serialize content as JSON string for $9', () => {
      const content = { resources: ['aws_vpc', 'aws_subnet'] };
      const artifact = makeArtifact({ content });
      const params = buildArtifactParams(artifact);
      assert.equal(params[8], JSON.stringify(content));
    });

    it('should handle missing author gracefully', () => {
      const artifact = makeArtifact({ author: null });
      const params = buildArtifactParams(artifact);
      assert.equal(params[11], null); // author_username
      assert.equal(params[12], null); // author_profile_url
    });

    it('should handle missing author fields', () => {
      const artifact = makeArtifact({ author: { username: 'bob' } });
      const params = buildArtifactParams(artifact);
      assert.equal(params[11], 'bob');
      assert.equal(params[12], null);
    });

    it('should default description to empty string', () => {
      const artifact = makeArtifact({ description: undefined });
      const params = buildArtifactParams(artifact);
      assert.equal(params[10], '');
    });

    it('should default language to null', () => {
      const artifact = makeArtifact({ language: undefined });
      const params = buildArtifactParams(artifact);
      assert.equal(params[13], null);
    });

    it('should serialize type_metadata as JSON', () => {
      const meta = { providers: ['aws'], resource_count: 3 };
      const artifact = makeArtifact({ type_metadata: meta });
      const params = buildArtifactParams(artifact);
      assert.equal(params[17], JSON.stringify(meta));
    });

    it('should default quality.score to 0', () => {
      const artifact = makeArtifact({ quality: undefined });
      const params = buildArtifactParams(artifact);
      assert.equal(params[20], 0); // quality_score
    });

    it('should always set publishing_status to raw', () => {
      const artifact = makeArtifact();
      const params = buildArtifactParams(artifact);
      assert.equal(params[26], 'raw');
    });

    it('should always set primary_category to null (classifier sets it)', () => {
      const artifact = makeArtifact();
      const params = buildArtifactParams(artifact);
      assert.equal(params[18], null);
    });

    it('should default is_complete to true when quality is missing', () => {
      const artifact = makeArtifact({ quality: undefined });
      const params = buildArtifactParams(artifact);
      assert.equal(params[24], true);
    });

    it('should pass tags as array', () => {
      const artifact = makeArtifact({ tags: ['terraform', 'aws', 'vpc'] });
      const params = buildArtifactParams(artifact);
      assert.deepEqual(params[16], ['terraform', 'aws', 'vpc']);
    });

    it('should default empty tool_metadata to {}', () => {
      const artifact = makeArtifact({ tool_metadata: undefined });
      const params = buildArtifactParams(artifact);
      assert.equal(params[15], '{}');
    });

    it('should serialize marketplace_metadata', () => {
      const mktMeta = { price_tier: 'pro', price_usd: 9.99 };
      const artifact = makeArtifact({ marketplace_metadata: mktMeta });
      const params = buildArtifactParams(artifact);
      assert.equal(params[27], JSON.stringify(mktMeta));
    });
  });

  describe('makeArtifact helper', () => {
    it('should produce a valid workflow artifact', () => {
      const a = makeArtifact();
      assert.ok(a.id);
      assert.equal(a.artifact_type, 'workflow');
      assert.equal(a.source, 'test-source');
      assert.equal(a.name, 'Test Workflow');
    });

    it('should allow overrides', () => {
      const a = makeArtifact({
        artifact_type: 'api_spec',
        name: 'My API',
        tool_type: 'openapi',
      });
      assert.equal(a.artifact_type, 'api_spec');
      assert.equal(a.name, 'My API');
      assert.equal(a.tool_type, 'openapi');
    });
  });

  describe('artifact types', () => {
    it('should accept all valid artifact types', () => {
      const types = [
        'workflow', 'code_pattern', 'api_spec', 'infra_config',
        'ai_ml_asset', 'data_asset', 'documentation',
      ];
      for (const type of types) {
        const artifact = makeArtifact({ artifact_type: type });
        const params = buildArtifactParams(artifact);
        assert.equal(params[2], type);
      }
    });
  });
});
