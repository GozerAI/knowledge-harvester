// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Autonomy Dashboard API — pulse and timeline endpoints.
 */

import { json } from './middleware.js';
import { db } from '../db/client.js';
import { listFailureInbox, listSourceHealth } from '../db/operation-log-store.js';
import { getEventBus } from '../processing/event-bus.js';

/**
 * GET /api/autonomy/pulse
 * Aggregates scheduler, event bus, pipeline, freshness, and coverage status.
 */
export async function handleAutonomyPulse(req, res) {
  const bus = getEventBus();

  // Scheduler status
  let schedulerStatus = [];
  try {
    const schedResult = await db.query('SELECT name, enabled, last_status, last_run, run_count FROM schedules');
    schedulerStatus = schedResult.rows;
  } catch {
    // schedules table may not exist
  }

  // Event bus stats (last hour)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recentEvents = bus.history(undefined, 1000).filter(e => e.timestamp >= oneHourAgo);
  const eventCounts = {};
  for (const e of recentEvents) {
    eventCounts[e.type] = (eventCounts[e.type] || 0) + 1;
  }

  // Stale artifact count
  let staleCount = 0;
  try {
    const staleResult = await db.query(
      `SELECT COUNT(*)::int AS count FROM artifacts
       WHERE type_metadata IS NOT NULL
         AND type_metadata::jsonb -> 'decay_prediction' ->> 'decay_risk' IS NOT NULL
         AND (type_metadata::jsonb -> 'decay_prediction' ->> 'decay_risk')::float >= 0.6`
    );
    staleCount = staleResult.rows[0]?.count || 0;
  } catch {
    // best-effort
  }

  // Coverage summary
  let coverageSummary = null;
  try {
    const covResult = await db.query(
      `SELECT COUNT(DISTINCT primary_category)::int AS categories,
              COUNT(DISTINCT artifact_type)::int AS types,
              COUNT(*)::int AS total
       FROM artifacts WHERE primary_category IS NOT NULL`
    );
    coverageSummary = covResult.rows[0];
  } catch {
    // best-effort
  }

  // Latest snapshot diff
  let latestDiff = null;
  try {
    const snapResult = await db.query(
      'SELECT id, label, created_at FROM snapshots ORDER BY created_at DESC LIMIT 2'
    );
    if (snapResult.rows.length === 2) {
      latestDiff = {
        newer: { id: snapResult.rows[0].id, label: snapResult.rows[0].label },
        older: { id: snapResult.rows[1].id, label: snapResult.rows[1].label },
      };
    }
  } catch {
    // snapshots table may not exist
  }

  let failureInbox = null;
  try {
    const inbox = await listFailureInbox(db, { limit: 5, sinceHours: 24 });
    failureInbox = {
      grouped_failures: inbox.total,
      top_items: inbox.items,
    };
  } catch {
    // best-effort
  }

  let sourceHealth = null;
  try {
    const health = await listSourceHealth(db, { limit: 5, sinceHours: 72 });
    sourceHealth = {
      by_status: health.summary.by_status,
      top_attention_sources: health.sources.filter(s => s.health_status !== 'healthy'),
    };
  } catch {
    // best-effort
  }

  json(res, 200, {
    scheduler: schedulerStatus,
    event_bus: { last_hour_events: recentEvents.length, by_type: eventCounts },
    stale_artifacts: staleCount,
    coverage: coverageSummary,
    latest_snapshot_pair: latestDiff,
    failure_inbox: failureInbox,
    source_health: sourceHealth,
  });
}

/**
 * GET /api/autonomy/timeline
 * Last 24h autonomous actions from event bus, refresh_log, and schedules.
 */
export async function handleAutonomyTimeline(req, res) {
  const timeline = [];
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Events from event bus
  const bus = getEventBus();
  const events = bus.history(undefined, 1000).filter(e => e.timestamp >= twentyFourHoursAgo);
  for (const e of events) {
    timeline.push({
      source: 'event_bus',
      type: e.type,
      timestamp: e.timestamp,
      details: e.payload,
    });
  }

  // Refresh log entries
  try {
    const refreshResult = await db.query(
      `SELECT artifact_id, refresh_status, source, refreshed_at, error_message
       FROM refresh_log WHERE refreshed_at >= $1 ORDER BY refreshed_at DESC`,
      [twentyFourHoursAgo]
    );
    for (const r of refreshResult.rows) {
      timeline.push({
        source: 'refresh_log',
        type: `refresh.${r.refresh_status}`,
        timestamp: r.refreshed_at,
        details: { artifact_id: r.artifact_id, source: r.source, error: r.error_message },
      });
    }
  } catch {
    // refresh_log may not exist
  }

  // Schedule runs
  try {
    const schedResult = await db.query(
      `SELECT name, last_status, last_run, last_error
       FROM schedules WHERE last_run >= $1 ORDER BY last_run DESC`,
      [twentyFourHoursAgo]
    );
    for (const s of schedResult.rows) {
      timeline.push({
        source: 'scheduler',
        type: `schedule.${s.last_status}`,
        timestamp: s.last_run,
        details: { name: s.name, error: s.last_error },
      });
    }
  } catch {
    // schedules table may not exist
  }

  try {
    const inbox = await listFailureInbox(db, { limit: 50, sinceHours: 24 });
    for (const item of inbox.items) {
      timeline.push({
        source: 'operation_logs',
        type: item.event_type,
        timestamp: item.last_seen,
        details: {
          emitter: item.emitter,
          occurrences: item.occurrence_count,
          message: item.message,
        },
      });
    }
  } catch {
    // operation_logs may not exist
  }

  // Sort by timestamp descending
  timeline.sort((a, b) => {
    const ta = typeof a.timestamp === 'string' ? a.timestamp : new Date(a.timestamp).toISOString();
    const tb = typeof b.timestamp === 'string' ? b.timestamp : new Date(b.timestamp).toISOString();
    return tb.localeCompare(ta);
  });

  json(res, 200, { timeline, total: timeline.length });
}
