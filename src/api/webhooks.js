// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Webhook registration, listing, deletion, and event firing.
 *
 * Uses Node built-in crypto for HMAC signing and Node built-in
 * http/https for outbound delivery — no external dependencies.
 *
 * Delivery is fire-and-forget: the handler does not await delivery
 * outcomes and never fails a caller because a webhook bounced.
 *
 * Tables required (see migration below):
 *   webhook_registrations(id, url, events TEXT[], secret, active, created_at, failure_count)
 *   webhook_deliveries(id, webhook_id, event_type, payload, status, attempted_at, error_message)
 */

import { createHmac, randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { db } from '../db/client.js';
import { validateUUID, json } from './middleware.js';

// ── Body reader ──────────────────────────────────────────────────────────────

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

// ── URL validation (SSRF-safe) ───────────────────────────────────────────────

import dns from 'node:dns';
import { promisify } from 'node:util';

const dnsResolve4 = promisify(dns.resolve4);

function isPrivateIP(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p))) return true;
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] === 127 ||
    parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254)
  );
}

async function isValidWebhookUrl(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;

    // Resolve hostname and block private/internal IPs (SSRF protection)
    let ips;
    try {
      ips = await dnsResolve4(parsed.hostname);
    } catch {
      return false;
    }

    if (ips.some(isPrivateIP)) return false;

    return true;
  } catch {
    return false;
  }
}

// ── HMAC signature ───────────────────────────────────────────────────────────

/**
 * Generate an X-Webhook-Signature header value.
 * @param {string} secret
 * @param {string} payload - JSON string
 * @returns {string}
 */
export function generateSignature(secret, payload) {
  return 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
}

// ── Outbound delivery ────────────────────────────────────────────────────────

function deliverWebhook(url, payloadStr, signature) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payloadStr),
        'User-Agent': 'KnowledgeHarvester-Webhook/1.0',
        ...(signature ? { 'X-Webhook-Signature': signature } : {}),
      },
    };

    const outReq = lib.request(options, (outRes) => {
      // Drain response body to free the socket
      outRes.resume();
      resolve(outRes.statusCode);
    });

    outReq.on('error', reject);
    outReq.setTimeout(10000, () => {
      outReq.destroy(new Error('Webhook delivery timed out'));
    });
    outReq.write(payloadStr);
    outReq.end();
  });
}

// ── Handlers ─────────────────────────────────────────────────────────────────

/**
 * POST /api/webhooks
 * Body: { url, events: string[], secret?: string }
 */
export async function handleRegisterWebhook(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' });
  }

  if (!body || typeof body !== 'object') {
    return json(res, 400, { error: 'Request body must be a JSON object' });
  }

  if (!body.url) {
    return json(res, 400, { error: 'Missing required field: url' });
  }

  if (!(await isValidWebhookUrl(body.url))) {
    return json(res, 400, { error: 'url must be a valid http or https URL (private/internal IPs are blocked)' });
  }

  if (!Array.isArray(body.events) || body.events.length === 0) {
    return json(res, 400, { error: 'events must be a non-empty array of event type strings' });
  }

  const result = await db.query(
    `INSERT INTO webhook_registrations (url, events, secret, active, failure_count)
     VALUES ($1, $2, $3, true, 0)
     RETURNING id, url, events, active, created_at, failure_count`,
    [body.url, body.events, body.secret || null]
  );

  json(res, 201, result.rows[0]);
}

/**
 * GET /api/webhooks
 */
export async function handleListWebhooks(req, res) {
  const result = await db.query(
    `SELECT id, url, events, active, created_at, failure_count
     FROM webhook_registrations
     ORDER BY created_at DESC`
  );

  json(res, 200, { webhooks: result.rows });
}

/**
 * DELETE /api/webhooks/:id
 */
export async function handleDeleteWebhook(req, res, params, id) {
  if (!validateUUID(id)) {
    return json(res, 400, { error: 'Invalid webhook ID format' });
  }

  const result = await db.query(
    'DELETE FROM webhook_registrations WHERE id = $1 RETURNING id',
    [id]
  );

  if (result.rows.length === 0) {
    return json(res, 404, { error: 'Webhook not found' });
  }

  res.writeHead(204);
  res.end();
}

/**
 * Fire an event to all active webhooks subscribed to eventType.
 * Fire-and-forget — never throws, logs delivery status to webhook_deliveries.
 *
 * @param {object} dbClient - db instance (passed in to allow testing)
 * @param {string} eventType
 * @param {object} payload
 */
export function fireWebhookEvent(dbClient, eventType, payload) {
  // Deliberately not awaited by callers
  (async () => {
    let webhooks;
    try {
      const result = await dbClient.query(
        `SELECT id, url, events, secret
         FROM webhook_registrations
         WHERE active = true AND $1 = ANY(events)`,
        [eventType]
      );
      webhooks = result.rows;
    } catch {
      // If we can't query, nothing we can do — don't crash the caller
      return;
    }

    for (const webhook of webhooks) {
      const deliveryPayload = {
        id: randomUUID(),
        event: eventType,
        timestamp: new Date().toISOString(),
        data: payload,
      };
      const payloadStr = JSON.stringify(deliveryPayload);
      const signature = webhook.secret
        ? generateSignature(webhook.secret, payloadStr)
        : null;

      let status = 'success';
      let errorMessage = null;

      try {
        await deliverWebhook(webhook.url, payloadStr, signature);
      } catch (err) {
        status = 'failed';
        errorMessage = err.message;

        // Increment failure count
        try {
          await dbClient.query(
            'UPDATE webhook_registrations SET failure_count = failure_count + 1 WHERE id = $1',
            [webhook.id]
          );
        } catch {
          // Best effort
        }
      }

      // Log delivery attempt
      try {
        await dbClient.query(
          `INSERT INTO webhook_deliveries
             (webhook_id, event_type, payload, status, attempted_at, error_message)
           VALUES ($1, $2, $3, $4, NOW(), $5)`,
          [webhook.id, eventType, payloadStr, status, errorMessage]
        );
      } catch {
        // Best effort
      }
    }
  })();
}
