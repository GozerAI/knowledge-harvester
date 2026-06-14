// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  registerStrategy,
  getStrategy,
  hasStrategy,
  listStrategies,
  clearStrategies,
  registerType,
  ARTIFACT_TYPES,
  PHASES,
} from '../../src/processing/registry.js';

describe('Strategy Registry', () => {
  beforeEach(() => {
    clearStrategies();
  });

  describe('registerStrategy', () => {
    it('should register a strategy for a type and phase', () => {
      const fn = () => {};
      registerStrategy('workflow', 'normalize', fn);
      assert.equal(getStrategy('workflow', 'normalize'), fn);
    });

    it('should throw if fn is not a function', () => {
      assert.throws(
        () => registerStrategy('workflow', 'normalize', 'not-a-fn'),
        /must be a function/
      );
    });

    it('should overwrite existing strategy for same key', () => {
      const fn1 = () => 'first';
      const fn2 = () => 'second';
      registerStrategy('workflow', 'score', fn1);
      registerStrategy('workflow', 'score', fn2);
      assert.equal(getStrategy('workflow', 'score'), fn2);
    });
  });

  describe('getStrategy', () => {
    it('should return null if no strategy registered', () => {
      assert.equal(getStrategy('workflow', 'normalize'), null);
    });

    it('should fall back to default strategy', () => {
      const defaultFn = () => 'default';
      registerStrategy('default', 'score', defaultFn);
      assert.equal(getStrategy('code_pattern', 'score'), defaultFn);
    });

    it('should prefer type-specific over default', () => {
      const defaultFn = () => 'default';
      const specificFn = () => 'specific';
      registerStrategy('default', 'score', defaultFn);
      registerStrategy('workflow', 'score', specificFn);
      assert.equal(getStrategy('workflow', 'score'), specificFn);
    });
  });

  describe('hasStrategy', () => {
    it('should return false when no strategy exists', () => {
      assert.equal(hasStrategy('workflow', 'normalize'), false);
    });

    it('should return true when type-specific strategy exists', () => {
      registerStrategy('workflow', 'normalize', () => {});
      assert.equal(hasStrategy('workflow', 'normalize'), true);
    });

    it('should return true when default strategy exists', () => {
      registerStrategy('default', 'score', () => {});
      assert.equal(hasStrategy('infra_config', 'score'), true);
    });
  });

  describe('listStrategies', () => {
    it('should return empty array when no strategies registered', () => {
      assert.deepEqual(listStrategies(), []);
    });

    it('should return all registered keys', () => {
      registerStrategy('workflow', 'normalize', () => {});
      registerStrategy('workflow', 'score', () => {});
      registerStrategy('default', 'classify', () => {});
      const keys = listStrategies();
      assert.equal(keys.length, 3);
      assert.ok(keys.includes('workflow:normalize'));
      assert.ok(keys.includes('workflow:score'));
      assert.ok(keys.includes('default:classify'));
    });
  });

  describe('clearStrategies', () => {
    it('should remove all strategies', () => {
      registerStrategy('workflow', 'normalize', () => {});
      registerStrategy('code_pattern', 'score', () => {});
      clearStrategies();
      assert.deepEqual(listStrategies(), []);
      assert.equal(getStrategy('workflow', 'normalize'), null);
    });
  });

  describe('registerType', () => {
    it('should register multiple phases at once', () => {
      const normFn = () => 'normalize';
      const scoreFn = () => 'score';
      const classifyFn = () => 'classify';

      registerType('infra_config', {
        normalize: normFn,
        score: scoreFn,
        classify: classifyFn,
      });

      assert.equal(getStrategy('infra_config', 'normalize'), normFn);
      assert.equal(getStrategy('infra_config', 'score'), scoreFn);
      assert.equal(getStrategy('infra_config', 'classify'), classifyFn);
    });
  });

  describe('constants', () => {
    it('ARTIFACT_TYPES should include all 7 types', () => {
      assert.equal(ARTIFACT_TYPES.length, 7);
      assert.ok(ARTIFACT_TYPES.includes('workflow'));
      assert.ok(ARTIFACT_TYPES.includes('code_pattern'));
      assert.ok(ARTIFACT_TYPES.includes('api_spec'));
      assert.ok(ARTIFACT_TYPES.includes('infra_config'));
      assert.ok(ARTIFACT_TYPES.includes('ai_ml_asset'));
      assert.ok(ARTIFACT_TYPES.includes('data_asset'));
      assert.ok(ARTIFACT_TYPES.includes('documentation'));
    });

    it('PHASES should include all 6 phases', () => {
      assert.equal(PHASES.length, 6);
      assert.ok(PHASES.includes('normalize'));
      assert.ok(PHASES.includes('classify'));
      assert.ok(PHASES.includes('score'));
      assert.ok(PHASES.includes('package'));
      assert.ok(PHASES.includes('complexity'));
      assert.ok(PHASES.includes('validate'));
    });
  });
});
