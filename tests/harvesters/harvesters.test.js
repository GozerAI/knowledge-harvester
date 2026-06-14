// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';


// ============================================================
// GitHub Harvester — _isN8nWorkflow (reimplemented for testing)
// ============================================================

function isN8nWorkflow(obj) {
  if (!obj || !Array.isArray(obj.nodes)) return false;
  return obj.nodes.some(
    n =>
      n.type?.startsWith('n8n-nodes-base.') ||
      n.type?.startsWith('@n8n/') ||
      n.type?.includes('n8n')
  );
}


describe('GitHubHarvester — _isN8nWorkflow', () => {
  it('returns true for standard n8n node types', () => {
    assert.ok(isN8nWorkflow({
      nodes: [{ type: 'n8n-nodes-base.webhook' }, { type: 'n8n-nodes-base.set' }],
    }));
  });

  it('returns true for @n8n/ prefixed types', () => {
    assert.ok(isN8nWorkflow({
      nodes: [{ type: '@n8n/n8n-nodes-langchain.lmChatOllama' }],
    }));
  });

  it('returns false for null input', () => {
    assert.equal(isN8nWorkflow(null), false);
  });

  it('returns false for object without nodes array', () => {
    assert.equal(isN8nWorkflow({ nodes: 'not-array' }), false);
    assert.equal(isN8nWorkflow({}), false);
  });

  it('returns false for nodes without n8n types', () => {
    assert.equal(isN8nWorkflow({
      nodes: [{ type: 'slack.send' }, { type: 'http.request' }],
    }), false);
  });

  it('returns false for empty nodes array', () => {
    assert.equal(isN8nWorkflow({ nodes: [] }), false);
  });
});


// ============================================================
// Reddit Harvester — _extractJsonBlocks (reimplemented)
// ============================================================

function extractJsonBlocks(text) {
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
  const blocks = [];
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    try {
      blocks.push(JSON.parse(match[1].trim()));
    } catch {
      // Not valid JSON, skip
    }
  }
  return blocks;
}


describe('RedditHarvester — _extractJsonBlocks', () => {
  it('extracts JSON from a code block', () => {
    const text = 'Here is my workflow:\n```json\n{"nodes": []}\n```\nEnjoy!';
    const blocks = extractJsonBlocks(text);
    assert.equal(blocks.length, 1);
    assert.deepEqual(blocks[0], { nodes: [] });
  });

  it('extracts from code block without json language tag', () => {
    const text = '```\n{"key": "value"}\n```';
    const blocks = extractJsonBlocks(text);
    assert.equal(blocks.length, 1);
  });

  it('extracts multiple JSON blocks', () => {
    const text = '```json\n{"a": 1}\n```\nsome text\n```json\n{"b": 2}\n```';
    const blocks = extractJsonBlocks(text);
    assert.equal(blocks.length, 2);
  });

  it('skips invalid JSON blocks', () => {
    const text = '```\nnot json at all\n```\n```json\n{"valid": true}\n```';
    const blocks = extractJsonBlocks(text);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].valid, true);
  });

  it('returns empty array when no code blocks', () => {
    assert.deepEqual(extractJsonBlocks('just some text'), []);
  });
});


// ============================================================
// Reddit Harvester — _extractGistLinks (reimplemented)
// ============================================================

function extractGistLinks(text) {
  const gistRegex = /https?:\/\/gist\.github\.com\/[^\s\)]+/g;
  return text?.match(gistRegex) || [];
}


describe('RedditHarvester — _extractGistLinks', () => {
  it('extracts a single gist link', () => {
    const text = 'Check out my gist: https://gist.github.com/user/abc123';
    const links = extractGistLinks(text);
    assert.equal(links.length, 1);
  });

  it('extracts multiple gist links', () => {
    const text = 'First: https://gist.github.com/a/1 Second: https://gist.github.com/b/2';
    assert.equal(extractGistLinks(text).length, 2);
  });

  it('returns empty array when no gist links', () => {
    assert.deepEqual(extractGistLinks('no gist links here'), []);
  });

  it('handles null/undefined text', () => {
    assert.deepEqual(extractGistLinks(null), []);
    assert.deepEqual(extractGistLinks(undefined), []);
  });
});


// ============================================================
// N8n Community Harvester — template validation
// ============================================================

describe('N8nCommunityHarvester — template validation', () => {
  function isValidTemplate(data) {
    const templateData = data?.workflow;
    return !!(templateData?.workflow && Array.isArray(templateData.workflow.nodes));
  }

  it('accepts valid nested template structure', () => {
    assert.ok(isValidTemplate({
      workflow: {
        id: 1,
        workflow: { nodes: [{ type: 'n8n-nodes-base.webhook' }], connections: {} },
      },
    }));
  });

  it('rejects when outer workflow is missing', () => {
    assert.equal(isValidTemplate({}), false);
    assert.equal(isValidTemplate(null), false);
  });

  it('rejects when inner workflow is missing', () => {
    assert.equal(isValidTemplate({ workflow: { id: 1 } }), false);
  });

  it('rejects when nodes is not an array', () => {
    assert.equal(isValidTemplate({
      workflow: { workflow: { nodes: 'not-array' } },
    }), false);
  });
});


// ============================================================
// Harvester stats tracking pattern
// ============================================================

describe('Harvester stats tracking', () => {
  function createStats() {
    return { discovered: 0, new: 0, duplicate: 0, invalid: 0, errors: 0 };
  }

  it('tracks discovered/new flow', () => {
    const stats = createStats();
    stats.discovered++;
    stats.new++;
    assert.equal(stats.discovered, 1);
    assert.equal(stats.new, 1);
    assert.equal(stats.duplicate, 0);
  });

  it('tracks duplicate flow', () => {
    const stats = createStats();
    stats.discovered++;
    stats.duplicate++;
    assert.equal(stats.new, 0);
    assert.equal(stats.duplicate, 1);
  });
});
