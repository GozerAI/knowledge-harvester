// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  registerStrategy,
  getStrategy,
  clearStrategies,
  registerType,
  ARTIFACT_TYPES,
} from '../../src/processing/registry.js';
import { runPhase, runPhaseAll } from '../../src/processing/pipeline.js';

describe('Pipeline Orchestrator', () => {
  beforeEach(() => {
    clearStrategies();
  });

  describe('runPhase', () => {
    it('should execute registered strategy', async () => {
      registerStrategy('workflow', 'score', (limit) => ({ scored: limit }));
      const result = await runPhase('workflow', 'score', 50);
      assert.deepEqual(result, { scored: 50 });
    });

    it('should return null when no strategy registered', async () => {
      const result = await runPhase('code_pattern', 'score', 50);
      assert.equal(result, null);
    });

    it('should fall back to default strategy', async () => {
      registerStrategy('default', 'classify', () => ({ classified: true }));
      const result = await runPhase('api_spec', 'classify');
      assert.deepEqual(result, { classified: true });
    });

    it('should pass all arguments to strategy', async () => {
      registerStrategy('workflow', 'normalize', (source, data) => ({
        source, name: data.name,
      }));
      const result = await runPhase('workflow', 'normalize', 'github', { name: 'test' });
      assert.deepEqual(result, { source: 'github', name: 'test' });
    });
  });

  describe('runPhaseAll', () => {
    it('should run phase for all types that have strategies', async () => {
      registerStrategy('workflow', 'score', () => ({ type: 'workflow' }));
      registerStrategy('code_pattern', 'score', () => ({ type: 'code_pattern' }));

      const results = await runPhaseAll('score');
      assert.equal(results.size, 2);
      assert.deepEqual(results.get('workflow'), { type: 'workflow' });
      assert.deepEqual(results.get('code_pattern'), { type: 'code_pattern' });
    });

    it('should skip types without strategies', async () => {
      registerStrategy('workflow', 'normalize', () => 'ok');
      const results = await runPhaseAll('normalize');
      assert.equal(results.size, 1);
      assert.ok(results.has('workflow'));
      assert.ok(!results.has('code_pattern'));
    });

    it('should handle strategy errors gracefully', async () => {
      registerStrategy('workflow', 'score', () => {
        throw new Error('scoring broke');
      });
      registerStrategy('code_pattern', 'score', () => ({ ok: true }));

      const results = await runPhaseAll('score');
      assert.equal(results.size, 2);
      assert.ok(results.get('workflow').error);
      assert.deepEqual(results.get('code_pattern'), { ok: true });
    });

    it('should pass arguments to all strategies', async () => {
      registerStrategy('workflow', 'classify', (limit) => ({ limit }));
      registerStrategy('infra_config', 'classify', (limit) => ({ limit }));

      const results = await runPhaseAll('classify', 25);
      assert.deepEqual(results.get('workflow'), { limit: 25 });
      assert.deepEqual(results.get('infra_config'), { limit: 25 });
    });

    it('should use default strategy for types without specific registration', async () => {
      registerStrategy('default', 'score', () => ({ default: true }));
      registerStrategy('workflow', 'score', () => ({ workflow: true }));

      const results = await runPhaseAll('score');
      // workflow gets its specific strategy
      assert.deepEqual(results.get('workflow'), { workflow: true });
      // All other types get the default
      assert.deepEqual(results.get('code_pattern'), { default: true });
      assert.deepEqual(results.get('infra_config'), { default: true });
    });
  });
});

describe('Workflow Strategy Registration (simulated)', () => {
  beforeEach(() => {
    clearStrategies();
  });

  it('should register all 5 phases via registerType', () => {
    // Simulate what registerWorkflowStrategies() does without importing
    // the real processors (which need pg/database)
    registerType('workflow', {
      normalize: () => {},
      classify: () => {},
      score: () => {},
      package: () => {},
      complexity: () => {},
    });

    const phases = ['normalize', 'classify', 'score', 'package', 'complexity'];
    for (const phase of phases) {
      assert.ok(
        getStrategy('workflow', phase) !== null,
        `Missing strategy for workflow:${phase}`
      );
    }
  });

  it('should allow querying registered workflow strategies', () => {
    registerType('workflow', {
      normalize: (src, data) => ({ src, data }),
      score: (limit) => limit,
    });

    const norm = getStrategy('workflow', 'normalize');
    const score = getStrategy('workflow', 'score');
    assert.ok(typeof norm === 'function');
    assert.ok(typeof score === 'function');
    assert.deepEqual(norm('github', { name: 'x' }), { src: 'github', data: { name: 'x' } });
    assert.equal(score(50), 50);
  });
});
