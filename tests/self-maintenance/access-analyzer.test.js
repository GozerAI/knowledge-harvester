// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #882 — Access Pattern Analyzer (dedicated)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ANALYSIS_DIMENSIONS } from '../../src/self-maintenance/access-analyzer.js';

describe('Access Analyzer (source import)', () => {
  it('should define 4 analysis dimensions', () => {
    assert.equal(ANALYSIS_DIMENSIONS.length, 4);
  });
  it('should include popular', () => {
    assert.ok(ANALYSIS_DIMENSIONS.includes('popular'));
  });
  it('should include neglected', () => {
    assert.ok(ANALYSIS_DIMENSIONS.includes('neglected'));
  });
  it('should include by_category', () => {
    assert.ok(ANALYSIS_DIMENSIONS.includes('by_category'));
  });
  it('should include time_patterns', () => {
    assert.ok(ANALYSIS_DIMENSIONS.includes('time_patterns'));
  });
});
