// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sha256, generateWorkflowHash, generateContentHash } from '../../src/utils/hash.js';


describe('sha256', () => {
  it('returns hex digest', () => {
    const h = sha256('hello');
    assert.equal(h.length, 64);
    assert.match(h, /^[a-f0-9]+$/);
  });

  it('is deterministic', () => {
    assert.equal(sha256('test'), sha256('test'));
  });

  it('differs for different inputs', () => {
    assert.notEqual(sha256('a'), sha256('b'));
  });
});


describe('generateWorkflowHash', () => {
  it('hashes based on node types and connections', () => {
    const wf = {
      nodes: [
        { name: 'Start', type: 'n8n-nodes-base.webhook' },
        { name: 'End', type: 'n8n-nodes-base.set' },
      ],
      connections: {
        Start: { main: [[{ node: 'End', type: 'main', index: 0 }]] },
      },
    };
    const h = generateWorkflowHash(wf);
    assert.equal(h.length, 64);
  });

  it('ignores node names (only uses types)', () => {
    const wf1 = {
      nodes: [
        { name: 'A', type: 'n8n-nodes-base.webhook' },
        { name: 'B', type: 'n8n-nodes-base.set' },
      ],
      connections: { A: { main: [[{ node: 'B', type: 'main', index: 0 }]] } },
    };
    const wf2 = {
      nodes: [
        { name: 'X', type: 'n8n-nodes-base.webhook' },
        { name: 'Y', type: 'n8n-nodes-base.set' },
      ],
      connections: { X: { main: [[{ node: 'Y', type: 'main', index: 0 }]] } },
    };
    assert.equal(generateWorkflowHash(wf1), generateWorkflowHash(wf2));
  });

  it('differs for different node types', () => {
    const wf1 = { nodes: [{ name: 'A', type: 'webhook' }], connections: {} };
    const wf2 = { nodes: [{ name: 'A', type: 'code' }], connections: {} };
    assert.notEqual(generateWorkflowHash(wf1), generateWorkflowHash(wf2));
  });

  it('handles empty workflow', () => {
    const h = generateWorkflowHash({ nodes: [], connections: {} });
    assert.equal(h.length, 64);
  });

  it('handles missing nodes/connections', () => {
    const h = generateWorkflowHash({});
    assert.equal(h.length, 64);
  });
});


describe('generateContentHash', () => {
  it('normalizes whitespace in source code', () => {
    const h1 = generateContentHash('def  hello():\n  pass');
    const h2 = generateContentHash('def  hello():\r\n  pass');
    assert.equal(h1, h2);
  });

  it('strips comments', () => {
    const h1 = generateContentHash('x = 1 # comment\ny = 2');
    const h2 = generateContentHash('x = 1 \ny = 2');
    assert.equal(h1, h2);
  });

  it('includes framework prefix', () => {
    const h1 = generateContentHash('code', 'langchain');
    const h2 = generateContentHash('code', 'crewai');
    assert.notEqual(h1, h2);
  });

  it('handles object content (JSON)', () => {
    const h = generateContentHash({ key: 'value' });
    assert.equal(h.length, 64);
  });

  it('defaults framework to generic', () => {
    const h = generateContentHash('code');
    assert.equal(h.length, 64);
  });
});
