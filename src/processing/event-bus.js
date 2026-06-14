// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Pipeline Event Bus — in-process pub/sub with circular history buffer.
 *
 * Provides emit/on/off/once semantics plus a bounded event history
 * for replay and debugging. Singleton via getEventBus().
 */

import crypto from 'node:crypto';

const MAX_HISTORY = 1000;

export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
    /** @type {Array<object>} */
    this._history = [];
    this._source = 'knowledge-harvester';
  }

  /**
   * Emit an event to all registered listeners for the given type.
   * @param {string} type
   * @param {object} payload
   * @returns {object} The emitted event envelope
   */
  emit(type, payload = {}) {
    const event = {
      event_id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      type,
      source: this._source,
      payload,
    };

    // Circular buffer
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

  /**
   * Register a listener for a given event type.
   * @param {string} type
   * @param {Function} handler
   * @returns {Function} Unsubscribe function
   */
  on(type, handler) {
    if (!this._listeners.has(type)) {
      this._listeners.set(type, new Set());
    }
    this._listeners.get(type).add(handler);
    return () => this.off(type, handler);
  }

  /**
   * Remove a specific listener for a given event type.
   * @param {string} type
   * @param {Function} handler
   */
  off(type, handler) {
    const listeners = this._listeners.get(type);
    if (listeners) {
      listeners.delete(handler);
    }
  }

  /**
   * Register a one-time listener that auto-removes after first invocation.
   * @param {string} type
   * @param {Function} handler
   * @returns {Function} Unsubscribe function
   */
  once(type, handler) {
    const wrapper = (event) => {
      this.off(type, wrapper);
      handler(event);
    };
    return this.on(type, wrapper);
  }

  /**
   * Return recent events, optionally filtered by type.
   * @param {string} [type]
   * @param {number} [limit=50]
   * @returns {Array<object>}
   */
  history(type, limit = 50) {
    let events = type
      ? this._history.filter(e => e.type === type)
      : [...this._history];
    return events.slice(-limit);
  }

  /**
   * Clear all listeners and history. Used for testing.
   */
  clear() {
    this._listeners.clear();
    this._history = [];
  }
}

/** @type {EventBus|null} */
let _instance = null;

/**
 * Get the singleton EventBus instance.
 * @returns {EventBus}
 */
export function getEventBus() {
  if (!_instance) {
    _instance = new EventBus();
  }
  return _instance;
}
