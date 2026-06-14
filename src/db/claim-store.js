// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { randomUUID } from 'node:crypto';
import { db } from './client.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function clampInt(value, fallback, { min = 0, max = MAX_LIMIT } = {}) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function clampFloat(value, fallback, { min = 0, max = 1 } = {}) {
  const parsed = Number.parseFloat(value ?? '');
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function normalizeClaimFilters(filters = {}) {
  return {
    status: filters.status ? String(filters.status).trim().toLowerCase() : null,
    claimType: filters.claimType ? String(filters.claimType).trim().toLowerCase() : null,
    subjectType: filters.subjectType ? String(filters.subjectType).trim().toLowerCase() : null,
    subjectId: filters.subjectId ? String(filters.subjectId).trim() : null,
    artifactId: filters.artifactId ? String(filters.artifactId).trim() : null,
    workflowId: filters.workflowId ? String(filters.workflowId).trim() : null,
    sourceRecordId: filters.sourceRecordId ? String(filters.sourceRecordId).trim() : null,
    search: filters.search ? String(filters.search).trim() : null,
    limit: clampInt(filters.limit, DEFAULT_LIMIT, { min: 1, max: MAX_LIMIT }),
    offset: clampInt(filters.offset, 0, { min: 0, max: 10_000 }),
  };
}

function buildClaimWhere(filters, { tableAlias = '' } = {}) {
  const column = (name) => (tableAlias ? `${tableAlias}.${name}` : name);
  const clauses = ['1 = 1'];
  const params = [];
  let index = 1;

  if (filters.status) {
    clauses.push(`${column('status')} = $${index}`);
    params.push(filters.status);
    index++;
  }
  if (filters.claimType) {
    clauses.push(`${column('claim_type')} = $${index}`);
    params.push(filters.claimType);
    index++;
  }
  if (filters.subjectType) {
    clauses.push(`${column('subject_type')} = $${index}`);
    params.push(filters.subjectType);
    index++;
  }
  if (filters.subjectId) {
    clauses.push(`${column('subject_id')} = $${index}`);
    params.push(filters.subjectId);
    index++;
  }
  if (filters.artifactId) {
    clauses.push(`${column('artifact_id')} = $${index}`);
    params.push(filters.artifactId);
    index++;
  }
  if (filters.workflowId) {
    clauses.push(`${column('workflow_id')} = $${index}`);
    params.push(filters.workflowId);
    index++;
  }
  if (filters.sourceRecordId) {
    clauses.push(`${column('source_record_id')} = $${index}`);
    params.push(filters.sourceRecordId);
    index++;
  }
  if (filters.search) {
    clauses.push(`(
      ${column('claim_text')} ILIKE $${index}
      OR COALESCE(${column('summary')}, '') ILIKE $${index}
    )`);
    params.push(`%${filters.search}%`);
    index++;
  }

  return { whereSql: clauses.join(' AND '), params, nextIndex: index };
}

export async function createClaim(database, entry = {}) {
  const claimText = String(entry.claimText || '').trim();
  if (!claimText) {
    throw new Error('claimText is required');
  }

  const result = await database.query(
    `INSERT INTO knowledge_claims (
       id, claim_text, claim_type, status, confidence, subject_type, subject_id,
       artifact_id, workflow_id, source_record_id, summary, metadata
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11, $12
     )
     RETURNING *`,
    [
      entry.id || randomUUID(),
      claimText,
      entry.claimType || 'assertion',
      entry.status || 'candidate',
      clampFloat(entry.confidence, 0.5),
      entry.subjectType || null,
      entry.subjectId || null,
      entry.artifactId || null,
      entry.workflowId || null,
      entry.sourceRecordId || null,
      entry.summary || null,
      JSON.stringify(entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {}),
    ],
  );

  return result.rows[0];
}

export async function addClaimEvidence(database, claimId, entry = {}) {
  const result = await database.query(
    `INSERT INTO claim_evidence (
       id, claim_id, evidence_role, artifact_id, workflow_id, source_record_id,
       source_url, excerpt, confidence, metadata
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10
     )
     RETURNING *`,
    [
      entry.id || randomUUID(),
      claimId,
      entry.evidenceRole || 'supports',
      entry.artifactId || null,
      entry.workflowId || null,
      entry.sourceRecordId || null,
      entry.sourceUrl || null,
      entry.excerpt || null,
      clampFloat(entry.confidence, 0.5),
      JSON.stringify(entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {}),
    ],
  );

  return result.rows[0];
}

export async function updateClaim(database, claimId, updates = {}) {
  const setClauses = [];
  const params = [];
  let index = 1;

  if (updates.claimText !== undefined) {
    const claimText = String(updates.claimText || '').trim();
    if (!claimText) {
      throw new Error('claimText is required');
    }
    setClauses.push(`claim_text = $${index}`);
    params.push(claimText);
    index++;
  }
  if (updates.claimType !== undefined) {
    setClauses.push(`claim_type = $${index}`);
    params.push(updates.claimType || 'assertion');
    index++;
  }
  if (updates.status !== undefined) {
    setClauses.push(`status = $${index}`);
    params.push(updates.status || 'candidate');
    index++;
  }
  if (updates.confidence !== undefined) {
    setClauses.push(`confidence = $${index}`);
    params.push(clampFloat(updates.confidence, 0.5));
    index++;
  }
  if (updates.summary !== undefined) {
    setClauses.push(`summary = $${index}`);
    params.push(updates.summary || null);
    index++;
  }
  if (updates.metadata && typeof updates.metadata === 'object') {
    setClauses.push(`metadata = COALESCE(metadata, '{}'::jsonb) || $${index}::jsonb`);
    params.push(JSON.stringify(updates.metadata));
    index++;
  }

  if (setClauses.length === 0) {
    throw new Error('No valid claim fields to update');
  }

  setClauses.push('updated_at = NOW()');
  params.push(claimId);

  const result = await database.query(
    `UPDATE knowledge_claims
     SET ${setClauses.join(', ')}
     WHERE id = $${index}
     RETURNING *`,
    params,
  );

  return result.rows[0] || null;
}

export async function listClaims(database, filters = {}) {
  const normalized = normalizeClaimFilters(filters);
  const { whereSql, params, nextIndex } = buildClaimWhere(normalized);
  const [countResult, listResult] = await Promise.all([
    database.query(`SELECT COUNT(*)::int AS count FROM knowledge_claims WHERE ${whereSql}`, params),
    database.query(
      `SELECT id, claim_text, claim_type, status, confidence, subject_type, subject_id,
              artifact_id, workflow_id, source_record_id, summary, metadata,
              created_at, updated_at
       FROM knowledge_claims
       WHERE ${whereSql}
       ORDER BY updated_at DESC, created_at DESC
       LIMIT $${nextIndex} OFFSET $${nextIndex + 1}`,
      [...params, normalized.limit, normalized.offset],
    ),
  ]);

  return {
    claims: listResult.rows,
    total: countResult.rows[0]?.count || 0,
    limit: normalized.limit,
    offset: normalized.offset,
  };
}

export async function summarizeClaims(database, filters = {}) {
  const normalized = normalizeClaimFilters(filters);
  const { whereSql, params } = buildClaimWhere(normalized, { tableAlias: 'c' });
  const [totals, byStatus, byType, bySubjectType, reviewQueue] = await Promise.all([
    database.query(
      `SELECT COUNT(*)::int AS total
       FROM knowledge_claims c
       WHERE ${whereSql}`,
      params,
    ),
    database.query(
      `SELECT status, COUNT(*)::int AS count
       FROM knowledge_claims c
       WHERE ${whereSql}
       GROUP BY status
       ORDER BY count DESC, status ASC`,
      params,
    ),
    database.query(
      `SELECT claim_type, COUNT(*)::int AS count
       FROM knowledge_claims c
       WHERE ${whereSql}
       GROUP BY claim_type
       ORDER BY count DESC, claim_type ASC`,
      params,
    ),
    database.query(
      `SELECT COALESCE(subject_type, 'unknown') AS subject_type, COUNT(*)::int AS count
       FROM knowledge_claims c
       WHERE ${whereSql}
       GROUP BY COALESCE(subject_type, 'unknown')
       ORDER BY count DESC, subject_type ASC`,
      params,
    ),
    database.query(
      `SELECT
         COUNT(*) FILTER (WHERE c.status IN ('candidate', 'disputed'))::int AS needs_review,
         COUNT(*) FILTER (WHERE c.status = 'disputed')::int AS disputed,
         COUNT(*) FILTER (
           WHERE c.status = 'accepted'
             AND COALESCE(ev.supports_count, 0) = 0
         )::int AS accepted_without_support,
         COUNT(*) FILTER (WHERE COALESCE(ev.contradicts_count, 0) > 0)::int AS contradicted
       FROM knowledge_claims c
       LEFT JOIN (
         SELECT
           claim_id,
           COUNT(*) FILTER (WHERE evidence_role = 'supports')::int AS supports_count,
           COUNT(*) FILTER (WHERE evidence_role = 'contradicts')::int AS contradicts_count
         FROM claim_evidence
         GROUP BY claim_id
       ) ev ON ev.claim_id = c.id
       WHERE ${whereSql}`,
      params,
    ),
  ]);

  return {
    total: totals.rows[0]?.total || 0,
    by_status: byStatus.rows,
    by_type: byType.rows,
    by_subject_type: bySubjectType.rows,
    review_queue: reviewQueue.rows[0] || {
      needs_review: 0,
      disputed: 0,
      accepted_without_support: 0,
      contradicted: 0,
    },
  };
}

export async function listClaimQueue(database, filters = {}) {
  const normalized = normalizeClaimFilters(filters);
  const { whereSql, params, nextIndex } = buildClaimWhere(normalized, { tableAlias: 'c' });
  const queueWhereSql = `${whereSql} AND c.status != 'archived'`;
  const evidenceJoin = `LEFT JOIN (
    SELECT
      claim_id,
      COUNT(*)::int AS evidence_count,
      COUNT(*) FILTER (WHERE evidence_role = 'supports')::int AS supports_count,
      COUNT(*) FILTER (WHERE evidence_role = 'contradicts')::int AS contradicts_count,
      COUNT(*) FILTER (WHERE evidence_role = 'context')::int AS context_count
    FROM claim_evidence
    GROUP BY claim_id
  ) ev ON ev.claim_id = c.id`;

  const [countResult, listResult] = await Promise.all([
    database.query(
      `SELECT COUNT(*)::int AS count
       FROM knowledge_claims c
       ${evidenceJoin}
       WHERE ${queueWhereSql}
         AND (
           c.status IN ('candidate', 'disputed')
           OR COALESCE(ev.contradicts_count, 0) > 0
           OR (c.status = 'accepted' AND COALESCE(ev.supports_count, 0) = 0)
         )`,
      params,
    ),
    database.query(
      `SELECT
         c.id,
         c.claim_text,
         c.claim_type,
         c.status,
         c.confidence,
         c.subject_type,
         c.subject_id,
         c.artifact_id,
         c.workflow_id,
         c.source_record_id,
         c.summary,
         c.metadata,
         c.created_at,
         c.updated_at,
         COALESCE(ev.evidence_count, 0) AS evidence_count,
         COALESCE(ev.supports_count, 0) AS supports_count,
         COALESCE(ev.contradicts_count, 0) AS contradicts_count,
         COALESCE(ev.context_count, 0) AS context_count,
         CASE
           WHEN c.status = 'disputed' THEN 0
           WHEN COALESCE(ev.contradicts_count, 0) > 0 THEN 1
           WHEN c.status = 'candidate' AND COALESCE(ev.supports_count, 0) = 0 THEN 2
           WHEN c.status = 'candidate' THEN 3
           WHEN c.status = 'accepted' AND COALESCE(ev.supports_count, 0) = 0 THEN 4
           ELSE 5
         END AS review_priority
       FROM knowledge_claims c
       ${evidenceJoin}
       WHERE ${queueWhereSql}
         AND (
           c.status IN ('candidate', 'disputed')
           OR COALESCE(ev.contradicts_count, 0) > 0
           OR (c.status = 'accepted' AND COALESCE(ev.supports_count, 0) = 0)
         )
       ORDER BY review_priority ASC, COALESCE(ev.contradicts_count, 0) DESC, c.updated_at DESC, c.created_at DESC
       LIMIT $${nextIndex} OFFSET $${nextIndex + 1}`,
      [...params, normalized.limit, normalized.offset],
    ),
  ]);

  return {
    claims: listResult.rows,
    total: countResult.rows[0]?.count || 0,
    limit: normalized.limit,
    offset: normalized.offset,
  };
}

export async function getClaimDetails(database, claimId, { evidenceLimit = DEFAULT_LIMIT } = {}) {
  const [claimResult, evidenceResult] = await Promise.all([
    database.query(
      `SELECT id, claim_text, claim_type, status, confidence, subject_type, subject_id,
              artifact_id, workflow_id, source_record_id, summary, metadata,
              created_at, updated_at
       FROM knowledge_claims
       WHERE id = $1`,
      [claimId],
    ),
    database.query(
      `SELECT id, claim_id, evidence_role, artifact_id, workflow_id, source_record_id,
              source_url, excerpt, confidence, metadata, created_at
       FROM claim_evidence
       WHERE claim_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [claimId, clampInt(evidenceLimit, DEFAULT_LIMIT, { min: 1, max: MAX_LIMIT })],
    ),
  ]);

  if (claimResult.rows.length === 0) return null;

  return {
    claim: claimResult.rows[0],
    evidence: evidenceResult.rows,
  };
}

export async function createClaimSafely(entry, { database = db } = {}) {
  try {
    return await createClaim(database, entry);
  } catch (error) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      msg: 'Failed to persist claim',
      claim_type: entry?.claimType,
      error: error.message,
    }));
    return null;
  }
}
