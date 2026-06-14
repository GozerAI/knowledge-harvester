// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { db } from './client.js';
import { scoreSourceReliability } from '../self-maintenance/reliability-scorer.js';

export const DEFAULT_LOG_LIMIT = 20;
export const DEFAULT_RUN_LIMIT = 20;
export const MAX_LIMIT = 100;
export const DEFAULT_LOG_LEVELS = ['error', 'warn'];
export const DEFAULT_INBOX_LIMIT = 20;
export const DEFAULT_SOURCE_HEALTH_LIMIT = 20;

function clampInt(value, fallback, { min = 0, max = MAX_LIMIT } = {}) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function normalizeCsv(value) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : String(value).split(',');
  return values
    .map(item => String(item).trim().toLowerCase())
    .filter(Boolean);
}

function toIntervalHours(hours) {
  return `${hours} hours`;
}

export function serializeError(error) {
  if (!error) {
    return {
      name: null,
      code: null,
      message: null,
      stack: null,
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      code: error.code || null,
      message: error.message || String(error),
      stack: error.stack || null,
    };
  }

  return {
    name: typeof error === 'object' && error !== null ? error.name || null : null,
    code: typeof error === 'object' && error !== null ? error.code || null : null,
    message: String(error),
    stack: null,
  };
}

export function normalizeLogFilters(filters = {}) {
  const levels = normalizeCsv(filters.level);
  return {
    levels: levels.length > 0 ? levels : [...DEFAULT_LOG_LEVELS],
    category: filters.category ? String(filters.category).trim().toLowerCase() : null,
    source: filters.source ? String(filters.source).trim() : null,
    command: filters.command ? String(filters.command).trim() : null,
    runId: filters.runId ? String(filters.runId).trim() : null,
    systemRunId: filters.systemRunId ? String(filters.systemRunId).trim() : null,
    requestPath: filters.requestPath ? String(filters.requestPath).trim() : null,
    search: filters.search ? String(filters.search).trim() : null,
    sinceHours: clampInt(filters.sinceHours, 24, { min: 1, max: 24 * 30 }),
    limit: clampInt(filters.limit, DEFAULT_LOG_LIMIT, { min: 1, max: MAX_LIMIT }),
    offset: clampInt(filters.offset, 0, { min: 0, max: 10_000 }),
  };
}

export function normalizeRunFilters(filters = {}) {
  return {
    status: filters.status ? String(filters.status).trim().toLowerCase() : null,
    source: filters.source ? String(filters.source).trim() : null,
    limit: clampInt(filters.limit, DEFAULT_RUN_LIMIT, { min: 1, max: MAX_LIMIT }),
    offset: clampInt(filters.offset, 0, { min: 0, max: 10_000 }),
  };
}

function buildOperationLogWhere(filters) {
  const clauses = ['created_at >= NOW() - $1::interval'];
  const params = [toIntervalHours(filters.sinceHours)];
  let index = 2;

  if (filters.levels.length > 0) {
    clauses.push(`level = ANY($${index})`);
    params.push(filters.levels);
    index++;
  }
  if (filters.category) {
    clauses.push(`category = $${index}`);
    params.push(filters.category);
    index++;
  }
  if (filters.source) {
    clauses.push(`source = $${index}`);
    params.push(filters.source);
    index++;
  }
  if (filters.command) {
    clauses.push(`command = $${index}`);
    params.push(filters.command);
    index++;
  }
  if (filters.runId) {
    clauses.push(`run_id = $${index}`);
    params.push(filters.runId);
    index++;
  }
  if (filters.systemRunId) {
    clauses.push(`system_run_id = $${index}`);
    params.push(filters.systemRunId);
    index++;
  }
  if (filters.requestPath) {
    clauses.push(`request_path = $${index}`);
    params.push(filters.requestPath);
    index++;
  }
  if (filters.search) {
    clauses.push(`(
      message ILIKE $${index}
      OR COALESCE(error_name, '') ILIKE $${index}
      OR COALESCE(error_code, '') ILIKE $${index}
      OR COALESCE(source, '') ILIKE $${index}
      OR COALESCE(command, '') ILIKE $${index}
    )`);
    params.push(`%${filters.search}%`);
    index++;
  }

  return { whereSql: clauses.join(' AND '), params, nextIndex: index };
}

export function buildOperationLogListQuery(filters = {}) {
  const normalized = normalizeLogFilters(filters);
  const { whereSql, params, nextIndex } = buildOperationLogWhere(normalized);

  return {
    countSql: `SELECT COUNT(*)::int AS count FROM operation_logs WHERE ${whereSql}`,
    countParams: [...params],
    listSql: `
      SELECT id, created_at, level, category, event_type, message, source,
             command, run_id, system_run_id, request_path, error_name, error_code, error_stack, metadata
      FROM operation_logs
      WHERE ${whereSql}
      ORDER BY created_at DESC
      LIMIT $${nextIndex} OFFSET $${nextIndex + 1}
    `.trim(),
    listParams: [...params, normalized.limit, normalized.offset],
    normalized,
  };
}

export function buildHarvestRunListQuery(filters = {}) {
  const normalized = normalizeRunFilters(filters);
  const clauses = [];
  const params = [];
  let index = 1;

  if (normalized.status) {
    clauses.push(`hr.status = $${index}`);
    params.push(normalized.status);
    index++;
  }
  if (normalized.source) {
    clauses.push(`hr.source = $${index}`);
    params.push(normalized.source);
    index++;
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  return {
    countSql: `SELECT COUNT(*)::int AS count FROM harvest_runs hr ${whereSql}`,
    countParams: [...params],
    listSql: `
      SELECT hr.id, hr.source, hr.started_at, hr.completed_at, hr.status,
             hr.items_discovered, hr.items_new, hr.items_duplicate, hr.items_invalid,
             hr.error_message, hr.metadata,
             COUNT(ol.id) FILTER (WHERE ol.level = 'error')::int AS error_events,
             COUNT(ol.id) FILTER (WHERE ol.level = 'warn')::int AS warning_events
      FROM harvest_runs hr
      LEFT JOIN operation_logs ol ON ol.run_id = hr.id
      ${whereSql}
      GROUP BY hr.id
      ORDER BY hr.started_at DESC
      LIMIT $${index} OFFSET $${index + 1}
    `.trim(),
    listParams: [...params, normalized.limit, normalized.offset],
    normalized,
  };
}

export async function createOperationLog(database, entry) {
  const error = serializeError(entry.error);
  const metadata = entry.metadata && typeof entry.metadata === 'object'
    ? entry.metadata
    : {};

  const result = await database.query(
    `INSERT INTO operation_logs (
       level, category, event_type, message, source, command, run_id,
       system_run_id, request_path, error_name, error_code, error_stack, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id, created_at, level, category, event_type, message, source,
               command, run_id, system_run_id, request_path, error_name, error_code, error_stack, metadata`,
    [
      entry.level || 'error',
      entry.category || 'system',
      entry.eventType || 'system.event',
      entry.message || error.message || 'Operation log entry',
      entry.source || null,
      entry.command || null,
      entry.runId || null,
      entry.systemRunId || null,
      entry.requestPath || null,
      error.name,
      error.code,
      error.stack,
      JSON.stringify(metadata),
    ],
  );

  return result.rows[0];
}

export async function logOperationSafely(entry, { database = db } = {}) {
  try {
    return await createOperationLog(database, entry);
  } catch (error) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      msg: 'Failed to persist operation log',
      original_event_type: entry?.eventType,
      error: error.message,
    }));
    return null;
  }
}

export async function listOperationLogs(database, filters = {}) {
  const query = buildOperationLogListQuery(filters);
  const [countResult, listResult] = await Promise.all([
    database.query(query.countSql, query.countParams),
    database.query(query.listSql, query.listParams),
  ]);

  return {
    logs: listResult.rows,
    total: countResult.rows[0]?.count || 0,
    limit: query.normalized.limit,
    offset: query.normalized.offset,
    since_hours: query.normalized.sinceHours,
    levels: query.normalized.levels,
  };
}

export async function summarizeOperationLogs(database, filters = {}) {
  const normalized = normalizeLogFilters(filters);
  const { whereSql, params } = buildOperationLogWhere(normalized);
  const [totals, byLevel, byCategory, topSources] = await Promise.all([
    database.query(
      `SELECT COUNT(*)::int AS total
       FROM operation_logs
       WHERE ${whereSql}`,
      params,
    ),
    database.query(
      `SELECT level, COUNT(*)::int AS count
       FROM operation_logs
       WHERE ${whereSql}
       GROUP BY level
       ORDER BY count DESC, level ASC`,
      params,
    ),
    database.query(
      `SELECT category, COUNT(*)::int AS count
       FROM operation_logs
       WHERE ${whereSql}
       GROUP BY category
       ORDER BY count DESC, category ASC`,
      params,
    ),
    database.query(
      `SELECT COALESCE(source, command, request_path, 'unknown') AS emitter,
              COUNT(*)::int AS count
       FROM operation_logs
       WHERE ${whereSql}
       GROUP BY emitter
       ORDER BY count DESC, emitter ASC
       LIMIT 10`,
      params,
    ),
  ]);

  return {
    total: totals.rows[0]?.total || 0,
    by_level: byLevel.rows,
    by_category: byCategory.rows,
    top_emitters: topSources.rows,
    window_hours: normalized.sinceHours,
  };
}

export async function listHarvestRuns(database, filters = {}) {
  const query = buildHarvestRunListQuery(filters);
  const [countResult, listResult] = await Promise.all([
    database.query(query.countSql, query.countParams),
    database.query(query.listSql, query.listParams),
  ]);

  return {
    runs: listResult.rows,
    total: countResult.rows[0]?.count || 0,
    limit: query.normalized.limit,
    offset: query.normalized.offset,
  };
}

export async function getHarvestRunDetails(database, runId, { logLimit = DEFAULT_LOG_LIMIT } = {}) {
  const [runResult, logsResult] = await Promise.all([
    database.query(
      `SELECT hr.id, hr.source, hr.started_at, hr.completed_at, hr.status,
              hr.items_discovered, hr.items_new, hr.items_duplicate, hr.items_invalid,
              hr.error_message, hr.metadata,
              COUNT(ol.id) FILTER (WHERE ol.level = 'error')::int AS error_events,
              COUNT(ol.id) FILTER (WHERE ol.level = 'warn')::int AS warning_events
       FROM harvest_runs hr
       LEFT JOIN operation_logs ol ON ol.run_id = hr.id
       WHERE hr.id = $1
       GROUP BY hr.id`,
      [runId],
    ),
    database.query(
      `SELECT id, created_at, level, category, event_type, message, source,
              command, run_id, system_run_id, request_path, error_name, error_code, error_stack, metadata
       FROM operation_logs
       WHERE run_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [runId, clampInt(logLimit, DEFAULT_LOG_LIMIT, { min: 1, max: MAX_LIMIT })],
    ),
  ]);

  if (runResult.rows.length === 0) {
    return null;
  }

  return {
    run: runResult.rows[0],
    logs: logsResult.rows,
  };
}

export function classifySourceHealthStatus({ tier, recentErrorEvents = 0, latestRunStatus = null }) {
  if (tier === 'unreliable' || recentErrorEvents >= 5) {
    return 'critical';
  }

  if (tier === 'poor' || tier === 'fair' || latestRunStatus === 'failed' || recentErrorEvents > 0) {
    return 'degraded';
  }

  return 'healthy';
}

function countByField(rows, field) {
  const counts = {};
  for (const row of rows) {
    const value = row[field] ?? 'unknown';
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

export async function listFailureInbox(database, { limit = DEFAULT_INBOX_LIMIT, sinceHours = 72 } = {}) {
  const normalizedLimit = clampInt(limit, DEFAULT_INBOX_LIMIT, { min: 1, max: MAX_LIMIT });
  const normalizedSinceHours = clampInt(sinceHours, 72, { min: 1, max: 24 * 30 });
  const result = await database.query(
    `WITH recent_logs AS (
       SELECT id, created_at, category, event_type, message, source, command, request_path,
              run_id, system_run_id, error_name, error_code, metadata,
              COALESCE(source, command, request_path, 'system') AS emitter
       FROM operation_logs
       WHERE level = 'error'
         AND created_at >= NOW() - $1::interval
     ),
     grouped AS (
       SELECT category, event_type, emitter,
              COUNT(*)::int AS occurrence_count,
              MIN(created_at) AS first_seen,
              MAX(created_at) AS last_seen
       FROM recent_logs
       GROUP BY category, event_type, emitter
     ),
     latest AS (
       SELECT DISTINCT ON (category, event_type, emitter)
              category, event_type, emitter, message, source, command, request_path,
              run_id, error_name, error_code, metadata
       FROM recent_logs
       ORDER BY category, event_type, emitter, created_at DESC
     )
     SELECT g.category, g.event_type, g.emitter, g.occurrence_count, g.first_seen, g.last_seen,
            l.message, l.source, l.command, l.request_path, l.run_id, l.error_name, l.error_code, l.metadata
     FROM grouped g
     JOIN latest l
       ON l.category = g.category
      AND l.event_type = g.event_type
      AND l.emitter = g.emitter
     ORDER BY g.last_seen DESC, g.occurrence_count DESC, g.emitter ASC
     LIMIT $2`,
    [toIntervalHours(normalizedSinceHours), normalizedLimit],
  );

  return {
    items: result.rows,
    total: result.rows.length,
    limit: normalizedLimit,
    since_hours: normalizedSinceHours,
  };
}

export async function listSourceHealth(database, { limit = DEFAULT_SOURCE_HEALTH_LIMIT, sinceHours = 72 } = {}) {
  const normalizedLimit = clampInt(limit, DEFAULT_SOURCE_HEALTH_LIMIT, { min: 1, max: MAX_LIMIT });
  const normalizedSinceHours = clampInt(sinceHours, 72, { min: 1, max: 24 * 30 });
  const interval = toIntervalHours(normalizedSinceHours);

  const [reliability, recentErrorsResult, latestRunsResult] = await Promise.all([
    scoreSourceReliability(database, { limit: Math.max(normalizedLimit, MAX_LIMIT) }),
    database.query(
      `SELECT source,
              COUNT(*) FILTER (WHERE level = 'error')::int AS recent_error_events,
              COUNT(*) FILTER (WHERE level = 'warn')::int AS recent_warning_events,
              MAX(created_at) FILTER (WHERE level = 'error') AS last_error_at
       FROM operation_logs
       WHERE source IS NOT NULL
         AND created_at >= NOW() - $1::interval
       GROUP BY source`,
      [interval],
    ),
    database.query(
      `SELECT DISTINCT ON (source)
              source, status, started_at, completed_at, error_message,
              items_discovered, items_new, items_duplicate, items_invalid
       FROM harvest_runs
       ORDER BY source, started_at DESC`,
    ),
  ]);

  const reliabilityBySource = new Map(
    reliability.scores.map(score => [
      score.source_name,
      {
        reliability_score: score.score,
        reliability_tier: score.tier,
        reliability_factors: score.factors,
      },
    ]),
  );
  const errorsBySource = new Map(recentErrorsResult.rows.map(row => [row.source, row]));
  const latestRunsBySource = new Map(latestRunsResult.rows.map(row => [row.source, row]));

  const allSources = new Set([
    ...reliabilityBySource.keys(),
    ...errorsBySource.keys(),
    ...latestRunsBySource.keys(),
  ]);

  const sources = Array.from(allSources).map((source) => {
    const score = reliabilityBySource.get(source) || {};
    const errors = errorsBySource.get(source) || {};
    const latestRun = latestRunsBySource.get(source) || null;
    const health_status = classifySourceHealthStatus({
      tier: score.reliability_tier || null,
      recentErrorEvents: errors.recent_error_events || 0,
      latestRunStatus: latestRun?.status || null,
    });

    return {
      source,
      health_status,
      reliability_score: score.reliability_score ?? null,
      reliability_tier: score.reliability_tier ?? null,
      reliability_factors: score.reliability_factors ?? null,
      recent_error_events: errors.recent_error_events || 0,
      recent_warning_events: errors.recent_warning_events || 0,
      last_error_at: errors.last_error_at || null,
      latest_run: latestRun ? {
        status: latestRun.status,
        started_at: latestRun.started_at,
        completed_at: latestRun.completed_at,
        error_message: latestRun.error_message,
        items_discovered: latestRun.items_discovered,
        items_new: latestRun.items_new,
        items_duplicate: latestRun.items_duplicate,
        items_invalid: latestRun.items_invalid,
      } : null,
    };
  });

  const statusRank = { critical: 0, degraded: 1, healthy: 2 };
  sources.sort((a, b) => {
    const statusCompare = (statusRank[a.health_status] ?? 99) - (statusRank[b.health_status] ?? 99);
    if (statusCompare !== 0) return statusCompare;
    if ((b.recent_error_events || 0) !== (a.recent_error_events || 0)) {
      return (b.recent_error_events || 0) - (a.recent_error_events || 0);
    }
    if ((a.reliability_score ?? 101) !== (b.reliability_score ?? 101)) {
      return (a.reliability_score ?? 101) - (b.reliability_score ?? 101);
    }
    return String(a.source).localeCompare(String(b.source));
  });

  const limitedSources = sources.slice(0, normalizedLimit);

  return {
    sources: limitedSources,
    total: sources.length,
    limit: normalizedLimit,
    since_hours: normalizedSinceHours,
    summary: {
      total_sources: sources.length,
      by_status: countByField(sources, 'health_status'),
      by_tier: countByField(sources, 'reliability_tier'),
      generated_at: new Date().toISOString(),
    },
  };
}
