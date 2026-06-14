// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { addClaimEvidence, createClaim } from '../db/claim-store.js';
import { logger } from '../utils/logger.js';

function truncate(value, maxLength = 600) {
  if (!value) return null;
  const text = String(value).trim().replace(/\s+/g, ' ');
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function normalizeSummary(summary, itemName) {
  const text = truncate(summary, 1200);
  if (!text) return null;

  const segments = text
    .split('|')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => !/^tool=|^nodes=|^trigger=/i.test(segment));

  const preferred = segments.find((segment) => {
    if (itemName && segment === itemName) return false;
    return segment.length >= 20;
  }) || segments.find((segment) => itemName ? segment !== itemName : true);

  return preferred || text;
}

export function inferClaimType(record = {}, text = '') {
  const artifactType = String(record.artifact_type || '').toLowerCase();
  const itemName = String(record.item_name || '').toLowerCase();
  const haystack = `${text} ${artifactType} ${itemName}`.toLowerCase();

  if (/\b(policy|must|should|required|requires|control|compliance|governance)\b/.test(haystack)) {
    return 'policy';
  }
  if (/\b(risk|incident|failure|outage|vulnerability|security)\b/.test(haystack)) {
    return 'risk';
  }
  if (/\b(decision|adr|chosen|approved)\b/.test(haystack)) {
    return 'decision';
  }
  if (/\b(depends on|uses|integrates with|connects to|references)\b/.test(haystack)) {
    return 'relationship';
  }
  if (record.item_kind === 'workflow' || artifactType === 'workflow') {
    return 'process';
  }

  return 'assertion';
}

export function estimateClaimConfidence(record = {}, text = '') {
  let score = record.decision === 'accepted' ? 0.72 : 0.55;
  if (text.length >= 80) score += 0.08;
  if (record.source_url) score += 0.05;
  if (record.stored_id) score += 0.05;
  return Math.min(0.95, Math.max(0.4, score));
}

export function buildClaimCandidate(record = {}) {
  const summaryText = normalizeSummary(record.summary, record.item_name);
  const itemName = truncate(record.item_name, 240);

  let claimText = summaryText || itemName;
  if (!claimText) return null;

  if (!/[.!?]$/.test(claimText)) {
    claimText = `${claimText}.`;
  }

  const claimType = inferClaimType(record, claimText);
  const confidence = estimateClaimConfidence(record, claimText);
  const subjectType = record.stored_kind || null;
  const subjectId = record.stored_id || null;

  return {
    claimText,
    claimType,
    status: 'candidate',
    confidence,
    subjectType,
    subjectId,
    artifactId: record.stored_kind === 'artifact' ? record.stored_id : null,
    workflowId: record.stored_kind === 'workflow' ? record.stored_id : null,
    sourceRecordId: record.id,
    summary: truncate(summaryText || claimText, 600),
    metadata: {
      extractor: 'heuristic-source-record',
      source: record.source || null,
      decision: record.decision || null,
      item_kind: record.item_kind || null,
      artifact_type: record.artifact_type || null,
    },
  };
}

export function buildClaimEvidence(record = {}, confidence = 0.65) {
  const excerpt = truncate(record.summary || record.item_name, 800);
  if (!excerpt && !record.source_url && !record.stored_id) {
    return null;
  }

  return {
    evidenceRole: 'supports',
    artifactId: record.stored_kind === 'artifact' ? record.stored_id : null,
    workflowId: record.stored_kind === 'workflow' ? record.stored_id : null,
    sourceRecordId: record.id,
    sourceUrl: record.source_url || null,
    excerpt,
    confidence: Math.max(0.35, Math.min(0.95, confidence - 0.05)),
    metadata: {
      extractor: 'heuristic-source-record',
      source: record.source || null,
    },
  };
}

export async function batchExtractClaims(database, limit = 100) {
  const result = await database.query(
    `SELECT sr.id, sr.source, sr.source_url, sr.item_name, sr.item_kind, sr.artifact_type,
            sr.stored_kind, sr.stored_id, sr.decision, sr.summary
     FROM source_records sr
     WHERE sr.decision = 'accepted'
       AND NOT EXISTS (
         SELECT 1
         FROM knowledge_claims kc
         WHERE kc.source_record_id = sr.id
       )
     ORDER BY sr.recorded_at DESC
     LIMIT $1`,
    [limit],
  );

  let processed = 0;
  let created = 0;
  let evidenceCreated = 0;
  let skipped = 0;
  let failed = 0;

  for (const record of result.rows) {
    processed++;
    const candidate = buildClaimCandidate(record);
    if (!candidate) {
      skipped++;
      continue;
    }

    try {
      const claim = await createClaim(database, candidate);
      created++;

      const evidence = buildClaimEvidence(record, candidate.confidence);
      if (claim && evidence) {
        await addClaimEvidence(database, claim.id, evidence);
        evidenceCreated++;
      }
    } catch (error) {
      failed++;
      logger.error('Claim extraction failed', {
        source_record_id: record.id,
        error: error.message,
      });
    }
  }

  return {
    processed,
    created,
    evidence_created: evidenceCreated,
    skipped,
    failed,
  };
}
