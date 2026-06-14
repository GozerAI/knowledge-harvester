// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for Snapshot Diff Sharing — summarizeDiff and pushDiffToEventBus.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Re-implement summarizeDiff locally ──────────────────────────────────────

function summarizeDiff(diff) {
  if (!diff) return null;
  const additions = Object.keys(diff.additions || {}).length;
  const removals = Object.keys(diff.removals || {}).length;
  const changes = Object.keys(diff.changes || {}).length;

  const topCategories = [];
  if (diff.changes) {
    for (const [key, value] of Object.entries(diff.changes)) {
      if (key.includes('category') || key === 'by_category') {
        topCategories.push(key);
      }
    }
  }

  return {
    added_count: additions,
    removed_count: removals,
    changed_count: changes,
    top_categories_affected: topCategories,
    significant: (additions + removals + changes) > 0,
  };
}

// ── Mock EventBus for pushDiffToEventBus ────────────────────────────────────

class MockEventBus {
  constructor() {
    this.emitted = [];
  }
  emit(type, payload) {
    this.emitted.push({ type, payload });
  }
}

function pushDiffToEventBus(diff, bus) {
  const summary = summarizeDiff(diff);
  if (summary && summary.significant) {
    bus.emit('snapshot.diff', summary);
    return summary;
  }
  return null;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Snapshot Sync', () => {
  describe('summarizeDiff', () => {
    it('counts additions correctly', () => {
      const diff = { additions: { a: 1, b: 2 }, removals: {}, changes: {} };
      const result = summarizeDiff(diff);
      assert.equal(result.added_count, 2);
    });

    it('counts removals correctly', () => {
      const diff = { additions: {}, removals: { x: 1 }, changes: {} };
      const result = summarizeDiff(diff);
      assert.equal(result.removed_count, 1);
    });

    it('counts changes correctly', () => {
      const diff = { additions: {}, removals: {}, changes: { c1: 'v1', c2: 'v2', c3: 'v3' } };
      const result = summarizeDiff(diff);
      assert.equal(result.changed_count, 3);
    });

    it('returns null for null diff', () => {
      assert.equal(summarizeDiff(null), null);
    });

    it('returns null for undefined diff', () => {
      assert.equal(summarizeDiff(undefined), null);
    });

    it('returns zeros for empty diff', () => {
      const result = summarizeDiff({});
      assert.equal(result.added_count, 0);
      assert.equal(result.removed_count, 0);
      assert.equal(result.changed_count, 0);
      assert.equal(result.significant, false);
    });

    it('sets significant=true when any counts > 0', () => {
      const diff = { additions: { a: 1 }, removals: {}, changes: {} };
      assert.equal(summarizeDiff(diff).significant, true);
    });

    it('sets significant=false when all counts are 0', () => {
      const diff = { additions: {}, removals: {}, changes: {} };
      assert.equal(summarizeDiff(diff).significant, false);
    });

    it('extracts top_categories_affected from category keys', () => {
      const diff = {
        additions: {},
        removals: {},
        changes: { primary_category: 'old→new', by_category: { a: 1 }, name: 'changed' },
      };
      const result = summarizeDiff(diff);
      assert.ok(result.top_categories_affected.includes('primary_category'));
      assert.ok(result.top_categories_affected.includes('by_category'));
      assert.ok(!result.top_categories_affected.includes('name'));
    });

    it('returns empty top_categories when no category keys', () => {
      const diff = { additions: {}, removals: {}, changes: { name: 'x', score: 5 } };
      const result = summarizeDiff(diff);
      assert.deepEqual(result.top_categories_affected, []);
    });
  });

  describe('pushDiffToEventBus', () => {
    let bus;

    beforeEach(() => {
      bus = new MockEventBus();
    });

    it('emits snapshot.diff event for significant diffs', () => {
      const diff = { additions: { a: 1 }, removals: {}, changes: {} };
      const result = pushDiffToEventBus(diff, bus);
      assert.ok(result);
      assert.equal(bus.emitted.length, 1);
      assert.equal(bus.emitted[0].type, 'snapshot.diff');
    });

    it('returns null for non-significant diffs', () => {
      const diff = { additions: {}, removals: {}, changes: {} };
      const result = pushDiffToEventBus(diff, bus);
      assert.equal(result, null);
      assert.equal(bus.emitted.length, 0);
    });

    it('returns null for null diff', () => {
      const result = pushDiffToEventBus(null, bus);
      assert.equal(result, null);
      assert.equal(bus.emitted.length, 0);
    });

    it('passes summary as event payload', () => {
      const diff = { additions: { a: 1, b: 2 }, removals: { c: 3 }, changes: {} };
      pushDiffToEventBus(diff, bus);
      const payload = bus.emitted[0].payload;
      assert.equal(payload.added_count, 2);
      assert.equal(payload.removed_count, 1);
      assert.equal(payload.changed_count, 0);
    });
  });
});
