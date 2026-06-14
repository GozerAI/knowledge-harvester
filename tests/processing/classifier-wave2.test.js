// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Reimplemented from updated classifier.js — wave 2 expansion

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
  'ci-cd-pipeline',
  'iot-home-automation',
  'business-process',
  'streaming-realtime',
  'infrastructure-as-code',
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
  if (toolType === 'tekton') return 'ci-cd-pipeline';
  if (toolType === 'github-actions') return 'ci-cd-pipeline';
  if (toolType === 'home-assistant') return 'iot-home-automation';
  if (toolType === 'mlflow') return 'ml-data-ops';
  if (toolType === 'dbt') return 'data-pipeline';
  if (toolType === 'camunda') return 'business-process';
  if (toolType === 'kafka-connect') return 'streaming-realtime';
  if (toolType === 'camel') return 'integration-pipeline';
  return 'general-productivity';
}


describe('CATEGORIES — wave 2', () => {
  it('contains 21 entries', () => {
    assert.equal(CATEGORIES.length, 21);
  });

  it('includes all 5 new wave-2 categories', () => {
    for (const cat of ['ci-cd-pipeline', 'iot-home-automation', 'business-process', 'streaming-realtime', 'infrastructure-as-code']) {
      assert.ok(CATEGORIES.includes(cat), `Missing: ${cat}`);
    }
  });

  it('still includes all 16 wave-1 categories', () => {
    const wave1 = [
      'lead-gen-crm', 'content-marketing', 'data-processing', 'devops-monitoring',
      'general-productivity', 'ai-agent', 'multi-step-automation', 'integration-pipeline',
      'orchestration', 'data-pipeline', 'ai-image-generation', 'security-automation',
      'ecommerce', 'customer-support', 'finance-accounting', 'ml-data-ops',
    ];
    for (const cat of wave1) {
      assert.ok(CATEGORIES.includes(cat), `Missing wave-1: ${cat}`);
    }
  });
});


describe('defaultCategory — wave 2 tool mappings', () => {
  it('maps tekton to ci-cd-pipeline', () => assert.equal(defaultCategory('tekton'), 'ci-cd-pipeline'));
  it('maps github-actions to ci-cd-pipeline', () => assert.equal(defaultCategory('github-actions'), 'ci-cd-pipeline'));
  it('maps home-assistant to iot-home-automation', () => assert.equal(defaultCategory('home-assistant'), 'iot-home-automation'));
  it('maps mlflow to ml-data-ops', () => assert.equal(defaultCategory('mlflow'), 'ml-data-ops'));
  it('maps dbt to data-pipeline', () => assert.equal(defaultCategory('dbt'), 'data-pipeline'));
  it('maps camunda to business-process', () => assert.equal(defaultCategory('camunda'), 'business-process'));
  it('maps kafka-connect to streaming-realtime', () => assert.equal(defaultCategory('kafka-connect'), 'streaming-realtime'));
  it('maps camel to integration-pipeline', () => assert.equal(defaultCategory('camel'), 'integration-pipeline'));
});


describe('defaultCategory — prior mappings unaffected', () => {
  it('still maps langchain to ai-agent', () => assert.equal(defaultCategory('langchain'), 'ai-agent'));
  it('still maps temporal to orchestration', () => assert.equal(defaultCategory('temporal'), 'orchestration'));
});
