// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Outbound webhook dispatcher — pushes KH event bus events to external endpoints.
 * Uses HMAC signing for authentication.
 */
import crypto from 'node:crypto';
import { logger } from '../utils/logger.js';
import { getEventBus } from '../processing/event-bus.js';
import { RetryPolicy, getCircuitBreaker, resilientFetch } from '../utils/resilience.js';

const DISPATCHED_EVENTS = [
  'artifact.created', 'artifact.updated', 'artifact.stale',
  'harvest.complete', 'graph.materialized', 'pipeline.run.complete',
  'schedule.run', 'refresh.complete'
];

export class WebhookDispatcher {
  constructor(webhookUrl, secret, options = {}) {
    this.webhookUrl = webhookUrl;
    this.secret = secret;
    this.eventTypes = options.eventTypes || DISPATCHED_EVENTS;
    this.timeout = options.timeout || 5000;
    this._dispatched = 0;
    this._errors = 0;
    this._subscriptions = [];
    this._breaker = getCircuitBreaker('webhook-dispatch', {
      failureThreshold: 5,
      recoveryTimeout: 60000,
    });
    this._retryPolicy = new RetryPolicy({ maxRetries: 2, baseDelay: 500, maxDelay: 5000 });
  }

  start() {
    const bus = getEventBus();
    for (const type of this.eventTypes) {
      const handler = (payload) => this._dispatch(type, payload);
      bus.on(type, handler);
      this._subscriptions.push({ type, handler });
    }
    logger.info(`WebhookDispatcher started, watching ${this.eventTypes.length} event types`);
  }

  stop() {
    const bus = getEventBus();
    for (const { type, handler } of this._subscriptions) {
      bus.off(type, handler);
    }
    this._subscriptions = [];
  }

  getStats() {
    return { dispatched: this._dispatched, errors: this._errors, watching: this.eventTypes.length };
  }

  async _dispatch(eventType, payload) {
    if (!this.webhookUrl) return;
    try {
      const body = JSON.stringify({ event: eventType, data: payload, timestamp: new Date().toISOString() });
      const signature = this.secret
        ? crypto.createHmac('sha256', this.secret).update(body).digest('hex')
        : '';

      const headers = {};
      if (signature) {
        headers['X-Webhook-Signature'] = `sha256=${signature}`;
      }

      const result = await resilientFetch(this.webhookUrl, {
        method: 'POST',
        body,
        headers,
        timeout: this.timeout,
        retryPolicy: this._retryPolicy,
        circuitBreaker: this._breaker,
      });

      if (result !== null) {
        this._dispatched++;
      } else {
        this._errors++;
      }
    } catch (err) {
      this._errors++;
      logger.debug(`Webhook dispatch error: ${err.message}`);
    }
  }
}

// Factory for test/mock use
export function createDispatcher(webhookUrl, secret, options) {
  return new WebhookDispatcher(webhookUrl, secret, options);
}
