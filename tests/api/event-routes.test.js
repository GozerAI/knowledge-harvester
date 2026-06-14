// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for event route handler logic.
 *
 * Re-implements handlers locally with a mock event bus for unit testing.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Minimal EventBus mock ──────────────────────────────────────────────────

class MockEventBus {
  constructor() {
    this._events = [];
  }

  history(type, limit = 50) {
    let events = type
      ? this._events.filter(e => e.type === type)
      : [...this._events];
    return events.slice(-limit);
  }

  addEvent(type, payload = {}) {
    this._events.push({
      event_id: `mock-${this._events.length}`,
      timestamp: new Date().toISOString(),
      type,
      source: 'test',
      payload,
    });
  }
}

// ── Re-implemented handler logic ───────────────────────────────────────────

function handleEventHistoryLogic(bus, type, limit) {
  const events = bus.history(type, limit);
  return { status: 200, body: { events, total: events.length } };
}

function buildSSEHeaders() {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  };
}

function formatSSE(event) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Event Routes', () => {
  let bus;

  beforeEach(() => {
    bus = new MockEventBus();
  });

  describe('handleEventHistory', () => {
    it('returns events array', () => {
      bus.addEvent('test', { x: 1 });
      const result = handleEventHistoryLogic(bus, undefined, 50);
      assert.equal(result.status, 200);
      assert.ok(Array.isArray(result.body.events));
      assert.equal(result.body.events.length, 1);
    });

    it('filters by type', () => {
      bus.addEvent('a', {});
      bus.addEvent('b', {});
      bus.addEvent('a', {});
      const result = handleEventHistoryLogic(bus, 'a', 50);
      assert.equal(result.body.events.length, 2);
    });

    it('respects limit', () => {
      for (let i = 0; i < 10; i++) bus.addEvent('test', { i });
      const result = handleEventHistoryLogic(bus, undefined, 3);
      assert.equal(result.body.events.length, 3);
    });

    it('returns total count', () => {
      bus.addEvent('test', {});
      bus.addEvent('test', {});
      const result = handleEventHistoryLogic(bus, undefined, 50);
      assert.equal(result.body.total, 2);
    });

    it('returns empty array when no events', () => {
      const result = handleEventHistoryLogic(bus, undefined, 50);
      assert.equal(result.body.events.length, 0);
      assert.equal(result.body.total, 0);
    });
  });

  describe('SSE format', () => {
    it('sets correct Content-Type header', () => {
      const headers = buildSSEHeaders();
      assert.equal(headers['Content-Type'], 'text/event-stream');
    });

    it('sets Cache-Control to no-cache', () => {
      const headers = buildSSEHeaders();
      assert.equal(headers['Cache-Control'], 'no-cache');
    });

    it('sets Connection to keep-alive', () => {
      const headers = buildSSEHeaders();
      assert.equal(headers['Connection'], 'keep-alive');
    });

    it('formats event with data: prefix and double newline', () => {
      const event = { type: 'test', payload: { x: 1 } };
      const formatted = formatSSE(event);
      assert.ok(formatted.startsWith('data: '));
      assert.ok(formatted.endsWith('\n\n'));
    });

    it('SSE data is valid JSON after stripping prefix', () => {
      const event = { type: 'test', payload: { x: 1 } };
      const formatted = formatSSE(event);
      const jsonStr = formatted.replace('data: ', '').trim();
      const parsed = JSON.parse(jsonStr);
      assert.equal(parsed.type, 'test');
      assert.equal(parsed.payload.x, 1);
    });
  });
});
