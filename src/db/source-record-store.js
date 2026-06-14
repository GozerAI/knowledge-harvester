// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { randomUUID } from 'node:crypto';
import { db } from './client.js';

export const DEFAULT_SOURCE_RECORD_LIMIT = 20;
export const MAX_LIMIT = 100;

function clampInt(value, fallback, { min = 0, max = MAX_LIMIT } = {}) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function toIntervalHours(hours) {
  return `${hours} hours`;
}

function truncate(value, maxLength = 800) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export function buildWorkflowSourceSummary(workflow) {
  const parts = [
    workflow.workflow_name || 'Untitled workflow',
    workflow.original_description || null,
    workflow.metadata?.node_count ? `nodes=${workflow.metadata.node_count}` : null,
    workflow.metadata?.trigger_type ? `trigger=${workflow.metadata.trigger_type}` : null,
  ].filter(Boolean);
  return truncate(parts.join(' | '), 1200);
}

export function buildArtifactSourceSummary(artifact) {
  const parts = [
    artifact.name || 'Untitled artifact',
    artifact.artifact_type || null,
    artifact.description || null,
    artifact.tool_type ? `tool=${artifact.tool_type}` : null,
  ].filter(Boolean);
  return truncate(parts.join(' | '), 1200);
}

export function normalizeSourceRecordFilters(filters = {}) {
  return {
    source: filters.source ? String(filters.source).trim() : null,
    decision: filters.decision ? String(filters.decision).trim().toLowerCase() : null,
    runId: filters.runId ? String(filters.runId).trim() : null,
    storedKind: filters.storedKind ? String(filters.storedKind).trim().toLowerCase() : null,
    artifactType: filters.artifactType ? String(filters.artifactType).trim() : null,
    search: filters.search ? String(filters.search).trim() : null,
    sinceHours: clampInt(filters.sinceHours, 24 * 7, { min: 1, max: 24 * 180 }),
    limit: clampInt(filters.limit, DEFAULT_SOURCE_RECORD_LIMIT, { min: 1, max: MAX_LIMIT }),
    offset: clampInt(filters.offset, 0, { min: 0, max: 10_000 }),
  };
}

function buildSourceRecordWhere(filters) {
  const clauses = ['recorded_at >= NOW() - $1::interval'];
  const params = [toIntervalHours(filters.sinceHours)];
  let index = 2;

  if (filters.source) {
    clauses.push(`source = $${index}`);
    params.push(filters.source);
    index++;
  }
  if (filters.decision) {
    clauses.push(`decision = $${index}`);
    params.push(filters.decision);
    index++;
  }
  if (filters.runId) {
    clauses.push(`run_id = $${index}`);
    params.push(filters.runId);
    index++;
  }
  if (filters.storedKind) {
    clauses.push(`stored_kind = $${index}`);
    params.push(filters.storedKind);
    index++;
  }
  if (filters.artifactType) {
    clauses.push(`artifact_type = $${index}`);
    params.push(filters.artifactType);
    index++;
  }
  if (filters.search) {
    clauses.push(`(
      COALESCE(item_name, '') ILIKE $${index}
      OR COALESCE(summary, '') ILIKE $${index}
      OR COALESCE(source_url, '') ILIKE $${index}
      OR COALESCE(discard_reason, '') ILIKE $${index}
    )`);
    params.push(`%${filters.search}%`);
    index++;
  }

  return { whereSql: clauses.join(' AND '), params, nextIndex: index };
}

export async function createSourceRecord(database, entry = {}) {
  const result = await database.query(
    `INSERT INTO source_records (
       id, source, run_id, source_url, source_id, content_hash,
       item_name, item_kind, artifact_type, stored_kind, stored_id,
       decision, summary, discard_reason, metadata
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10, $11,
       $12, $13, $14, $15
     )
     RETURNING *`,
    [
      entry.id || randomUUID(),
      entry.source,
      entry.runId || null,
      entry.sourceUrl || null,
      entry.sourceId || null,
      entry.contentHash || null,
      entry.itemName || null,
      entry.itemKind || 'raw-source',
      entry.artifactType || null,
      entry.storedKind || null,
      entry.storedId || null,
      entry.decision || 'accepted',
      truncate(entry.summary, 4000),
      entry.discardReason || null,
      JSON.stringify(entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {}),
    ],
  );

  return result.rows[0];
}

export async function createSourceRecordSafely(entry, { database = db } = {}) {
  try {
    return await createSourceRecord(database, entry);
  } catch (error) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      msg: 'Failed to persist source record',
      source: entry?.source,
      decision: entry?.decision,
      error: error.message,
    }));
    return null;
  }
}

export async function listSourceRecords(database, filters = {}) {
  const normalized = normalizeSourceRecordFilters(filters);
  const { whereSql, params, nextIndex } = buildSourceRecordWhere(normalized);
  const [countResult, listResult] = await Promise.all([
    database.query(`SELECT COUNT(*)::int AS count FROM source_records WHERE ${whereSql}`, params),
    database.query(
      `SELECT id, recorded_at, source, run_id, source_url, source_id, content_hash,
              item_name, item_kind, artifact_type, stored_kind, stored_id,
              decision, summary, discard_reason, metadata
       FROM source_records
       WHERE ${whereSql}
       ORDER BY recorded_at DESC
       LIMIT $${nextIndex} OFFSET $${nextIndex + 1}`,
      [...params, normalized.limit, normalized.offset],
    ),
  ]);

  return {
    records: listResult.rows,
    total: countResult.rows[0]?.count || 0,
    limit: normalized.limit,
    offset: normalized.offset,
    since_hours: normalized.sinceHours,
  };
}

export async function summarizeSourceRecords(database, filters = {}) {
  const normalized = normalizeSourceRecordFilters(filters);
  const { whereSql, params } = buildSourceRecordWhere(normalized);
  const [totals, byDecision, bySource] = await Promise.all([
    database.query(
      `SELECT COUNT(*)::int AS total
       FROM source_records
       WHERE ${whereSql}`,
      params,
    ),
    database.query(
      `SELECT decision, COUNT(*)::int AS count
       FROM source_records
       WHERE ${whereSql}
       GROUP BY decision
       ORDER BY count DESC, decision ASC`,
      params,
    ),
    database.query(
      `SELECT source, COUNT(*)::int AS count
       FROM source_records
       WHERE ${whereSql}
       GROUP BY source
       ORDER BY count DESC, source ASC
       LIMIT 10`,
      params,
    ),
  ]);

  return {
    total: totals.rows[0]?.total || 0,
    by_decision: byDecision.rows,
    top_sources: bySource.rows,
    window_hours: normalized.sinceHours,
  };
}
