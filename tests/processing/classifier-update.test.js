// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Reimplemented from updated classifier.js

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
  'ai-image-generation',
  'security-automation',
  'ecommerce',
  'customer-support',
  'finance-accounting',
  'ml-data-ops',
];

function defaultCategory(toolType) {
  if (['langchain', 'crewai', 'autogen', 'langgraph'].includes(toolType)) return 'ai-agent';
  if (['temporal', 'windmill'].includes(toolType)) return 'orchestration';
  if (['airflow', 'prefect', 'dagster'].includes(toolType)) return 'data-pipeline';
  if (toolType === 'node-red') return 'integration-pipeline';
  if (toolType === 'comfyui') return 'ai-image-generation';
  if (toolType === 'dify' || toolType === 'flowise') return 'ai-agent';
  if (toolType === 'pipedream') return 'multi-step-automation';
  if (toolType === 'argo') return 'orchestration';
  if (toolType === 'luigi') return 'data-pipeline';
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
  if (!Array.isArray(parsed.tags)) parsed.tags = [];
  return parsed;
}


describe('CATEGORIES — updated', () => {
  it('contains 16 categories', () => {
    assert.equal(CATEGORIES.length, 16);
  });

  it('includes all 6 new categories', () => {
    for (const cat of ['ai-image-generation', 'security-automation', 'ecommerce', 'customer-support', 'finance-accounting', 'ml-data-ops']) {
      assert.ok(CATEGORIES.includes(cat), `Missing: ${cat}`);
    }
  });

  it('still includes all 10 original categories', () => {
    for (const cat of ['lead-gen-crm', 'content-marketing', 'data-processing', 'devops-monitoring', 'general-productivity', 'ai-agent', 'multi-step-automation', 'integration-pipeline', 'orchestration', 'data-pipeline']) {
      assert.ok(CATEGORIES.includes(cat), `Missing original: ${cat}`);
    }
  });
});


describe('defaultCategory — new tool types', () => {
  it('maps comfyui to ai-image-generation', () => assert.equal(defaultCategory('comfyui'), 'ai-image-generation'));
  it('maps dify to ai-agent', () => assert.equal(defaultCategory('dify'), 'ai-agent'));
  it('maps flowise to ai-agent', () => assert.equal(defaultCategory('flowise'), 'ai-agent'));
  it('maps pipedream to multi-step-automation', () => assert.equal(defaultCategory('pipedream'), 'multi-step-automation'));
  it('maps argo to orchestration', () => assert.equal(defaultCategory('argo'), 'orchestration'));
  it('maps luigi to data-pipeline', () => assert.equal(defaultCategory('luigi'), 'data-pipeline'));
});


describe('defaultCategory — original mappings still work', () => {
  it('maps langchain to ai-agent', () => assert.equal(defaultCategory('langchain'), 'ai-agent'));
  it('maps temporal to orchestration', () => assert.equal(defaultCategory('temporal'), 'orchestration'));
  it('maps airflow to data-pipeline', () => assert.equal(defaultCategory('airflow'), 'data-pipeline'));
  it('maps node-red to integration-pipeline', () => assert.equal(defaultCategory('node-red'), 'integration-pipeline'));
  it('defaults to general-productivity', () => assert.equal(defaultCategory('n8n'), 'general-productivity'));
});


describe('validateClassification — new categories', () => {
  it('accepts ai-image-generation as valid', () => {
    const result = validateClassification({ primary_category: 'ai-image-generation', tags: [] });
    assert.equal(result.primary_category, 'ai-image-generation');
  });

  it('accepts security-automation as valid', () => {
    const result = validateClassification({ primary_category: 'security-automation', tags: [] });
    assert.equal(result.primary_category, 'security-automation');
  });

  it('accepts ecommerce as valid', () => {
    const result = validateClassification({ primary_category: 'ecommerce', tags: [] });
    assert.equal(result.primary_category, 'ecommerce');
  });

  it('replaces unknown with comfyui default', () => {
    const result = validateClassification({ primary_category: 'bogus' }, 'comfyui');
    assert.equal(result.primary_category, 'ai-image-generation');
  });

  it('filters new categories in secondary', () => {
    const result = validateClassification({
      primary_category: 'ai-agent',
      secondary_categories: ['ai-image-generation', 'bogus', 'ml-data-ops'],
      tags: [],
    });
    assert.deepEqual(result.secondary_categories, ['ai-image-generation', 'ml-data-ops']);
  });
});


describe('scorer — new source quality (reimplemented)', () => {
  function calculateScore(w) {
    let score = 0;
    if (w.workflow_name && !w.workflow_name.includes('Untitled')) score += 10;
    if (w.original_description?.length > 50) score += 10;
    if (w.original_description?.length > 200) score += 10;
    const nodeCount = w.node_count || 0;
    if (nodeCount >= 3) score += 5;
    if (nodeCount >= 5) score += 5;
    if (nodeCount >= 8) score += 5;
    if (nodeCount >= 12) score += 5;
    if (w.has_code_node) score += 5;
    if (w.source === 'n8n-community') score += 20;
    else if (w.source === 'activepieces' || w.source === 'node-red') score += 15;
    else if (w.source === 'github') score += 10;
    else if (w.source === 'windmill' || w.source === 'temporal' || w.source === 'airflow') score += 10;
    else if (w.source === 'prefect' || w.source === 'dagster' || w.source === 'langgraph') score += 10;
    else if (w.source === 'github-agents' || w.source === 'github-zapier-make') score += 10;
    else if (w.source === 'comfyui' || w.source === 'dify' || w.source === 'flowise') score += 10;
    else if (w.source === 'pipedream' || w.source === 'argo' || w.source === 'luigi') score += 10;
    else if (w.source === 'reddit') score += 5;
    const credCount = w.credentials_required?.length || 0;
    if (credCount === 0) score += 10;
    else if (credCount <= 2) score += 5;
    if (w.trigger_type === 'webhook') score += 5;
    if (w.trigger_type === 'cron') score += 5;
    if (!w.has_code_node) score += 5;
    return Math.min(score, 100);
  }

  it('gives 10 points to comfyui source', () => {
    const base = { workflow_name: 'X', node_count: 1, credentials_required: [] };
    const comfyui = calculateScore({ ...base, source: 'comfyui' });
    const reddit = calculateScore({ ...base, source: 'reddit' });
    assert.ok(comfyui > reddit);
  });

  it('gives same score to all new sources', () => {
    const base = { workflow_name: 'X', node_count: 1, credentials_required: [] };
    const scores = ['comfyui', 'dify', 'flowise', 'pipedream', 'argo', 'luigi']
      .map(source => calculateScore({ ...base, source }));
    assert.ok(scores.every(s => s === scores[0]));
  });

  it('new sources score same as github-agents', () => {
    const base = { workflow_name: 'X', node_count: 1, credentials_required: [] };
    const agentScore = calculateScore({ ...base, source: 'github-agents' });
    const argoScore = calculateScore({ ...base, source: 'argo' });
    assert.equal(agentScore, argoScore);
  });
});
