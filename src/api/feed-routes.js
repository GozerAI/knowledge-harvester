// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Real-Time Intelligence Feed — SSE and summary endpoints.
 */

import { json } from './middleware.js';
import { getEventBus } from '../processing/event-bus.js';

/**
 * GET /api/feed — SSE stream of all events
 */
export async function handleFeed(req, res) {
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

  // Subscribe to all known event types
  const knownTypes = [
    'pipeline.step.start', 'pipeline.step.complete', 'pipeline.step.error',
    'pipeline.run.start', 'pipeline.run.complete',
    'artifact.created', 'artifact.updated', 'artifact.stale',
    'harvest.complete', 'graph.materialized',
    'schedule.run', 'refresh.complete',
  ];

  for (const type of knownTypes) {
    const unsub = bus.on(type, sendEvent);
    unsubscribers.push(unsub);
  }

  // Heartbeat every 30s
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    for (const unsub of unsubscribers) {
      unsub();
    }
  });
}

/**
 * GET /api/feed/summary — event counts from last 5 minutes
 */
export async function handleFeedSummary(req, res) {
  const bus = getEventBus();
  const allEvents = bus.history(undefined, 1000);

  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const recentEvents = allEvents.filter(e => e.timestamp >= fiveMinAgo);

  const counts = {};
  for (const event of recentEvents) {
    counts[event.type] = (counts[event.type] || 0) + 1;
  }

  json(res, 200, {
    window_minutes: 5,
    total_events: recentEvents.length,
    by_type: counts,
  });
}
