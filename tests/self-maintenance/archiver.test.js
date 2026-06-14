// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #877 — Knowledge Archival (dedicated)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ARCHIVE_POLICIES } from '../../src/self-maintenance/archiver.js';

describe('Archiver (source import)', () => {
  it('should define at least 4 archive policies', () => {
    assert.ok(Object.keys(ARCHIVE_POLICIES).length >= 4);
  });
  it('should have expired policy at 365 days', () => {
    assert.equal(ARCHIVE_POLICIES.expired.maxAgeDays, 365);
  });
  it('should have low_quality threshold at 20', () => {
    assert.equal(ARCHIVE_POLICIES.low_quality.minQuality, 20);
  });
  it('should have superseded policy', () => {
    assert.ok('superseded' in ARCHIVE_POLICIES);
  });
  it('should have broken_source policy', () => {
    assert.ok('broken_source' in ARCHIVE_POLICIES);
  });
  it('should have maxAgeDays for all policies', () => {
    for (const [name, policy] of Object.entries(ARCHIVE_POLICIES)) {
      assert.ok('maxAgeDays' in policy, `${name} should have maxAgeDays`);
    }
  });
});
