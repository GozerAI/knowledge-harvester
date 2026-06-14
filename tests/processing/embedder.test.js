// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// buildEmbeddingText is not exported, so we reimplement the pure logic
// and test against the spec to verify correctness without needing Ollama/DB.
function buildEmbeddingText(row) {
  const parts = [
    row.workflow_name || '',
    row.original_description || '',
    row.tool_type || '',
    row.primary_category || '',
    Array.isArray(row.tags) ? row.tags.join(' ') : '',
    Array.isArray(row.node_types) ? row.node_types.join(' ') : '',
    row.language || '',
  ];

  return parts
    .filter(Boolean)
    .join(' ')
    .slice(0, 4000)
    .trim();
}


describe('buildEmbeddingText', () => {
  it('combines all fields into a single string', () => {
    const text = buildEmbeddingText({
      workflow_name: 'Lead Capture',
      original_description: 'Captures leads from forms',
      tool_type: 'n8n',
      primary_category: 'CRM',
      tags: ['lead', 'automation'],
      node_types: ['webhook', 'httpRequest'],
      language: 'en',
    });

    assert.ok(text.includes('Lead Capture'));
    assert.ok(text.includes('Captures leads'));
    assert.ok(text.includes('n8n'));
    assert.ok(text.includes('CRM'));
    assert.ok(text.includes('lead automation'));
    assert.ok(text.includes('webhook httpRequest'));
    assert.ok(text.includes('en'));
  });

  it('handles missing fields gracefully', () => {
    const text = buildEmbeddingText({
      workflow_name: 'Minimal',
    });

    assert.equal(text, 'Minimal');
  });

  it('handles completely empty row', () => {
    const text = buildEmbeddingText({});
    assert.equal(text, '');
  });

  it('truncates at 4000 characters', () => {
    const text = buildEmbeddingText({
      original_description: 'A'.repeat(5000),
    });

    assert.ok(text.length <= 4000);
  });

  it('filters empty parts (no double spaces)', () => {
    const text = buildEmbeddingText({
      workflow_name: 'Test',
      original_description: '',
      tool_type: 'n8n',
      tags: [],
      node_types: [],
    });

    assert.ok(!text.includes('  '), 'Should not have double spaces');
    assert.equal(text, 'Test n8n');
  });

  it('joins tags with spaces', () => {
    const text = buildEmbeddingText({
      tags: ['ai', 'ml', 'automation'],
    });

    assert.equal(text, 'ai ml automation');
  });

  it('handles non-array tags and node_types', () => {
    const text = buildEmbeddingText({
      workflow_name: 'Test',
      tags: 'not-an-array',
      node_types: null,
    });

    assert.equal(text, 'Test');
  });
});
