// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  countConnections,
  detectTriggerType,
  extractCredentials,
  estimateComplexity,
  extractNameFromPath,
} from '../../src/utils/helpers.js';


describe('countConnections', () => {
  it('returns 0 for empty workflow', () => {
    assert.equal(countConnections({}), 0);
    assert.equal(countConnections({ connections: {} }), 0);
  });

  it('counts connections in n8n format', () => {
    const workflow = {
      connections: {
        'Start': {
          main: [
            [{ node: 'HTTP Request', type: 'main', index: 0 }]
          ]
        },
        'HTTP Request': {
          main: [
            [
              { node: 'Set', type: 'main', index: 0 },
              { node: 'If', type: 'main', index: 0 },
            ]
          ]
        }
      }
    };
    assert.equal(countConnections(workflow), 3);
  });
});


describe('detectTriggerType', () => {
  it('returns manual for no trigger nodes', () => {
    const w = { nodes: [{ type: 'n8n-nodes-base.set' }] };
    assert.equal(detectTriggerType(w), 'manual');
  });

  it('detects webhook trigger', () => {
    const w = { nodes: [{ type: 'n8n-nodes-base.webhook' }] };
    assert.equal(detectTriggerType(w), 'webhook');
  });

  it('detects cron trigger', () => {
    const w = { nodes: [{ type: 'n8n-nodes-base.scheduleTrigger' }] };
    assert.equal(detectTriggerType(w), 'cron');
  });

  it('detects event trigger', () => {
    const w = { nodes: [{ type: 'n8n-nodes-base.emailTrigger' }] };
    assert.equal(detectTriggerType(w), 'event');
  });

  it('returns manual for empty nodes', () => {
    assert.equal(detectTriggerType({ nodes: [] }), 'manual');
  });
});


describe('extractCredentials', () => {
  it('returns empty for no credentials', () => {
    const w = { nodes: [{ type: 'set' }] };
    assert.deepEqual(extractCredentials(w), []);
  });

  it('extracts and normalizes credential names', () => {
    const w = {
      nodes: [
        { type: 'http', credentials: { 'httpHeaderAuth': {} } },
        { type: 'slack', credentials: { 'slackApi': {} } },
      ]
    };
    const creds = extractCredentials(w);
    assert.ok(creds.includes('httpheaderauth'));
    assert.ok(creds.includes('slack'));
  });

  it('deduplicates credentials', () => {
    const w = {
      nodes: [
        { type: 'a', credentials: { 'slackApi': {} } },
        { type: 'b', credentials: { 'slackApi': {} } },
      ]
    };
    assert.equal(extractCredentials(w).length, 1);
  });
});


describe('estimateComplexity', () => {
  it('returns simple for small workflow', () => {
    const w = { nodes: [{ type: 'set' }, { type: 'set' }] };
    assert.equal(estimateComplexity(w), 'simple');
  });

  it('returns moderate for workflow with branching', () => {
    const nodes = Array.from({ length: 5 }, () => ({ type: 'set' }));
    nodes.push({ type: 'n8n-nodes-base.if' });
    assert.equal(estimateComplexity({ nodes }), 'moderate');
  });

  it('returns complex for large workflow with code and loops', () => {
    const nodes = Array.from({ length: 25 }, () => ({ type: 'set' }));
    nodes.push({ type: 'n8n-nodes-base.code' });
    nodes.push({ type: 'n8n-nodes-base.splitInBatches' });
    nodes.push({ type: 'n8n-nodes-base.if' });
    assert.equal(estimateComplexity({ nodes }), 'complex');
  });
});


describe('extractNameFromPath', () => {
  it('extracts name from file path', () => {
    assert.equal(
      extractNameFromPath('workflows/lead-capture-crm.json'),
      'Lead Capture Crm'
    );
  });

  it('handles underscores', () => {
    assert.equal(
      extractNameFromPath('my_workflow.json'),
      'My Workflow'
    );
  });

  it('handles plain filename', () => {
    assert.equal(extractNameFromPath('hello.json'), 'Hello');
  });
});
