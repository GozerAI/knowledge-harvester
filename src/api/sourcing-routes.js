// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { db } from '../db/client.js';
import {
  createSourcingRequest,
  getSourcingRequest,
  listSourcingRequests,
  updateSourcingRequest,
} from '../db/sourcing-request-store.js';
import { buildSourcingQualification } from '../processing/sourcing-request-planner.js';
import { dispatchHarvestSources } from '../harvesters/source-catalog.js';
import { json, parsePagination, validateBody, validateUUID } from './middleware.js';

const VALID_STATUSES = new Set(['planned', 'queued', 'dispatching', 'completed', 'failed', 'cancelled']);
const VALID_PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);
const MAX_TEXT_LENGTHS = {
  requester: 120,
  requester_role: 64,
  domain: 64,
  topic: 240,
  objective: 4000,
};
const MAX_LIST_ITEMS = 25;
const MAX_LIST_ITEM_LENGTH = 160;

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeRequestBody(body) {
  return {
    requester: String(body.requester || '').trim(),
    requesterRole: String(body.requester_role || '').trim().toLowerCase(),
    domain: String(body.domain || '').trim().toLowerCase(),
    topic: String(body.topic || '').trim(),
    objective: String(body.objective || '').trim(),
    priority: body.priority ? String(body.priority).trim().toLowerCase() : undefined,
    researchQuestions: normalizeList(body.research_questions),
    preferredSources: normalizeList(body.preferred_sources),
    artifactTypes: normalizeList(body.artifact_types),
    categories: normalizeList(body.categories),
    constraints: normalizeObject(body.constraints),
    metadata: normalizeObject(body.metadata),
    autoDispatch: body.auto_dispatch === true,
  };
}

function validateTextField(body, field, errors) {
  const value = body[field];
  if (value === undefined || value === null) return;
  if (typeof value !== 'string') {
    errors.push(`${field} must be a string`);
    return;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    errors.push(`${field} cannot be empty`);
    return;
  }
  if (trimmed.length > MAX_TEXT_LENGTHS[field]) {
    errors.push(`${field} must be at most ${MAX_TEXT_LENGTHS[field]} characters`);
  }
}

function validateStringArray(body, field, errors) {
  if (body[field] === undefined) return;
  if (!Array.isArray(body[field])) {
    errors.push(`${field} must be an array`);
    return;
  }
  if (body[field].length > MAX_LIST_ITEMS) {
    errors.push(`${field} must contain at most ${MAX_LIST_ITEMS} items`);
  }
  for (const item of body[field]) {
    if (typeof item !== 'string') {
      errors.push(`${field} must contain only strings`);
      return;
    }
    if (item.trim().length === 0) {
      errors.push(`${field} cannot contain empty strings`);
      return;
    }
    if (item.trim().length > MAX_LIST_ITEM_LENGTH) {
      errors.push(`${field} items must be at most ${MAX_LIST_ITEM_LENGTH} characters`);
      return;
    }
  }
}

function validateRequestPayload(body) {
  const base = validateBody(body, ['requester', 'requester_role', 'domain', 'topic', 'objective']);
  if (!base.valid) return base;

  const errors = [];
  for (const field of Object.keys(MAX_TEXT_LENGTHS)) {
    validateTextField(body, field, errors);
  }
  if (body.priority && !VALID_PRIORITIES.has(String(body.priority).trim().toLowerCase())) {
    errors.push(`priority must be one of: ${Array.from(VALID_PRIORITIES).join(', ')}`);
  }
  for (const field of ['research_questions', 'preferred_sources', 'artifact_types', 'categories']) {
    validateStringArray(body, field, errors);
  }
  if (body.constraints !== undefined && (!body.constraints || typeof body.constraints !== 'object' || Array.isArray(body.constraints))) {
    errors.push('constraints must be a JSON object');
  }
  if (body.metadata !== undefined && (!body.metadata || typeof body.metadata !== 'object' || Array.isArray(body.metadata))) {
    errors.push('metadata must be a JSON object');
  }
  if (body.auto_dispatch !== undefined && typeof body.auto_dispatch !== 'boolean') {
    errors.push('auto_dispatch must be a boolean');
  }

  return { valid: errors.length === 0, errors };
}

function parseFilters(params) {
  const pagination = parsePagination(params);
  return {
    ...pagination,
    status: params.get('status') || undefined,
    requesterRole: params.get('requester_role') || undefined,
    domain: params.get('domain') || undefined,
  };
}

function validateFilters(filters) {
  const errors = [];
  if (filters.status && !VALID_STATUSES.has(String(filters.status).trim().toLowerCase())) {
    errors.push(`status must be one of: ${Array.from(VALID_STATUSES).join(', ')}`);
  }
  return errors;
}

function buildInitialRequestStatus({ autoDispatch, selectedSources }) {
  return autoDispatch && selectedSources.length > 0 ? 'queued' : 'planned';
}

function buildInitialResultSummary(dispatch) {
  return {
    runs: dispatch.runs,
    dispatched_sources: dispatch.sources,
    total_sources: dispatch.sources.length,
    completed_sources: 0,
    failed_sources: 0,
    source_results: [],
  };
}

function buildTerminalDispatchState(summary) {
  const failedSources = summary.failed_sources || 0;
  const totalSources = summary.total_sources || 0;
  return {
    status: failedSources > 0 ? 'failed' : 'completed',
    completedAt: 'now',
    errorMessage: failedSources > 0
      ? `${failedSources} of ${totalSources} dispatched sources failed`
      : null,
  };
}

async function mergeResultSummary(database, requestId, patch) {
  const existing = await getSourcingRequest(database, requestId);
  if (!existing) return null;

  const nextSummary = {
    ...existing.result_summary,
    ...patch,
  };

  return updateSourcingRequest(database, requestId, {
    resultSummary: nextSummary,
  });
}

export function createSourcingHandlers({
  database = db,
  dispatchHarvest = dispatchHarvestSources,
  buildQualification = buildSourcingQualification,
} = {}) {
  return {
    async handleListSourcingRequests(_req, res, params) {
      const filters = parseFilters(params);
      const errors = validateFilters(filters);
      if (errors.length > 0) {
        return json(res, 400, { error: 'Validation failed', errors });
      }

      try {
        const requests = await listSourcingRequests(database, filters);
        return json(res, 200, requests);
      } catch {
        return json(res, 500, { error: 'Failed to list sourcing requests' });
      }
    },

    async handleGetSourcingRequest(_req, res, _params, requestId) {
      if (!validateUUID(requestId)) {
        return json(res, 400, { error: 'Invalid sourcing request id' });
      }

      try {
        const request = await getSourcingRequest(database, requestId);
        if (!request) {
          return json(res, 404, { error: 'Sourcing request not found' });
        }
        return json(res, 200, request);
      } catch {
        return json(res, 500, { error: 'Failed to get sourcing request' });
      }
    },

    async handleCreateSourcingRequest(req, res) {
      let body;
      try {
        body = await readBody(req);
      } catch {
        return json(res, 400, { error: 'Invalid JSON body' });
      }

      const validation = validateRequestPayload(body);
      if (!validation.valid) {
        return json(res, 400, { error: 'Validation failed', errors: validation.errors });
      }

      const normalized = normalizeRequestBody(body);

      try {
        const qualification = await buildQualification(database, normalized);
        const selectedSources = qualification.recommended_sources || [];
        const request = await createSourcingRequest(database, {
          ...normalized,
          status: buildInitialRequestStatus({
            autoDispatch: normalized.autoDispatch,
            selectedSources,
          }),
          selectedSources,
          qualification,
          metadata: {
            ...normalized.metadata,
            source: body.source || 'api',
          },
        });

        if (normalized.autoDispatch && selectedSources.length > 0) {
          (async () => {
            try {
              await updateSourcingRequest(database, request.id, {
                status: 'dispatching',
                dispatchedAt: 'now',
                errorMessage: null,
              });

              const dispatch = await dispatchHarvest({
                sources: selectedSources,
                trigger: 'sourcing_request',
                sourcingRequestId: request.id,
                metadata: {
                  requester_role: request.requester_role,
                  domain: request.domain,
                  topic: request.topic,
                },
                onDispatchSettled: async (summary) => {
                  await mergeResultSummary(database, request.id, summary);
                  await updateSourcingRequest(database, request.id, buildTerminalDispatchState(summary));
                },
              });

              await updateSourcingRequest(database, request.id, {
                status: 'dispatching',
                dispatchedAt: 'now',
                resultSummary: buildInitialResultSummary(dispatch),
              });
            } catch (error) {
              await updateSourcingRequest(database, request.id, {
                status: 'failed',
                errorMessage: error.message,
              });
            }
          })();
        }

        return json(res, 201, request);
      } catch (error) {
        return json(res, 500, { error: 'Failed to create sourcing request', detail: error.message });
      }
    },

    async handleDispatchSourcingRequest(_req, res, _params, requestId) {
      if (!validateUUID(requestId)) {
        return json(res, 400, { error: 'Invalid sourcing request id' });
      }

      try {
        const request = await getSourcingRequest(database, requestId);
        if (!request) {
          return json(res, 404, { error: 'Sourcing request not found' });
        }
        if (request.status === 'dispatching' || request.status === 'queued') {
          return json(res, 409, { error: 'Sourcing request is already dispatching' });
        }
        if (request.status === 'completed' || request.status === 'cancelled') {
          return json(res, 409, { error: `Cannot dispatch a ${request.status} sourcing request` });
        }

        const selectedSources = request.selected_sources || request.qualification?.recommended_sources || [];
        if (selectedSources.length === 0) {
          return json(res, 409, { error: 'No supported sources available for dispatch' });
        }

        await updateSourcingRequest(database, requestId, {
          status: 'dispatching',
          dispatchedAt: 'now',
          errorMessage: null,
        });

        const dispatch = await dispatchHarvest({
          sources: selectedSources,
          trigger: 'sourcing_request',
          sourcingRequestId: requestId,
          metadata: {
            requester_role: request.requester_role,
            domain: request.domain,
            topic: request.topic,
          },
          onDispatchSettled: async (summary) => {
            await mergeResultSummary(database, requestId, summary);
            await updateSourcingRequest(database, requestId, buildTerminalDispatchState(summary));
          },
        });

        const updated = await updateSourcingRequest(database, requestId, {
          status: 'dispatching',
          resultSummary: buildInitialResultSummary(dispatch),
        });

        return json(res, 202, updated);
      } catch (error) {
        await updateSourcingRequest(database, requestId, {
          status: 'failed',
          errorMessage: error.message,
        }).catch(() => {});
        return json(res, 500, { error: 'Failed to dispatch sourcing request' });
      }
    },
  };
}

const handlers = createSourcingHandlers();

export const handleListSourcingRequests = handlers.handleListSourcingRequests;
export const handleGetSourcingRequest = handlers.handleGetSourcingRequest;
export const handleCreateSourcingRequest = handlers.handleCreateSourcingRequest;
export const handleDispatchSourcingRequest = handlers.handleDispatchSourcingRequest;
