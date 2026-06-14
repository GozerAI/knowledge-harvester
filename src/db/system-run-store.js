// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { randomUUID } from 'node:crypto';
import { db } from './client.js';

export const DEFAULT_SYSTEM_RUN_LIMIT = 20;
export const MAX_LIMIT = 100;

function clampInt(value, fallback, { min = 0, max = MAX_LIMIT } = {}) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function normalizeSystemRunFilters(filters = {}) {
  return {
    runType: filters.runType ? String(filters.runType).trim().toLowerCase() : null,
    command: filters.command ? String(filters.command).trim() : null,
    status: filters.status ? String(filters.status).trim().toLowerCase() : null,
    trigger: filters.trigger ? String(filters.trigger).trim().toLowerCase() : null,
    limit: clampInt(filters.limit, DEFAULT_SYSTEM_RUN_LIMIT, { min: 1, max: MAX_LIMIT }),
    offset: clampInt(filters.offset, 0, { min: 0, max: 10_000 }),
  };
}

export async function createSystemRun(database, entry = {}) {
  const id = entry.id || randomUUID();
  const result = await database.query(
    `INSERT INTO system_runs (
       id, run_type, command, trigger, status, current_step,
       steps_requested, steps_completed, error_message, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      id,
      entry.runType || 'command',
      entry.command || null,
      entry.trigger || null,
      entry.status || 'running',
      entry.currentStep || null,
      entry.stepsRequested || [],
      entry.stepsCompleted || [],
      entry.errorMessage || null,
      JSON.stringify(entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {}),
    ],
  );

  return result.rows[0];
}

export async function createSystemRunSafely(entry, { database = db } = {}) {
  try {
    return await createSystemRun(database, entry);
  } catch (error) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      msg: 'Failed to persist system run',
      run_type: entry?.runType,
      command: entry?.command,
      error: error.message,
    }));
    return { id: entry?.id || randomUUID() };
  }
}

export async function updateSystemRun(database, runId, patch = {}) {
  const fields = [];
  const values = [];
  let index = 1;

  const assign = (column, value) => {
    fields.push(`${column} = $${index}`);
    values.push(value);
    index++;
  };

  if (patch.status !== undefined) assign('status', patch.status);
  if (patch.currentStep !== undefined) assign('current_step', patch.currentStep);
  if (patch.stepsRequested !== undefined) assign('steps_requested', patch.stepsRequested);
  if (patch.stepsCompleted !== undefined) assign('steps_completed', patch.stepsCompleted);
  if (patch.errorMessage !== undefined) assign('error_message', patch.errorMessage);
  if (patch.metadata !== undefined) {
    assign('metadata', JSON.stringify(patch.metadata && typeof patch.metadata === 'object' ? patch.metadata : {}));
  }
  if (patch.completedAt === 'now') {
    fields.push('completed_at = NOW()');
  } else if (patch.completedAt !== undefined) {
    assign('completed_at', patch.completedAt);
  }

  if (fields.length === 0) {
    const existing = await database.query('SELECT * FROM system_runs WHERE id = $1', [runId]);
    return existing.rows[0] || null;
  }

  values.push(runId);
  const result = await database.query(
    `UPDATE system_runs
     SET ${fields.join(', ')}
     WHERE id = $${index}
     RETURNING *`,
    values,
  );

  return result.rows[0] || null;
}

export async function updateSystemRunSafely(runId, patch, { database = db } = {}) {
  try {
    return await updateSystemRun(database, runId, patch);
  } catch (error) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      msg: 'Failed to update system run',
      run_id: runId,
      error: error.message,
    }));
    return null;
  }
}

export async function listSystemRuns(database, filters = {}) {
  const normalized = normalizeSystemRunFilters(filters);
  const clauses = [];
  const params = [];
  let index = 1;

  if (normalized.runType) {
    clauses.push(`sr.run_type = $${index}`);
    params.push(normalized.runType);
    index++;
  }
  if (normalized.command) {
    clauses.push(`sr.command = $${index}`);
    params.push(normalized.command);
    index++;
  }
  if (normalized.status) {
    clauses.push(`sr.status = $${index}`);
    params.push(normalized.status);
    index++;
  }
  if (normalized.trigger) {
    clauses.push(`sr.trigger = $${index}`);
    params.push(normalized.trigger);
    index++;
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const [countResult, listResult] = await Promise.all([
    database.query(`SELECT COUNT(*)::int AS count FROM system_runs sr ${whereSql}`, params),
    database.query(
      `SELECT sr.*,
              COUNT(ol.id) FILTER (WHERE ol.level = 'error')::int AS error_events,
              COUNT(ol.id) FILTER (WHERE ol.level = 'warn')::int AS warning_events
       FROM system_runs sr
       LEFT JOIN operation_logs ol ON ol.system_run_id = sr.id
       ${whereSql}
       GROUP BY sr.id
       ORDER BY sr.started_at DESC
       LIMIT $${index} OFFSET $${index + 1}`,
      [...params, normalized.limit, normalized.offset],
    ),
  ]);

  return {
    runs: listResult.rows,
    total: countResult.rows[0]?.count || 0,
    limit: normalized.limit,
    offset: normalized.offset,
  };
}

export async function getSystemRunDetails(database, runId, { logLimit = DEFAULT_SYSTEM_RUN_LIMIT } = {}) {
  const [runResult, logsResult] = await Promise.all([
    database.query(
      `SELECT sr.*,
              COUNT(ol.id) FILTER (WHERE ol.level = 'error')::int AS error_events,
              COUNT(ol.id) FILTER (WHERE ol.level = 'warn')::int AS warning_events
       FROM system_runs sr
       LEFT JOIN operation_logs ol ON ol.system_run_id = sr.id
       WHERE sr.id = $1
       GROUP BY sr.id`,
      [runId],
    ),
    database.query(
      `SELECT id, created_at, level, category, event_type, message, source,
              command, run_id, system_run_id, request_path, error_name, error_code, error_stack, metadata
       FROM operation_logs
       WHERE system_run_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [runId, clampInt(logLimit, DEFAULT_SYSTEM_RUN_LIMIT, { min: 1, max: MAX_LIMIT })],
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
