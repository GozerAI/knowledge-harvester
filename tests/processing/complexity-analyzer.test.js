// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Reimplemented from complexity-analyzer.js

function calculateComplexityBreakdown(row) {
  const structural = Math.min(calculateStructural(row), 20);
  const integration = Math.min(calculateIntegration(row), 20);
  const logic = Math.min(calculateLogic(row), 20);
  const data = Math.min(calculateData(row), 20);
  const operational = Math.min(calculateOperational(row), 20);
  const total = Math.min(structural + integration + logic + data + operational, 100);
  return { structural, integration, logic, data, operational, total };
}

function calculateStructural(row) {
  const nodeCount = row.node_count || 0;
  if (nodeCount >= 20) return 20;
  if (nodeCount >= 12) return 15;
  if (nodeCount >= 8) return 10;
  if (nodeCount >= 4) return 5;
  return 2;
}

function calculateIntegration(row) {
  const credCount = (row.credentials_required || []).length;
  if (credCount >= 5) return 20;
  if (credCount >= 3) return 15;
  if (credCount >= 1) return 10;
  return 0;
}

function calculateLogic(row) {
  let score = 0;
  if (row.has_code_node) score += 10;
  const nodeTypes = row.node_types || [];
  const conditionalTypes = ['if', 'switch', 'filter', 'router', 'exclusiveGateway', 'choice'];
  if (nodeTypes.some(t => conditionalTypes.some(c => t.toLowerCase().includes(c)))) score += 10;
  return score;
}

function calculateData(row) {
  let score = 0;
  const nodeTypes = row.node_types || [];
  const dataTypes = ['transform', 'map', 'set', 'aggregate', 'merge', 'split', 'convert'];
  if (nodeTypes.some(t => dataTypes.some(d => t.toLowerCase().includes(d)))) score += 10;
  const description = (row.original_description || '').toLowerCase();
  if (description.includes('etl') || description.includes('transform') || description.includes('pipeline')) score += 10;
  return score;
}

function calculateOperational(row) {
  let score = 0;
  if (row.trigger_type === 'cron' || row.trigger_type === 'schedule') score += 10;
  const description = (row.original_description || '').toLowerCase();
  if (description.includes('retry') || description.includes('error handling') || description.includes('fallback')) score += 10;
  return score;
}


describe('calculateComplexityBreakdown — dimensions', () => {
  it('returns all 5 dimensions plus total', () => {
    const result = calculateComplexityBreakdown({ node_count: 5 });
    assert.ok('structural' in result);
    assert.ok('integration' in result);
    assert.ok('logic' in result);
    assert.ok('data' in result);
    assert.ok('operational' in result);
    assert.ok('total' in result);
  });

  it('total is sum of all dimensions', () => {
    const result = calculateComplexityBreakdown({ node_count: 5, credentials_required: ['a'] });
    assert.equal(result.total, result.structural + result.integration + result.logic + result.data + result.operational);
  });
});


describe('structural scoring', () => {
  it('scores 2 for low node count (<4)', () => {
    assert.equal(calculateComplexityBreakdown({ node_count: 2 }).structural, 2);
  });

  it('scores 5 for 4-7 nodes', () => {
    assert.equal(calculateComplexityBreakdown({ node_count: 5 }).structural, 5);
  });

  it('scores 10 for 8-11 nodes', () => {
    assert.equal(calculateComplexityBreakdown({ node_count: 9 }).structural, 10);
  });

  it('scores 20 for 20+ nodes', () => {
    assert.equal(calculateComplexityBreakdown({ node_count: 25 }).structural, 20);
  });
});


describe('integration scoring', () => {
  it('scores 0 for no credentials', () => {
    assert.equal(calculateComplexityBreakdown({ node_count: 1, credentials_required: [] }).integration, 0);
  });

  it('scores 10 for 1-2 credentials', () => {
    assert.equal(calculateComplexityBreakdown({ node_count: 1, credentials_required: ['a'] }).integration, 10);
  });
});


describe('logic scoring', () => {
  it('scores 10 for code node', () => {
    assert.equal(calculateComplexityBreakdown({ node_count: 1, has_code_node: true }).logic, 10);
  });

  it('scores 10 for conditional node types', () => {
    assert.equal(calculateComplexityBreakdown({ node_count: 1, node_types: ['Switch', 'IF'] }).logic, 10);
  });
});


describe('data scoring', () => {
  it('scores for data transformation node types', () => {
    const result = calculateComplexityBreakdown({ node_count: 1, node_types: ['Set', 'Transform'] });
    assert.ok(result.data >= 10);
  });
});


describe('operational scoring', () => {
  it('scores for cron trigger', () => {
    const result = calculateComplexityBreakdown({ node_count: 1, trigger_type: 'cron' });
    assert.ok(result.operational >= 10);
  });

  it('scores for retry in description', () => {
    const result = calculateComplexityBreakdown({ node_count: 1, original_description: 'Workflow with retry logic and error handling' });
    assert.ok(result.operational >= 10);
  });
});


describe('dimension caps', () => {
  it('each dimension is capped at 20', () => {
    const result = calculateComplexityBreakdown({
      node_count: 100,
      credentials_required: Array(10).fill('c'),
      has_code_node: true,
      node_types: ['Switch', 'Transform', 'Merge', 'Filter', 'Set'],
      trigger_type: 'cron',
      original_description: 'ETL pipeline with retry and error handling and transform',
    });
    assert.ok(result.structural <= 20);
    assert.ok(result.integration <= 20);
    assert.ok(result.logic <= 20);
    assert.ok(result.data <= 20);
    assert.ok(result.operational <= 20);
  });

  it('total is capped at 100', () => {
    const result = calculateComplexityBreakdown({
      node_count: 100,
      credentials_required: Array(10).fill('c'),
      has_code_node: true,
      node_types: ['Switch', 'Transform', 'Merge', 'Filter'],
      trigger_type: 'cron',
      original_description: 'ETL pipeline with retry error handling transform',
    });
    assert.ok(result.total <= 100);
  });
});
