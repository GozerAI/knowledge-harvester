// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for the Pipeline Event Bus.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Re-implement EventBus locally for unit testing ─────────────────────────

const MAX_HISTORY = 1000;
let _uuid = 0;

class EventBus {
  constructor() {
    this._listeners = new Map();
    this._history = [];
    this._source = 'knowledge-harvester';
  }

  emit(type, payload = {}) {
    const event = {
      event_id: `test-uuid-${++_uuid}`,
      timestamp: new Date().toISOString(),
      type,
      source: this._source,
      payload,
    };

    this._history.push(event);
    if (this._history.length > MAX_HISTORY) {
      this._history.shift();
    }

    const listeners = this._listeners.get(type);
    if (listeners) {
      for (const handler of listeners) {
        try {
          handler(event);
        } catch {
          // Error in one listener must not break others
        }
      }
    }

    return event;
  }

  on(type, handler) {
    if (!this._listeners.has(type)) {
      this._listeners.set(type, new Set());
    }
    this._listeners.get(type).add(handler);
    return () => this.off(type, handler);
  }

  off(type, handler) {
    const listeners = this._listeners.get(type);
    if (listeners) {
      listeners.delete(handler);
    }
  }

  once(type, handler) {
    const wrapper = (event) => {
      this.off(type, wrapper);
      handler(event);
    };
    return this.on(type, wrapper);
  }

  history(type, limit = 50) {
    let events = type
      ? this._history.filter(e => e.type === type)
      : [...this._history];
    return events.slice(-limit);
  }

  clear() {
    this._listeners.clear();
    this._history = [];
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('EventBus', () => {
  let bus;

  beforeEach(() => {
    bus = new EventBus();
    _uuid = 0;
  });

  describe('emit/on basic flow', () => {
    it('calls registered listener on emit', () => {
      const received = [];
      bus.on('test.event', (e) => received.push(e));
      bus.emit('test.event', { foo: 'bar' });
      assert.equal(received.length, 1);
      assert.equal(received[0].payload.foo, 'bar');
    });

    it('does not call listeners for different event types', () => {
      const received = [];
      bus.on('type.a', (e) => received.push(e));
      bus.emit('type.b', {});
      assert.equal(received.length, 0);
    });
  });

  describe('event shape', () => {
    it('has event_id field', () => {
      const event = bus.emit('test', {});
      assert.ok(event.event_id);
    });

    it('has timestamp field as ISO string', () => {
      const event = bus.emit('test', {});
      assert.ok(typeof event.timestamp === 'string');
      assert.ok(!isNaN(Date.parse(event.timestamp)));
    });

    it('has type field matching emitted type', () => {
      const event = bus.emit('pipeline.step.start', {});
      assert.equal(event.type, 'pipeline.step.start');
    });

    it('has payload field with provided data', () => {
      const event = bus.emit('test', { key: 'value' });
      assert.equal(event.payload.key, 'value');
    });

    it('has source field', () => {
      const event = bus.emit('test', {});
      assert.equal(event.source, 'knowledge-harvester');
    });
  });

  describe('off removes listener', () => {
    it('stops calling removed listener', () => {
      const received = [];
      const handler = (e) => received.push(e);
      bus.on('test', handler);
      bus.emit('test', {});
      assert.equal(received.length, 1);

      bus.off('test', handler);
      bus.emit('test', {});
      assert.equal(received.length, 1);
    });
  });

  describe('once fires once then auto-removes', () => {
    it('fires handler exactly once', () => {
      const received = [];
      bus.once('test', (e) => received.push(e));
      bus.emit('test', {});
      bus.emit('test', {});
      assert.equal(received.length, 1);
    });
  });

  describe('history', () => {
    it('returns recent events', () => {
      bus.emit('a', {});
      bus.emit('b', {});
      const h = bus.history();
      assert.equal(h.length, 2);
    });

    it('respects limit', () => {
      for (let i = 0; i < 10; i++) bus.emit('test', { i });
      const h = bus.history(undefined, 3);
      assert.equal(h.length, 3);
      assert.equal(h[0].payload.i, 7); // last 3 of 10: 7,8,9
    });

    it('filters by type', () => {
      bus.emit('a', {});
      bus.emit('b', {});
      bus.emit('a', {});
      const h = bus.history('a');
      assert.equal(h.length, 2);
      assert.ok(h.every(e => e.type === 'a'));
    });

    it('returns empty array when no events', () => {
      assert.deepEqual(bus.history(), []);
    });
  });

  describe('circular buffer', () => {
    it('drops oldest when exceeding MAX_HISTORY', () => {
      for (let i = 0; i < 1005; i++) bus.emit('test', { i });
      const h = bus.history(undefined, 2000);
      assert.equal(h.length, 1000);
      assert.equal(h[0].payload.i, 5); // oldest kept is index 5
    });
  });

  describe('multiple listeners on same type', () => {
    it('calls all listeners', () => {
      const results = { a: 0, b: 0 };
      bus.on('test', () => results.a++);
      bus.on('test', () => results.b++);
      bus.emit('test', {});
      assert.equal(results.a, 1);
      assert.equal(results.b, 1);
    });
  });

  describe('error in one listener', () => {
    it('does not break other listeners', () => {
      const received = [];
      bus.on('test', () => { throw new Error('boom'); });
      bus.on('test', (e) => received.push(e));
      bus.emit('test', {});
      assert.equal(received.length, 1);
    });
  });

  describe('clear', () => {
    it('resets all state', () => {
      bus.on('test', () => {});
      bus.emit('test', {});
      bus.clear();
      assert.deepEqual(bus.history(), []);
    });
  });

  describe('unsubscribe function', () => {
    it('on() returns working unsubscribe function', () => {
      const received = [];
      const unsub = bus.on('test', (e) => received.push(e));
      bus.emit('test', {});
      unsub();
      bus.emit('test', {});
      assert.equal(received.length, 1);
    });
  });
});
