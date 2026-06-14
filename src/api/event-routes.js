// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Event Bus API routes — history and SSE streaming.
 */

import { json } from './middleware.js';
import { getEventBus } from '../processing/event-bus.js';

/**
 * GET /api/events/history?type=X&limit=N
 * Returns recent events from the event bus history buffer.
 */
export async function handleEventHistory(req, res, params) {
  const type = params.get('type') || undefined;
  const limit = Math.min(parseInt(params.get('limit') || '50', 10), 1000);

  const bus = getEventBus();
  const events = bus.history(type, limit);

  json(res, 200, { events, total: events.length });
}

/**
 * GET /api/events/stream?types=a,b
 * Server-Sent Events stream of real-time pipeline events.
 */
export async function handleEventStream(req, res, params) {
  const typesParam = params.get('types') || '';
  const types = typesParam ? typesParam.split(',').map(t => t.trim()) : [];

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const bus = getEventBus();
  const unsubscribers = [];

  const sendEvent = (event) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      // Connection may have closed
    }
  };

  if (types.length > 0) {
    for (const type of types) {
      const unsub = bus.on(type, sendEvent);
      unsubscribers.push(unsub);
    }
  } else {
    // Subscribe to all events by registering a catch-all
    // Since EventBus doesn't support wildcard, we subscribe to known types
    const knownTypes = [
      'pipeline.step.start', 'pipeline.step.complete', 'pipeline.step.error',
      'artifact.created', 'artifact.updated', 'artifact.stale',
      'harvest.complete', 'graph.materialized',
      'pipeline.run.start', 'pipeline.run.complete',
    ];
    for (const type of knownTypes) {
      const unsub = bus.on(type, sendEvent);
      unsubscribers.push(unsub);
    }
  }

  // Heartbeat every 30s
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 30000);

  // Cleanup on connection close
  req.on('close', () => {
    clearInterval(heartbeat);
    for (const unsub of unsubscribers) {
      unsub();
    }
  });
}
