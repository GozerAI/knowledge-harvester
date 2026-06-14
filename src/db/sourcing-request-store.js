// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { randomUUID } from 'node:crypto';
import { db } from './client.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const VALID_STATUSES = new Set(['planned', 'queued', 'dispatching', 'completed', 'failed', 'cancelled']);
const VALID_PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);

function clampInt(value, fallback, { min = 0, max = MAX_LIMIT } = {}) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function normalizeList(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeEnum(value, validValues, fallback, label) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (!validValues.has(normalized)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return normalized;
}

export function normalizeSourcingRequestFilters(filters = {}) {
  return {
    status: filters.status ? String(filters.status).trim().toLowerCase() : null,
    requesterRole: filters.requesterRole ? String(filters.requesterRole).trim().toLowerCase() : null,
    domain: filters.domain ? String(filters.domain).trim().toLowerCase() : null,
    limit: clampInt(filters.limit, DEFAULT_LIMIT, { min: 1, max: MAX_LIMIT }),
    offset: clampInt(filters.offset, 0, { min: 0, max: 10_000 }),
  };
}

function buildWhere(filters) {
  const clauses = ['1 = 1'];
  const params = [];
  let index = 1;

  if (filters.status) {
    clauses.push(`status = $${index}`);
    params.push(filters.status);
    index++;
  }
  if (filters.requesterRole) {
    clauses.push(`requester_role = $${index}`);
    params.push(filters.requesterRole);
    index++;
  }
  if (filters.domain) {
    clauses.push(`domain = $${index}`);
    params.push(filters.domain);
    index++;
  }

  return { whereSql: clauses.join(' AND '), params, nextIndex: index };
}

function mapRow(row) {
  if (!row) return null;
  return {
    ...row,
    research_questions: row.research_questions || [],
    preferred_sources: row.preferred_sources || [],
    selected_sources: row.selected_sources || [],
    artifact_types: row.artifact_types || [],
    categories: row.categories || [],
    constraints: row.constraints || {},
    qualification: row.qualification || {},
    result_summary: row.result_summary || {},
    metadata: row.metadata || {},
  };
}

export async function createSourcingRequest(database, entry = {}) {
  const requester = String(entry.requester || '').trim();
  const requesterRole = String(entry.requesterRole || '').trim().toLowerCase();
  const domain = String(entry.domain || '').trim().toLowerCase();
  const topic = String(entry.topic || '').trim();
  const objective = String(entry.objective || '').trim();
  const status = normalizeEnum(entry.status, VALID_STATUSES, 'planned', 'status');
  const priority = normalizeEnum(entry.priority, VALID_PRIORITIES, 'medium', 'priority');

  if (!requester || !requesterRole || !domain || !topic || !objective) {
    throw new Error('requester, requesterRole, domain, topic, and objective are required');
  }

  const result = await database.query(
    `INSERT INTO sourcing_requests (
       id, requester, requester_role, domain, topic, objective, status, priority,
       research_questions, preferred_sources, selected_sources, artifact_types, categories,
       constraints, qualification, result_summary, metadata, error_message
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8,
       $9, $10, $11, $12, $13,
       $14, $15, $16, $17, $18
     )
     RETURNING *`,
    [
      entry.id || randomUUID(),
      requester,
      requesterRole,
      domain,
      topic,
      objective,
      status,
      priority,
      JSON.stringify(normalizeList(entry.researchQuestions)),
      JSON.stringify(normalizeList(entry.preferredSources)),
      JSON.stringify(normalizeList(entry.selectedSources)),
      JSON.stringify(normalizeList(entry.artifactTypes)),
      JSON.stringify(normalizeList(entry.categories)),
      JSON.stringify(normalizeObject(entry.constraints)),
      JSON.stringify(normalizeObject(entry.qualification)),
      JSON.stringify(normalizeObject(entry.resultSummary)),
      JSON.stringify(normalizeObject(entry.metadata)),
      entry.errorMessage || null,
    ],
  );

  return mapRow(result.rows[0]);
}

export async function updateSourcingRequest(database, requestId, updates = {}) {
  const clauses = [];
  const params = [];
  let index = 1;

  const addField = (column, value) => {
    clauses.push(`${column} = $${index}`);
    params.push(value);
    index++;
  };

  if (updates.status !== undefined) {
    addField('status', normalizeEnum(updates.status, VALID_STATUSES, undefined, 'status'));
  }
  if (updates.priority !== undefined) {
    addField('priority', normalizeEnum(updates.priority, VALID_PRIORITIES, undefined, 'priority'));
  }
  if (updates.selectedSources !== undefined) addField('selected_sources', JSON.stringify(normalizeList(updates.selectedSources)));
  if (updates.qualification !== undefined) addField('qualification', JSON.stringify(normalizeObject(updates.qualification)));
  if (updates.resultSummary !== undefined) addField('result_summary', JSON.stringify(normalizeObject(updates.resultSummary)));
  if (updates.metadata !== undefined) addField('metadata', JSON.stringify(normalizeObject(updates.metadata)));
  if (updates.errorMessage !== undefined) addField('error_message', updates.errorMessage || null);
  if (updates.dispatchedAt === 'now') clauses.push('dispatched_at = NOW()');
  if (updates.completedAt === 'now') clauses.push('completed_at = NOW()');

  if (clauses.length === 0) {
    const existing = await database.query('SELECT * FROM sourcing_requests WHERE id = $1', [requestId]);
    return mapRow(existing.rows[0] || null);
  }

  clauses.push('updated_at = NOW()');
  params.push(requestId);

  const result = await database.query(
    `UPDATE sourcing_requests
     SET ${clauses.join(', ')}
     WHERE id = $${index}
     RETURNING *`,
    params,
  );

  return mapRow(result.rows[0] || null);
}

export async function listSourcingRequests(database, filters = {}) {
  const normalized = normalizeSourcingRequestFilters(filters);
  const { whereSql, params, nextIndex } = buildWhere(normalized);
  const [countResult, listResult] = await Promise.all([
    database.query(`SELECT COUNT(*)::int AS count FROM sourcing_requests WHERE ${whereSql}`, params),
    database.query(
      `SELECT *
       FROM sourcing_requests
       WHERE ${whereSql}
       ORDER BY requested_at DESC, updated_at DESC
       LIMIT $${nextIndex} OFFSET $${nextIndex + 1}`,
      [...params, normalized.limit, normalized.offset],
    ),
  ]);

  return {
    requests: listResult.rows.map(mapRow),
    total: countResult.rows[0]?.count || 0,
    limit: normalized.limit,
    offset: normalized.offset,
  };
}

export async function getSourcingRequest(database, requestId) {
  const result = await database.query('SELECT * FROM sourcing_requests WHERE id = $1', [requestId]);
  return mapRow(result.rows[0] || null);
}

export async function createSourcingRequestSafely(entry, { database = db } = {}) {
  try {
    return await createSourcingRequest(database, entry);
  } catch (error) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      msg: 'Failed to persist sourcing request',
      requester_role: entry?.requesterRole,
      domain: entry?.domain,
      error: error.message,
    }));
    return null;
  }
}
