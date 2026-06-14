// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #876 — Cross-Reference Validator (dedicated)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VALIDATION_DIMENSIONS } from '../../src/self-maintenance/cross-ref-validator.js';

describe('Cross-Reference Validator (source import)', () => {
  it('should define at least 2 validation dimensions', () => {
    assert.ok(VALIDATION_DIMENSIONS.length >= 2);
  });
  it('should include relation_integrity', () => {
    assert.ok(VALIDATION_DIMENSIONS.includes('relation_integrity'));
  });
  it('should include bidirectional_consistency', () => {
    assert.ok(VALIDATION_DIMENSIONS.includes('bidirectional_consistency'));
  });
  it('should include reference_freshness', () => {
    assert.ok(VALIDATION_DIMENSIONS.includes('reference_freshness'));
  });
  it('should include type_compatibility', () => {
    assert.ok(VALIDATION_DIMENSIONS.includes('type_compatibility'));
  });
});
