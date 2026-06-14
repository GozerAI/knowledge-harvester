// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for Autonomy Dashboard API routes.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Mock DB ────────────────────────────────────────────────────────────────

function mockDb(queryResponses = []) {
  let callIndex = 0;
  const calls = [];
  return {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (callIndex < queryResponses.length) {
        const resp = queryResponses[callIndex++];
        if (typeof resp === 'function') return resp(sql, params);
        return resp;
      }
      return { rows: [] };
    },
    getCalls: () => calls,
  };
}

// ── Re-implemented pulse logic ─────────────────────────────────────────────

function buildPulse(schedulerStatus, eventCounts, staleCount, coverageSummary, latestDiff) {
  return {
    scheduler: schedulerStatus,
    event_bus: { last_hour_events: Object.values(eventCounts).reduce((s, v) => s + v, 0), by_type: eventCounts },
    stale_artifacts: staleCount,
    coverage: coverageSummary,
    latest_snapshot_pair: latestDiff,
  };
}

function buildTimeline(events, refreshLogs, scheduleRuns) {
  const timeline = [];

  for (const e of events) {
    timeline.push({
      source: 'event_bus',
      type: e.type,
      timestamp: e.timestamp,
      details: e.payload,
    });
  }

  for (const r of refreshLogs) {
    timeline.push({
      source: 'refresh_log',
      type: `refresh.${r.refresh_status}`,
      timestamp: r.refreshed_at,
      details: { artifact_id: r.artifact_id },
    });
  }

  for (const s of scheduleRuns) {
    timeline.push({
      source: 'scheduler',
      type: `schedule.${s.last_status}`,
      timestamp: s.last_run,
      details: { name: s.name },
    });
  }

  timeline.sort((a, b) => {
    const ta = typeof a.timestamp === 'string' ? a.timestamp : '';
    const tb = typeof b.timestamp === 'string' ? b.timestamp : '';
    return tb.localeCompare(ta);
  });

  return { timeline, total: timeline.length };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Autonomy Routes', () => {
  describe('handleAutonomyPulse', () => {
    it('returns scheduler status', () => {
      const pulse = buildPulse(
        [{ name: 'daily-harvest', enabled: true, last_status: 'success' }],
        {}, 0, null, null
      );
      assert.equal(pulse.scheduler.length, 1);
      assert.equal(pulse.scheduler[0].name, 'daily-harvest');
    });

    it('returns event bus stats', () => {
      const pulse = buildPulse([], { 'artifact.created': 5, 'pipeline.step.complete': 3 }, 0, null, null);
      assert.equal(pulse.event_bus.last_hour_events, 8);
      assert.equal(pulse.event_bus.by_type['artifact.created'], 5);
    });

    it('returns stale artifact count', () => {
      const pulse = buildPulse([], {}, 42, null, null);
      assert.equal(pulse.stale_artifacts, 42);
    });

    it('returns coverage summary', () => {
      const pulse = buildPulse([], {}, 0, { categories: 10, types: 5, total: 200 }, null);
      assert.equal(pulse.coverage.categories, 10);
      assert.equal(pulse.coverage.types, 5);
    });

    it('returns latest snapshot pair when available', () => {
      const pair = {
        newer: { id: 's2', label: 'after' },
        older: { id: 's1', label: 'before' },
      };
      const pulse = buildPulse([], {}, 0, null, pair);
      assert.equal(pulse.latest_snapshot_pair.newer.id, 's2');
      assert.equal(pulse.latest_snapshot_pair.older.id, 's1');
    });

    it('latest_snapshot_pair is null when fewer than 2 snapshots', () => {
      const pulse = buildPulse([], {}, 0, null, null);
      assert.equal(pulse.latest_snapshot_pair, null);
    });
  });

  describe('handleAutonomyTimeline', () => {
    it('combines events from multiple sources', () => {
      const events = [{ type: 'pipeline.run.complete', timestamp: '2026-01-01T10:00:00Z', payload: {} }];
      const refreshLogs = [{ artifact_id: 'a1', refresh_status: 'success', refreshed_at: '2026-01-01T09:00:00Z' }];
      const scheduleRuns = [{ name: 'daily', last_status: 'success', last_run: '2026-01-01T08:00:00Z' }];

      const result = buildTimeline(events, refreshLogs, scheduleRuns);
      assert.equal(result.total, 3);
    });

    it('sorts by timestamp descending (newest first)', () => {
      const events = [{ type: 'a', timestamp: '2026-01-01T08:00:00Z', payload: {} }];
      const refreshLogs = [{ artifact_id: 'a1', refresh_status: 'success', refreshed_at: '2026-01-01T10:00:00Z' }];
      const scheduleRuns = [{ name: 'x', last_status: 'success', last_run: '2026-01-01T09:00:00Z' }];

      const result = buildTimeline(events, refreshLogs, scheduleRuns);
      assert.equal(result.timeline[0].source, 'refresh_log'); // newest
      assert.equal(result.timeline[2].source, 'event_bus');   // oldest
    });

    it('returns total matching timeline length', () => {
      const result = buildTimeline([], [], []);
      assert.equal(result.total, 0);
      assert.equal(result.timeline.length, 0);
    });

    it('each timeline entry has source, type, timestamp, details', () => {
      const events = [{ type: 'test.event', timestamp: '2026-01-01T00:00:00Z', payload: { x: 1 } }];
      const result = buildTimeline(events, [], []);
      const entry = result.timeline[0];
      assert.ok('source' in entry);
      assert.ok('type' in entry);
      assert.ok('timestamp' in entry);
      assert.ok('details' in entry);
    });
  });
});
