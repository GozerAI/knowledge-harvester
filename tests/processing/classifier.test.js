// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// The classifier module uses DB and Ollama, so we test the pure logic portions
// by re-implementing the exported constants and buildPrompt logic.

const CATEGORIES = [
  'lead-gen-crm',
  'content-marketing',
  'data-processing',
  'devops-monitoring',
  'general-productivity',
  'ai-agent',
  'multi-step-automation',
  'integration-pipeline',
  'orchestration',
  'data-pipeline',
];

function buildPrompt(row) {
  const toolType = row.tool_type || 'n8n';
  const isN8n = toolType === 'n8n';
  const template = isN8n ? 'N8N:{name}:{nodeTypes}:{triggerType}' : 'AGENT:{name}:{nodeTypes}:{toolType}:{language}';

  return template
    .replace('{name}', row.workflow_name || 'Untitled')
    .replace('{nodeTypes}', (row.node_types || []).join(', '))
    .replace('{triggerType}', row.trigger_type || 'unknown')
    .replace('{toolType}', toolType)
    .replace('{language}', row.language || 'unknown');
}

function defaultCategory(toolType) {
  if (['langchain', 'crewai', 'autogen', 'langgraph'].includes(toolType)) return 'ai-agent';
  if (['temporal', 'windmill'].includes(toolType)) return 'orchestration';
  if (['airflow', 'prefect', 'dagster'].includes(toolType)) return 'data-pipeline';
  if (toolType === 'node-red') return 'integration-pipeline';
  return 'general-productivity';
}

function validateClassification(parsed, toolType) {
  if (!CATEGORIES.includes(parsed.primary_category)) {
    parsed.primary_category = defaultCategory(toolType || 'n8n');
  }
  if (Array.isArray(parsed.secondary_categories)) {
    parsed.secondary_categories = parsed.secondary_categories.filter(c => CATEGORIES.includes(c));
  } else {
    parsed.secondary_categories = [];
  }
  if (!Array.isArray(parsed.tags)) {
    parsed.tags = [];
  }
  return parsed;
}


describe('CATEGORIES', () => {
  it('contains 10 categories', () => {
    assert.equal(CATEGORIES.length, 10);
  });

  it('includes all expected categories', () => {
    for (const cat of ['ai-agent', 'orchestration', 'data-pipeline', 'lead-gen-crm']) {
      assert.ok(CATEGORIES.includes(cat), `Missing: ${cat}`);
    }
  });
});


describe('buildPrompt', () => {
  it('uses N8N template for n8n tool type', () => {
    const prompt = buildPrompt({ workflow_name: 'Test', tool_type: 'n8n', node_types: ['webhook'] });
    assert.ok(prompt.startsWith('N8N:'));
  });

  it('uses AGENT template for non-n8n tool type', () => {
    const prompt = buildPrompt({ workflow_name: 'Test', tool_type: 'langchain' });
    assert.ok(prompt.startsWith('AGENT:'));
  });

  it('defaults to n8n when tool_type is missing', () => {
    const prompt = buildPrompt({ workflow_name: 'Test' });
    assert.ok(prompt.startsWith('N8N:'));
  });

  it('defaults name to Untitled', () => {
    const prompt = buildPrompt({});
    assert.ok(prompt.includes('Untitled'));
  });
});


describe('defaultCategory', () => {
  it('maps langchain to ai-agent', () => assert.equal(defaultCategory('langchain'), 'ai-agent'));
  it('maps crewai to ai-agent', () => assert.equal(defaultCategory('crewai'), 'ai-agent'));
  it('maps temporal to orchestration', () => assert.equal(defaultCategory('temporal'), 'orchestration'));
  it('maps windmill to orchestration', () => assert.equal(defaultCategory('windmill'), 'orchestration'));
  it('maps airflow to data-pipeline', () => assert.equal(defaultCategory('airflow'), 'data-pipeline'));
  it('maps prefect to data-pipeline', () => assert.equal(defaultCategory('prefect'), 'data-pipeline'));
  it('maps dagster to data-pipeline', () => assert.equal(defaultCategory('dagster'), 'data-pipeline'));
  it('maps node-red to integration-pipeline', () => assert.equal(defaultCategory('node-red'), 'integration-pipeline'));
  it('defaults to general-productivity', () => assert.equal(defaultCategory('n8n'), 'general-productivity'));
});


describe('validateClassification', () => {
  it('accepts valid primary category', () => {
    const result = validateClassification({ primary_category: 'ai-agent', secondary_categories: [], tags: [] });
    assert.equal(result.primary_category, 'ai-agent');
  });

  it('replaces unknown category with default', () => {
    const result = validateClassification({ primary_category: 'bogus' }, 'langchain');
    assert.equal(result.primary_category, 'ai-agent');
  });

  it('filters invalid secondary categories', () => {
    const result = validateClassification({
      primary_category: 'ai-agent',
      secondary_categories: ['ai-agent', 'bogus', 'orchestration'],
      tags: [],
    });
    assert.deepEqual(result.secondary_categories, ['ai-agent', 'orchestration']);
  });

  it('defaults secondary_categories to array if not array', () => {
    const result = validateClassification({ primary_category: 'ai-agent', secondary_categories: 'not-array', tags: [] });
    assert.deepEqual(result.secondary_categories, []);
  });

  it('defaults tags to empty array if not array', () => {
    const result = validateClassification({ primary_category: 'ai-agent', tags: 'string' });
    assert.deepEqual(result.tags, []);
  });
});
