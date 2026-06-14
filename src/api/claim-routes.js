// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { db } from '../db/client.js';
import {
  createClaim,
  addClaimEvidence,
  getClaimDetails,
  listClaims,
  listClaimQueue,
  summarizeClaims,
  updateClaim,
} from '../db/claim-store.js';
import { batchExtractClaims } from '../processing/claim-extractor.js';
import { json, validateBody, validateUUID } from './middleware.js';

const VALID_CLAIM_TYPES = new Set([
  'assertion',
  'fact',
  'process',
  'policy',
  'relationship',
  'risk',
  'decision',
]);

const VALID_CLAIM_STATUSES = new Set([
  'candidate',
  'accepted',
  'disputed',
  'rejected',
  'archived',
]);

const VALID_EVIDENCE_ROLES = new Set([
  'supports',
  'contradicts',
  'context',
]);

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

function validateOptionalUuid(value, field, errors) {
  if (value !== undefined && value !== null && value !== '' && !validateUUID(String(value))) {
    errors.push(`${field} must be a valid UUID`);
  }
}

function normalizeClaimBody(body) {
  return {
    claimText: body.claim_text,
    claimType: body.claim_type,
    status: body.status,
    confidence: body.confidence,
    subjectType: body.subject_type,
    subjectId: body.subject_id,
    artifactId: body.artifact_id,
    workflowId: body.workflow_id,
    sourceRecordId: body.source_record_id,
    summary: body.summary,
    metadata: body.metadata,
  };
}

function validateClaimPayload(body) {
  const base = validateBody(body, ['claim_text']);
  if (!base.valid) {
    return base;
  }

  const errors = [];
  const claimText = String(body.claim_text || '').trim();
  if (!claimText) {
    errors.push('claim_text must not be empty');
  }

  if (body.claim_type && !VALID_CLAIM_TYPES.has(String(body.claim_type).trim().toLowerCase())) {
    errors.push(`claim_type must be one of: ${Array.from(VALID_CLAIM_TYPES).join(', ')}`);
  }
  if (body.status && !VALID_CLAIM_STATUSES.has(String(body.status).trim().toLowerCase())) {
    errors.push(`status must be one of: ${Array.from(VALID_CLAIM_STATUSES).join(', ')}`);
  }
  if (body.confidence !== undefined) {
    const confidence = Number(body.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      errors.push('confidence must be a number between 0 and 1');
    }
  }

  validateOptionalUuid(body.artifact_id, 'artifact_id', errors);
  validateOptionalUuid(body.workflow_id, 'workflow_id', errors);
  validateOptionalUuid(body.source_record_id, 'source_record_id', errors);

  return {
    valid: errors.length === 0,
    errors,
  };
}

function validateEvidencePayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: ['Request body must be a JSON object'] };
  }

  const errors = [];
  if (body.evidence_role && !VALID_EVIDENCE_ROLES.has(String(body.evidence_role).trim().toLowerCase())) {
    errors.push(`evidence_role must be one of: ${Array.from(VALID_EVIDENCE_ROLES).join(', ')}`);
  }
  if (body.confidence !== undefined) {
    const confidence = Number(body.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      errors.push('confidence must be a number between 0 and 1');
    }
  }

  validateOptionalUuid(body.artifact_id, 'artifact_id', errors);
  validateOptionalUuid(body.workflow_id, 'workflow_id', errors);
  validateOptionalUuid(body.source_record_id, 'source_record_id', errors);

  const hasEvidenceReference = [
    body.artifact_id,
    body.workflow_id,
    body.source_record_id,
    body.source_url,
    body.excerpt,
  ].some((value) => value !== undefined && value !== null && String(value).trim() !== '');

  if (!hasEvidenceReference) {
    errors.push('evidence must include at least one reference field');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function validateClaimUpdatePayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: ['Request body must be a JSON object'] };
  }

  const errors = [];
  const hasAnyField = [
    'claim_text',
    'claim_type',
    'status',
    'confidence',
    'summary',
    'metadata',
  ].some((field) => body[field] !== undefined);

  if (!hasAnyField) {
    errors.push('At least one claim field must be provided');
  }
  if (body.claim_text !== undefined && String(body.claim_text || '').trim() === '') {
    errors.push('claim_text must not be empty');
  }
  if (body.claim_type && !VALID_CLAIM_TYPES.has(String(body.claim_type).trim().toLowerCase())) {
    errors.push(`claim_type must be one of: ${Array.from(VALID_CLAIM_TYPES).join(', ')}`);
  }
  if (body.status && !VALID_CLAIM_STATUSES.has(String(body.status).trim().toLowerCase())) {
    errors.push(`status must be one of: ${Array.from(VALID_CLAIM_STATUSES).join(', ')}`);
  }
  if (body.confidence !== undefined) {
    const confidence = Number(body.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      errors.push('confidence must be a number between 0 and 1');
    }
  }
  if (body.metadata !== undefined && (!body.metadata || typeof body.metadata !== 'object' || Array.isArray(body.metadata))) {
    errors.push('metadata must be a JSON object');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function parseClaimFilters(params) {
  return {
    status: params.get('status') || undefined,
    claimType: params.get('claim_type') || undefined,
    subjectType: params.get('subject_type') || undefined,
    subjectId: params.get('subject_id') || undefined,
    artifactId: params.get('artifact_id') || undefined,
    workflowId: params.get('workflow_id') || undefined,
    sourceRecordId: params.get('source_record_id') || undefined,
    search: params.get('search') || params.get('q') || undefined,
    limit: params.get('limit') || undefined,
    offset: params.get('offset') || undefined,
  };
}

function validateClaimFilterIds(filters) {
  const errors = [];
  validateOptionalUuid(filters.artifactId, 'artifact_id', errors);
  validateOptionalUuid(filters.workflowId, 'workflow_id', errors);
  validateOptionalUuid(filters.sourceRecordId, 'source_record_id', errors);
  return errors[0] || null;
}

export function createClaimHandlers({ database = db } = {}) {
  return {
    async handleListClaims(_req, res, params) {
      const filters = parseClaimFilters(params);
      const validationError = validateClaimFilterIds(filters);
      if (validationError) {
        return json(res, 400, { error: validationError });
      }

      try {
        const result = await listClaims(database, filters);
        return json(res, 200, result);
      } catch {
        return json(res, 500, { error: 'Failed to list claims' });
      }
    },

    async handleGetClaim(_req, res, params, claimId) {
      if (!validateUUID(claimId)) {
        return json(res, 400, { error: 'Invalid claim id' });
      }

      try {
        const details = await getClaimDetails(database, claimId, {
          evidenceLimit: params.get('evidence_limit') || undefined,
        });
        if (!details) {
          return json(res, 404, { error: 'Claim not found' });
        }

        return json(res, 200, details);
      } catch {
        return json(res, 500, { error: 'Failed to get claim details' });
      }
    },

    async handleClaimSummary(_req, res, params) {
      const filters = parseClaimFilters(params);
      const validationError = validateClaimFilterIds(filters);
      if (validationError) {
        return json(res, 400, { error: validationError });
      }

      try {
        const summary = await summarizeClaims(database, filters);
        return json(res, 200, summary);
      } catch {
        return json(res, 500, { error: 'Failed to summarize claims' });
      }
    },

    async handleClaimQueue(_req, res, params) {
      const filters = parseClaimFilters(params);
      const validationError = validateClaimFilterIds(filters);
      if (validationError) {
        return json(res, 400, { error: validationError });
      }

      try {
        const queue = await listClaimQueue(database, filters);
        return json(res, 200, queue);
      } catch {
        return json(res, 500, { error: 'Failed to list claim review queue' });
      }
    },

    async handleCreateClaim(req, res) {
      let body;
      try {
        body = await readBody(req);
      } catch {
        return json(res, 400, { error: 'Invalid JSON body' });
      }

      const validation = validateClaimPayload(body);
      if (!validation.valid) {
        return json(res, 400, { error: 'Validation failed', errors: validation.errors });
      }

      try {
        const claim = await createClaim(database, normalizeClaimBody(body));
        return json(res, 201, claim);
      } catch {
        return json(res, 500, { error: 'Failed to create claim' });
      }
    },

    async handleUpdateClaim(req, res, _params, claimId) {
      if (!validateUUID(claimId)) {
        return json(res, 400, { error: 'Invalid claim id' });
      }

      let body;
      try {
        body = await readBody(req);
      } catch {
        return json(res, 400, { error: 'Invalid JSON body' });
      }

      const validation = validateClaimUpdatePayload(body);
      if (!validation.valid) {
        return json(res, 400, { error: 'Validation failed', errors: validation.errors });
      }

      try {
        const claim = await updateClaim(database, claimId, {
          claimText: body.claim_text,
          claimType: body.claim_type,
          status: body.status,
          confidence: body.confidence,
          summary: body.summary,
          metadata: body.metadata,
        });
        if (!claim) {
          return json(res, 404, { error: 'Claim not found' });
        }
        return json(res, 200, claim);
      } catch (error) {
        if (error.message === 'No valid claim fields to update' || error.message === 'claimText is required') {
          return json(res, 400, { error: error.message });
        }
        return json(res, 500, { error: 'Failed to update claim' });
      }
    },

    async handleExtractClaims(_req, res, params) {
      try {
        const rawLimit = Number.parseInt(params.get('limit') || '100', 10);
        const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? 100 : Math.min(rawLimit, 1000);
        const result = await batchExtractClaims(database, limit);
        return json(res, 200, result);
      } catch {
        return json(res, 500, { error: 'Failed to extract claims' });
      }
    },

    async handleAddClaimEvidence(req, res, _params, claimId) {
      if (!validateUUID(claimId)) {
        return json(res, 400, { error: 'Invalid claim id' });
      }

      let body;
      try {
        body = await readBody(req);
      } catch {
        return json(res, 400, { error: 'Invalid JSON body' });
      }

      const validation = validateEvidencePayload(body);
      if (!validation.valid) {
        return json(res, 400, { error: 'Validation failed', errors: validation.errors });
      }

      try {
        const existing = await getClaimDetails(database, claimId, { evidenceLimit: 1 });
        if (!existing) {
          return json(res, 404, { error: 'Claim not found' });
        }

        const evidence = await addClaimEvidence(database, claimId, {
          evidenceRole: body.evidence_role,
          artifactId: body.artifact_id,
          workflowId: body.workflow_id,
          sourceRecordId: body.source_record_id,
          sourceUrl: body.source_url,
          excerpt: body.excerpt,
          confidence: body.confidence,
          metadata: body.metadata,
        });

        return json(res, 201, evidence);
      } catch {
        return json(res, 500, { error: 'Failed to add claim evidence' });
      }
    },
  };
}

const handlers = createClaimHandlers();

export const handleListClaims = handlers.handleListClaims;
export const handleGetClaim = handlers.handleGetClaim;
export const handleClaimSummary = handlers.handleClaimSummary;
export const handleClaimQueue = handlers.handleClaimQueue;
export const handleCreateClaim = handlers.handleCreateClaim;
export const handleUpdateClaim = handlers.handleUpdateClaim;
export const handleExtractClaims = handlers.handleExtractClaims;
export const handleAddClaimEvidence = handlers.handleAddClaimEvidence;
