// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #878 — Index Optimizer (dedicated)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TARGET_COLUMNS, INDEX_DEFINITIONS } from '../../src/self-maintenance/index-optimizer.js';

describe('Index Optimizer (source import)', () => {
  it('should target at least 5 columns', () => {
    assert.ok(TARGET_COLUMNS.length >= 5);
  });
  it('should include primary_category', () => {
    assert.ok(TARGET_COLUMNS.includes('primary_category'));
  });
  it('should include artifact_type', () => {
    assert.ok(TARGET_COLUMNS.includes('artifact_type'));
  });
  it('should include quality_score', () => {
    assert.ok(TARGET_COLUMNS.includes('quality_score'));
  });
  it('should include updated_at', () => {
    assert.ok(TARGET_COLUMNS.includes('updated_at'));
  });

  describe('INDEX_DEFINITIONS', () => {
    it('should define at least 5 indexes', () => {
      assert.ok(INDEX_DEFINITIONS.length >= 5);
    });
    it('should have unique index names', () => {
      const names = INDEX_DEFINITIONS.map(d => d.name);
      assert.equal(new Set(names).size, names.length);
    });
    it('should have columns for each definition', () => {
      for (const def of INDEX_DEFINITIONS) {
        assert.ok(def.columns.length > 0, `${def.name} should have columns`);
      }
    });
    it('should have type for each definition', () => {
      for (const def of INDEX_DEFINITIONS) {
        assert.ok(['btree', 'hash', 'gin', 'gist'].includes(def.type), `${def.name} should have valid type`);
      }
    });
    it('should include a composite index', () => {
      assert.ok(INDEX_DEFINITIONS.some(d => d.columns.length > 1));
    });
  });
});
