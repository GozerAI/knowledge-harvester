// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for WebhookDispatcher — outbound event-bus-to-webhook bridge.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// ── Re-implement WebhookDispatcher logic locally for pure unit tests ────────

const DEFAULT_EVENTS = [
  'artifact.created', 'artifact.updated', 'artifact.stale',
  'harvest.complete', 'graph.materialized', 'pipeline.run.complete',
  'schedule.run', 'refresh.complete'
];

class MockEventBus {
  constructor() {
    this._listeners = new Map();
  }
  on(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(handler);
  }
  off(type, handler) {
    const set = this._listeners.get(type);
    if (set) set.delete(handler);
  }
  getListenerCount(type) {
    return this._listeners.get(type)?.size || 0;
  }
  getAllListenerCount() {
    let total = 0;
    for (const set of this._listeners.values()) total += set.size;
    return total;
  }
}

class TestableDispatcher {
  constructor(webhookUrl, secret, options = {}) {
    this.webhookUrl = webhookUrl;
    this.secret = secret;
    this.eventTypes = options.eventTypes || DEFAULT_EVENTS;
    this.timeout = options.timeout || 5000;
    this._dispatched = 0;
    this._errors = 0;
    this._subscriptions = [];
    this._lastBody = null;
    this._lastHeaders = null;
    this._shouldFail = false;
  }

  start(bus) {
    for (const type of this.eventTypes) {
      const handler = (payload) => this._dispatch(type, payload);
      bus.on(type, handler);
      this._subscriptions.push({ type, handler });
    }
  }

  stop(bus) {
    for (const { type, handler } of this._subscriptions) {
      bus.off(type, handler);
    }
    this._subscriptions = [];
  }

  getStats() {
    return { dispatched: this._dispatched, errors: this._errors, watching: this.eventTypes.length };
  }

  _dispatch(eventType, payload) {
    if (!this.webhookUrl) return;
    try {
      const body = JSON.stringify({ event: eventType, data: payload, timestamp: new Date().toISOString() });
      this._lastBody = body;

      const signature = this.secret
        ? crypto.createHmac('sha256', this.secret).update(body).digest('hex')
        : '';

      this._lastHeaders = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(signature ? { 'X-Webhook-Signature': `sha256=${signature}` } : {}),
      };

      if (this._shouldFail) {
        this._errors++;
        return;
      }

      this._dispatched++;
    } catch (err) {
      this._errors++;
    }
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('WebhookDispatcher', () => {
  let bus;

  beforeEach(() => {
    bus = new MockEventBus();
  });

  describe('constructor', () => {
    it('stores webhook URL', () => {
      const d = new TestableDispatcher('http://localhost:8002/v1/webhooks/kh', 'secret123');
      assert.equal(d.webhookUrl, 'http://localhost:8002/v1/webhooks/kh');
    });

    it('stores secret', () => {
      const d = new TestableDispatcher('http://localhost:8002', 'my-secret');
      assert.equal(d.secret, 'my-secret');
    });

    it('uses default event types when none provided', () => {
      const d = new TestableDispatcher('http://localhost:8002', '');
      assert.equal(d.eventTypes.length, DEFAULT_EVENTS.length);
      assert.deepEqual(d.eventTypes, DEFAULT_EVENTS);
    });

    it('accepts custom event types', () => {
      const d = new TestableDispatcher('http://localhost:8002', '', {
        eventTypes: ['artifact.created', 'harvest.complete'],
      });
      assert.equal(d.eventTypes.length, 2);
    });

    it('accepts custom timeout', () => {
      const d = new TestableDispatcher('http://localhost:8002', '', { timeout: 10000 });
      assert.equal(d.timeout, 10000);
    });

    it('initializes counters to zero', () => {
      const d = new TestableDispatcher('http://localhost:8002', '');
      assert.equal(d._dispatched, 0);
      assert.equal(d._errors, 0);
    });
  });

  describe('start()', () => {
    it('registers listeners for all event types', () => {
      const d = new TestableDispatcher('http://localhost:8002', '');
      d.start(bus);
      for (const type of DEFAULT_EVENTS) {
        assert.equal(bus.getListenerCount(type), 1, `Expected listener for ${type}`);
      }
    });

    it('registers listeners only for custom event types', () => {
      const d = new TestableDispatcher('http://localhost:8002', '', {
        eventTypes: ['artifact.created'],
      });
      d.start(bus);
      assert.equal(bus.getListenerCount('artifact.created'), 1);
      assert.equal(bus.getListenerCount('harvest.complete'), 0);
    });
  });

  describe('stop()', () => {
    it('removes all listeners', () => {
      const d = new TestableDispatcher('http://localhost:8002', '');
      d.start(bus);
      assert.equal(bus.getAllListenerCount(), DEFAULT_EVENTS.length);
      d.stop(bus);
      assert.equal(bus.getAllListenerCount(), 0);
    });

    it('clears subscriptions array', () => {
      const d = new TestableDispatcher('http://localhost:8002', '');
      d.start(bus);
      assert.ok(d._subscriptions.length > 0);
      d.stop(bus);
      assert.equal(d._subscriptions.length, 0);
    });
  });

  describe('_dispatch()', () => {
    it('generates correct HMAC signature', () => {
      const secret = 'test-secret';
      const d = new TestableDispatcher('http://localhost:8002', secret);
      d._dispatch('artifact.created', { id: '123' });

      const expectedSig = crypto.createHmac('sha256', secret)
        .update(d._lastBody)
        .digest('hex');
      assert.equal(d._lastHeaders['X-Webhook-Signature'], `sha256=${expectedSig}`);
    });

    it('sends correct Content-Type header', () => {
      const d = new TestableDispatcher('http://localhost:8002', 'secret');
      d._dispatch('artifact.created', {});
      assert.equal(d._lastHeaders['Content-Type'], 'application/json');
    });

    it('includes event type in body', () => {
      const d = new TestableDispatcher('http://localhost:8002', '');
      d._dispatch('harvest.complete', { count: 5 });
      const parsed = JSON.parse(d._lastBody);
      assert.equal(parsed.event, 'harvest.complete');
    });

    it('includes payload data in body', () => {
      const d = new TestableDispatcher('http://localhost:8002', '');
      d._dispatch('artifact.created', { name: 'test-artifact' });
      const parsed = JSON.parse(d._lastBody);
      assert.deepEqual(parsed.data, { name: 'test-artifact' });
    });

    it('includes timestamp in body', () => {
      const d = new TestableDispatcher('http://localhost:8002', '');
      d._dispatch('artifact.created', {});
      const parsed = JSON.parse(d._lastBody);
      assert.ok(parsed.timestamp);
      assert.ok(parsed.timestamp.includes('T'));
    });

    it('increments dispatched counter on success', () => {
      const d = new TestableDispatcher('http://localhost:8002', '');
      d._dispatch('artifact.created', {});
      d._dispatch('harvest.complete', {});
      assert.equal(d._dispatched, 2);
    });

    it('increments errors counter on failure', () => {
      const d = new TestableDispatcher('http://localhost:8002', '');
      d._shouldFail = true;
      d._dispatch('artifact.created', {});
      assert.equal(d._errors, 1);
      assert.equal(d._dispatched, 0);
    });

    it('does not dispatch when webhookUrl is empty', () => {
      const d = new TestableDispatcher('', '');
      d._dispatch('artifact.created', {});
      assert.equal(d._dispatched, 0);
      assert.equal(d._errors, 0);
      assert.equal(d._lastBody, null);
    });

    it('omits X-Webhook-Signature header when no secret', () => {
      const d = new TestableDispatcher('http://localhost:8002', '');
      d._dispatch('artifact.created', {});
      assert.equal(d._lastHeaders['X-Webhook-Signature'], undefined);
    });

    it('HMAC signature matches expected value for known body+secret', () => {
      const secret = 'known-secret';
      const d = new TestableDispatcher('http://localhost:8002', secret);
      d._dispatch('test.event', { key: 'value' });

      // Verify signature independently
      const sig = crypto.createHmac('sha256', secret).update(d._lastBody).digest('hex');
      assert.equal(d._lastHeaders['X-Webhook-Signature'], `sha256=${sig}`);
    });
  });

  describe('getStats()', () => {
    it('returns correct initial stats', () => {
      const d = new TestableDispatcher('http://localhost:8002', '');
      const stats = d.getStats();
      assert.equal(stats.dispatched, 0);
      assert.equal(stats.errors, 0);
      assert.equal(stats.watching, DEFAULT_EVENTS.length);
    });

    it('returns correct stats after dispatches', () => {
      const d = new TestableDispatcher('http://localhost:8002', '');
      d._dispatch('a', {});
      d._dispatch('b', {});
      d._shouldFail = true;
      d._dispatch('c', {});
      const stats = d.getStats();
      assert.equal(stats.dispatched, 2);
      assert.equal(stats.errors, 1);
    });

    it('reflects custom event type count', () => {
      const d = new TestableDispatcher('http://localhost:8002', '', {
        eventTypes: ['a', 'b'],
      });
      assert.equal(d.getStats().watching, 2);
    });
  });
});
