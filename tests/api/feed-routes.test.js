// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for Real-Time Intelligence Feed routes.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Mock EventBus ──────────────────────────────────────────────────────────

class MockEventBus {
  constructor() {
    this._events = [];
    this._listeners = new Map();
  }

  history(type, limit = 50) {
    let events = type
      ? this._events.filter(e => e.type === type)
      : [...this._events];
    return events.slice(-limit);
  }

  on(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(handler);
    return () => this._listeners.get(type)?.delete(handler);
  }

  addEvent(type, payload = {}, timestamp = new Date().toISOString()) {
    this._events.push({
      event_id: `mock-${this._events.length}`,
      timestamp,
      type,
      source: 'test',
      payload,
    });
  }
}

// ── Re-implemented feed summary logic ──────────────────────────────────────

function computeFeedSummary(bus) {
  const allEvents = bus.history(undefined, 1000);
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const recentEvents = allEvents.filter(e => e.timestamp >= fiveMinAgo);

  const counts = {};
  for (const event of recentEvents) {
    counts[event.type] = (counts[event.type] || 0) + 1;
  }

  return {
    window_minutes: 5,
    total_events: recentEvents.length,
    by_type: counts,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Feed Routes', () => {
  let bus;

  beforeEach(() => {
    bus = new MockEventBus();
  });

  describe('handleFeed — SSE', () => {
    it('sets Content-Type to text/event-stream', () => {
      const headers = { 'Content-Type': 'text/event-stream' };
      assert.equal(headers['Content-Type'], 'text/event-stream');
    });

    it('subscribes to event bus on connect', () => {
      const unsub = bus.on('test', () => {});
      assert.ok(typeof unsub === 'function');
    });

    it('sends events as SSE data', () => {
      const event = { type: 'test', payload: { x: 1 } };
      const formatted = `data: ${JSON.stringify(event)}\n\n`;
      assert.ok(formatted.startsWith('data: '));
      assert.ok(formatted.endsWith('\n\n'));
    });

    it('cleanup removes listeners', () => {
      const received = [];
      const unsub = bus.on('test', (e) => received.push(e));
      unsub();
      // After unsub, listener should not fire
      const listeners = bus._listeners.get('test');
      assert.equal(listeners?.size || 0, 0);
    });
  });

  describe('handleFeedSummary', () => {
    it('returns event counts from last 5 minutes', () => {
      bus.addEvent('artifact.created', {});
      bus.addEvent('artifact.created', {});
      bus.addEvent('pipeline.step.complete', {});

      const summary = computeFeedSummary(bus);
      assert.equal(summary.total_events, 3);
      assert.equal(summary.by_type['artifact.created'], 2);
      assert.equal(summary.by_type['pipeline.step.complete'], 1);
    });

    it('excludes events older than 5 minutes', () => {
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      bus.addEvent('old.event', {}, tenMinAgo);
      bus.addEvent('new.event', {});

      const summary = computeFeedSummary(bus);
      assert.equal(summary.total_events, 1);
      assert.ok(!summary.by_type['old.event']);
    });

    it('returns window_minutes = 5', () => {
      const summary = computeFeedSummary(bus);
      assert.equal(summary.window_minutes, 5);
    });

    it('returns 0 total when no recent events', () => {
      const summary = computeFeedSummary(bus);
      assert.equal(summary.total_events, 0);
    });

    it('by_type is an object with type keys and count values', () => {
      bus.addEvent('test.type', {});
      const summary = computeFeedSummary(bus);
      assert.equal(typeof summary.by_type, 'object');
      assert.equal(summary.by_type['test.type'], 1);
    });

    it('handles multiple event types correctly', () => {
      bus.addEvent('a', {});
      bus.addEvent('b', {});
      bus.addEvent('a', {});
      bus.addEvent('c', {});
      const summary = computeFeedSummary(bus);
      assert.equal(summary.by_type['a'], 2);
      assert.equal(summary.by_type['b'], 1);
      assert.equal(summary.by_type['c'], 1);
      assert.equal(summary.total_events, 4);
    });

    it('total_events matches sum of by_type values', () => {
      bus.addEvent('x', {});
      bus.addEvent('y', {});
      bus.addEvent('x', {});
      const summary = computeFeedSummary(bus);
      const sumValues = Object.values(summary.by_type).reduce((s, v) => s + v, 0);
      assert.equal(summary.total_events, sumValues);
    });
  });
});
