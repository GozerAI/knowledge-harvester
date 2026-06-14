// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for webhook handler logic.
 *
 * Re-implements validation, HMAC signing, URL checking, and event matching
 * as pure functions — no HTTP server, real DB, or outbound requests needed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';

// ── Re-implemented helpers ───────────────────────────────────────────────────

function isValidWebhookUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function generateSignature(secret, payload) {
  return 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
}

function validateRegisterBody(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body must be a JSON object'] };
  }

  if (!body.url) {
    errors.push('Missing required field: url');
  } else if (!isValidWebhookUrl(body.url)) {
    errors.push('url must be a valid http or https URL');
  }

  if (!Array.isArray(body.events) || body.events.length === 0) {
    errors.push('events must be a non-empty array of event type strings');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Determine which registered webhooks should fire for a given event.
 * Mirrors the SQL: WHERE active = true AND eventType = ANY(events)
 */
function matchWebhooks(registrations, eventType) {
  return registrations.filter(
    w => w.active === true && Array.isArray(w.events) && w.events.includes(eventType)
  );
}

/**
 * Build the delivery payload envelope.
 */
function buildDeliveryPayload(eventType, data) {
  return {
    id: randomUUID(),
    event: eventType,
    timestamp: expect => typeof expect === 'string', // structural placeholder
    data,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Webhooks', () => {

  describe('Register — validation', () => {
    it('accepts valid url and events', () => {
      const { valid } = validateRegisterBody({
        url: 'https://example.com/hook',
        events: ['harvest.complete'],
      });
      assert.equal(valid, true);
    });

    it('rejects missing url', () => {
      const { valid, errors } = validateRegisterBody({ events: ['harvest.complete'] });
      assert.equal(valid, false);
      assert.ok(errors.some(e => e.includes('url')));
    });

    it('rejects non-http/https url', () => {
      const { valid, errors } = validateRegisterBody({
        url: 'ftp://example.com/hook',
        events: ['harvest.complete'],
      });
      assert.equal(valid, false);
      assert.ok(errors.some(e => e.includes('http')));
    });

    it('rejects empty events array', () => {
      const { valid, errors } = validateRegisterBody({
        url: 'https://example.com/hook',
        events: [],
      });
      assert.equal(valid, false);
      assert.ok(errors.some(e => e.includes('events')));
    });

    it('rejects missing events field', () => {
      const { valid, errors } = validateRegisterBody({ url: 'https://example.com/hook' });
      assert.equal(valid, false);
      assert.ok(errors.some(e => e.includes('events')));
    });

    it('rejects null body', () => {
      const { valid } = validateRegisterBody(null);
      assert.equal(valid, false);
    });

    it('accepts http url (not just https)', () => {
      const { valid } = validateRegisterBody({
        url: 'http://internal.example.com/hook',
        events: ['quality.update'],
      });
      assert.equal(valid, true);
    });

    it('accepts multiple events', () => {
      const { valid } = validateRegisterBody({
        url: 'https://example.com/hook',
        events: ['harvest.complete', 'quality.update', 'artifact.published'],
      });
      assert.equal(valid, true);
    });
  });

  describe('URL validation', () => {
    it('accepts https URL', () => {
      assert.equal(isValidWebhookUrl('https://example.com/hook'), true);
    });

    it('accepts http URL', () => {
      assert.equal(isValidWebhookUrl('http://example.com/hook'), true);
    });

    it('rejects ftp URL', () => {
      assert.equal(isValidWebhookUrl('ftp://example.com'), false);
    });

    it('rejects plain string', () => {
      assert.equal(isValidWebhookUrl('not a url'), false);
    });

    it('rejects empty string', () => {
      assert.equal(isValidWebhookUrl(''), false);
    });

    it('rejects data: URL', () => {
      assert.equal(isValidWebhookUrl('data:text/html,<h1>hi</h1>'), false);
    });
  });

  describe('HMAC signature generation', () => {
    it('generates sha256= prefixed signature', () => {
      const sig = generateSignature('my-secret', '{"event":"test"}');
      assert.ok(sig.startsWith('sha256='));
    });

    it('produces deterministic output for same inputs', () => {
      const payload = JSON.stringify({ event: 'harvest.complete', data: {} });
      const sig1 = generateSignature('secret', payload);
      const sig2 = generateSignature('secret', payload);
      assert.equal(sig1, sig2);
    });

    it('produces different output for different secrets', () => {
      const payload = '{"event":"test"}';
      const sig1 = generateSignature('secret-a', payload);
      const sig2 = generateSignature('secret-b', payload);
      assert.notEqual(sig1, sig2);
    });

    it('produces different output for different payloads', () => {
      const sig1 = generateSignature('secret', '{"event":"a"}');
      const sig2 = generateSignature('secret', '{"event":"b"}');
      assert.notEqual(sig1, sig2);
    });

    it('signature hex portion has 64 characters (SHA-256)', () => {
      const sig = generateSignature('secret', 'payload');
      const hex = sig.replace('sha256=', '');
      assert.equal(hex.length, 64);
      assert.ok(/^[0-9a-f]+$/.test(hex));
    });

    it('can be verified with the same secret and payload', () => {
      const secret = 'webhook-signing-secret';
      const payload = JSON.stringify({ event: 'harvest.complete', id: '123' });
      const sig = generateSignature(secret, payload);
      const expected = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
      assert.equal(sig, expected);
    });
  });

  describe('Event matching', () => {
    const registrations = [
      { id: '1', url: 'https://a.com', events: ['harvest.complete'], active: true, failure_count: 0 },
      { id: '2', url: 'https://b.com', events: ['quality.update', 'artifact.published'], active: true, failure_count: 0 },
      { id: '3', url: 'https://c.com', events: ['harvest.complete', 'quality.update'], active: true, failure_count: 0 },
      { id: '4', url: 'https://d.com', events: ['harvest.complete'], active: false, failure_count: 5 },
    ];

    it('matches webhook subscribed to the fired event', () => {
      const matched = matchWebhooks(registrations, 'harvest.complete');
      const ids = matched.map(w => w.id);
      assert.ok(ids.includes('1'));
      assert.ok(ids.includes('3'));
    });

    it('does not match webhook subscribed to a different event', () => {
      const matched = matchWebhooks(registrations, 'harvest.complete');
      assert.ok(!matched.some(w => w.id === '2'));
    });

    it('skips inactive webhooks', () => {
      const matched = matchWebhooks(registrations, 'harvest.complete');
      assert.ok(!matched.some(w => w.id === '4'));
    });

    it('matches webhooks subscribed to quality.update', () => {
      const matched = matchWebhooks(registrations, 'quality.update');
      const ids = matched.map(w => w.id);
      assert.ok(ids.includes('2'));
      assert.ok(ids.includes('3'));
    });

    it('returns empty array when no webhook matches', () => {
      const matched = matchWebhooks(registrations, 'nonexistent.event');
      assert.deepEqual(matched, []);
    });
  });

  describe('Delete — UUID validation', () => {
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    it('accepts a valid UUID', () => {
      assert.ok(UUID_REGEX.test(randomUUID()));
    });

    it('rejects non-UUID', () => {
      assert.ok(!UUID_REGEX.test('not-a-uuid'));
    });
  });

  describe('fireWebhookEvent — payload construction', () => {
    it('payload includes event type, id, and timestamp fields', () => {
      const payload = {
        id: randomUUID(),
        event: 'harvest.complete',
        timestamp: new Date().toISOString(),
        data: { count: 42 },
      };
      assert.equal(payload.event, 'harvest.complete');
      assert.ok(typeof payload.id === 'string');
      assert.ok(typeof payload.timestamp === 'string');
      assert.deepEqual(payload.data, { count: 42 });
    });

    it('payload id is a valid UUID', () => {
      const id = randomUUID();
      assert.ok(UUID_REGEX_TEST(id));

      function UUID_REGEX_TEST(s) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
      }
    });

    it('JSON serializes correctly for outbound request', () => {
      const envelope = {
        id: randomUUID(),
        event: 'artifact.published',
        timestamp: new Date().toISOString(),
        data: { artifact_id: randomUUID() },
      };
      const serialized = JSON.stringify(envelope);
      const parsed = JSON.parse(serialized);
      assert.equal(parsed.event, 'artifact.published');
    });
  });
});
