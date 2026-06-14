// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #872 — Conflict Resolver (dedicated)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CONFLICT_TYPES, RESOLUTION_STRATEGIES } from '../../src/self-maintenance/conflict-resolver.js';

describe('Conflict Resolver (source import)', () => {
  describe('CONFLICT_TYPES', () => {
    it('should define 4 conflict types', () => { assert.equal(CONFLICT_TYPES.length, 4); });
    it('should include version_mismatch', () => { assert.ok(CONFLICT_TYPES.includes('version_mismatch')); });
    it('should include contradicting_config', () => { assert.ok(CONFLICT_TYPES.includes('contradicting_config')); });
    it('should include duplicate_with_diff', () => { assert.ok(CONFLICT_TYPES.includes('duplicate_with_diff')); });
    it('should include category_inconsistency', () => { assert.ok(CONFLICT_TYPES.includes('category_inconsistency')); });
  });

  describe('RESOLUTION_STRATEGIES', () => {
    it('should have strategy for each conflict type', () => {
      for (const ct of CONFLICT_TYPES) {
        assert.ok(ct in RESOLUTION_STRATEGIES, `Missing strategy for ${ct}`);
      }
    });
    it('should use keep_newer for version_mismatch', () => {
      assert.equal(RESOLUTION_STRATEGIES.version_mismatch, 'keep_newer');
    });
    it('should use manual_review for contradicting_config', () => {
      assert.equal(RESOLUTION_STRATEGIES.contradicting_config, 'manual_review');
    });
    it('should use majority_wins for category_inconsistency', () => {
      assert.equal(RESOLUTION_STRATEGIES.category_inconsistency, 'majority_wins');
    });
  });
});
