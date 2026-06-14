// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { BatchEmbedder } from '../../src/processing/batch-embedder.js';

describe('BatchEmbedder', () => {
  describe('constructor', () => {
    it('uses defaults', () => {
      const be = new BatchEmbedder({ model: 'test', host: 'http://localhost:11434' });
      assert.equal(be._batchSize, 32);
      assert.equal(be._maxConcurrentBatches, 2);
      assert.equal(be._timeoutMs, 30000);
    });

    it('accepts custom options', () => {
      const be = new BatchEmbedder({ batchSize: 16, maxConcurrentBatches: 4, timeoutMs: 5000, model: 'x', host: 'http://h' });
      assert.equal(be._batchSize, 16);
      assert.equal(be._maxConcurrentBatches, 4);
    });
  });

  describe('embedBatch', () => {
    it('returns empty array for empty input', async () => {
      const be = new BatchEmbedder({ model: 'test', host: 'http://localhost:11434' });
      const results = await be.embedBatch([]);
      assert.deepEqual(results, []);
    });
  });

  describe('buildText', () => {
    it('combines artifact fields', () => {
      const text = BatchEmbedder.buildText({
        name: 'My Artifact',
        description: 'Does something useful',
        artifact_type: 'workflow',
        primary_category: 'automation',
        tags: ['api', 'data'],
        language: 'python',
      });
      assert.ok(text.includes('My Artifact'));
      assert.ok(text.includes('Does something useful'));
      assert.ok(text.includes('workflow'));
      assert.ok(text.includes('api'));
      assert.ok(text.includes('python'));
    });

    it('handles missing fields gracefully', () => {
      const text = BatchEmbedder.buildText({});
      assert.equal(text, '');
    });

    it('falls back to workflow fields', () => {
      const text = BatchEmbedder.buildText({
        workflow_name: 'WF-1',
        original_description: 'Old desc',
        tool_type: 'n8n',
      });
      assert.ok(text.includes('WF-1'));
      assert.ok(text.includes('Old desc'));
    });

    it('truncates at 4000 chars', () => {
      const text = BatchEmbedder.buildText({ name: 'x'.repeat(5000) });
      assert.ok(text.length <= 4000);
    });

    it('joins tags array', () => {
      const text = BatchEmbedder.buildText({ tags: ['a', 'b', 'c'] });
      assert.ok(text.includes('a b c'));
    });
  });

  describe('getStats', () => {
    it('returns initial stats', () => {
      const be = new BatchEmbedder({ model: 'test', host: 'http://localhost:11434' });
      const stats = be.getStats();
      assert.equal(stats.totalEmbedded, 0);
      assert.equal(stats.totalFailed, 0);
      assert.equal(stats.totalBatches, 0);
    });
  });
});
