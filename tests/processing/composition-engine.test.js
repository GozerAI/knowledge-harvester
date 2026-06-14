// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Reimplemented from composition-engine.js

const COMPATIBLE_CATEGORIES = {
  'data-pipeline': ['ml-data-ops', 'data-processing', 'streaming-realtime'],
  'ml-data-ops': ['data-pipeline', 'ai-agent', 'data-processing'],
  'ci-cd-pipeline': ['devops-monitoring', 'infrastructure-as-code'],
  'iot-home-automation': ['integration-pipeline', 'streaming-realtime'],
  'business-process': ['integration-pipeline', 'general-productivity'],
  'streaming-realtime': ['data-pipeline', 'integration-pipeline', 'iot-home-automation'],
  'integration-pipeline': ['multi-step-automation', 'business-process', 'streaming-realtime'],
  'ai-agent': ['ml-data-ops', 'data-processing'],
  'devops-monitoring': ['ci-cd-pipeline', 'infrastructure-as-code'],
  'lead-gen-crm': ['content-marketing', 'ecommerce'],
};

function findCompatibleWorkflows(workflow, candidates, opts = {}) {
  const { qualityThreshold = 30 } = opts;
  const category = workflow.primary_category;
  const compatCats = COMPATIBLE_CATEGORIES[category] || [];
  if (compatCats.length === 0) return [];

  const results = [];
  for (const candidate of candidates) {
    if (candidate.quality_score < qualityThreshold) continue;
    if (!compatCats.includes(candidate.primary_category)) continue;

    let score = 50; // base compatibility score

    // Same tool_type bonus
    if (candidate.tool_type === workflow.tool_type) score += 20;

    // Credential overlap bonus
    const wCreds = new Set(workflow.credentials_required || []);
    const cCreds = candidate.credentials_required || [];
    const overlap = cCreds.filter(c => wCreds.has(c)).length;
    score += overlap * 10;

    results.push({ workflow: candidate, compatibilityScore: Math.min(score, 100) });
  }

  return results.sort((a, b) => b.compatibilityScore - a.compatibilityScore);
}


describe('findCompatibleWorkflows — category compatibility', () => {
  it('finds compatible workflows for data-pipeline → ml-data-ops', () => {
    const workflow = { primary_category: 'data-pipeline', tool_type: 'airflow', credentials_required: [] };
    const candidates = [
      { primary_category: 'ml-data-ops', tool_type: 'mlflow', quality_score: 50, credentials_required: [] },
      { primary_category: 'lead-gen-crm', tool_type: 'n8n', quality_score: 50, credentials_required: [] },
    ];
    const results = findCompatibleWorkflows(workflow, candidates);
    assert.equal(results.length, 1);
    assert.equal(results[0].workflow.primary_category, 'ml-data-ops');
  });

  it('returns empty for incompatible categories', () => {
    const workflow = { primary_category: 'ai-image-generation', tool_type: 'comfyui', credentials_required: [] };
    const candidates = [
      { primary_category: 'lead-gen-crm', tool_type: 'n8n', quality_score: 50, credentials_required: [] },
    ];
    const results = findCompatibleWorkflows(workflow, candidates);
    assert.equal(results.length, 0);
  });
});


describe('findCompatibleWorkflows — scoring bonuses', () => {
  it('gives same tool_type a bonus score', () => {
    const workflow = { primary_category: 'data-pipeline', tool_type: 'airflow', credentials_required: [] };
    const candidates = [
      { primary_category: 'ml-data-ops', tool_type: 'airflow', quality_score: 50, credentials_required: [] },
      { primary_category: 'ml-data-ops', tool_type: 'mlflow', quality_score: 50, credentials_required: [] },
    ];
    const results = findCompatibleWorkflows(workflow, candidates);
    assert.equal(results.length, 2);
    assert.ok(results[0].compatibilityScore > results[1].compatibilityScore);
  });

  it('boosts score for credential overlap', () => {
    const workflow = { primary_category: 'data-pipeline', tool_type: 'airflow', credentials_required: ['aws', 'postgres'] };
    const candidates = [
      { primary_category: 'ml-data-ops', tool_type: 'mlflow', quality_score: 50, credentials_required: ['aws', 'postgres'] },
      { primary_category: 'ml-data-ops', tool_type: 'mlflow', quality_score: 50, credentials_required: [] },
    ];
    const results = findCompatibleWorkflows(workflow, candidates);
    assert.ok(results[0].compatibilityScore > results[1].compatibilityScore);
  });
});


describe('findCompatibleWorkflows — quality threshold', () => {
  it('respects quality threshold', () => {
    const workflow = { primary_category: 'data-pipeline', tool_type: 'airflow', credentials_required: [] };
    const candidates = [
      { primary_category: 'ml-data-ops', tool_type: 'mlflow', quality_score: 20, credentials_required: [] },
      { primary_category: 'ml-data-ops', tool_type: 'mlflow', quality_score: 50, credentials_required: [] },
    ];
    const results = findCompatibleWorkflows(workflow, candidates, { qualityThreshold: 30 });
    assert.equal(results.length, 1);
    assert.equal(results[0].workflow.quality_score, 50);
  });

  it('caps compatibility score at 100', () => {
    const workflow = { primary_category: 'data-pipeline', tool_type: 'dbt', credentials_required: ['a', 'b', 'c', 'd', 'e', 'f'] };
    const candidates = [
      { primary_category: 'ml-data-ops', tool_type: 'dbt', quality_score: 50, credentials_required: ['a', 'b', 'c', 'd', 'e', 'f'] },
    ];
    const results = findCompatibleWorkflows(workflow, candidates);
    assert.ok(results[0].compatibilityScore <= 100);
  });

  it('returns empty when no candidates pass threshold', () => {
    const workflow = { primary_category: 'data-pipeline', tool_type: 'airflow', credentials_required: [] };
    const candidates = [
      { primary_category: 'ml-data-ops', tool_type: 'mlflow', quality_score: 10, credentials_required: [] },
    ];
    const results = findCompatibleWorkflows(workflow, candidates, { qualityThreshold: 50 });
    assert.equal(results.length, 0);
  });
});
