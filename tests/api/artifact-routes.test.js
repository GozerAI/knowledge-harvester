// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for artifact route handler logic.
 *
 * No HTTP server or real DB required. The core logic is re-implemented
 * as pure functions mirroring the route handlers, following the same
 * pattern used throughout this test suite (see tests/db/artifact-store.test.js).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// ── Re-implemented middleware logic ──────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUUID(id) {
  if (typeof id !== 'string') return false;
  return UUID_REGEX.test(id);
}

function validateBody(body, requiredFields) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: ['Request body must be a JSON object'] };
  }
  for (const field of requiredFields) {
    if (body[field] === undefined || body[field] === null || body[field] === '') {
      errors.push(`Missing required field: ${field}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

function parsePagination(params) {
  const rawLimit = parseInt(params.get('limit') || '20', 10);
  const rawOffset = parseInt(params.get('offset') || '0', 10);
  const limit = Math.min(isNaN(rawLimit) || rawLimit < 1 ? 20 : rawLimit, 100);
  const offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;
  return { limit, offset };
}

function parseFilters(params, allowedFields) {
  const filters = {};
  for (const field of allowedFields) {
    const value = params.get(field);
    if (value !== null && value !== '') filters[field] = value;
  }
  return filters;
}

// ── Re-implemented query builder (mirrors handleListArtifacts) ───────────────

function buildListQuery(params) {
  const { limit, offset } = parsePagination(params);
  const filters = parseFilters(params, ['artifact_type', 'primary_category', 'tool_type', 'language', 'publishing_status']);

  const conditions = [];
  const values = [];
  let idx = 1;

  for (const [field, value] of Object.entries(filters)) {
    conditions.push(`${field} = $${idx}`);
    values.push(value);
    idx++;
  }

  const qualityMin = parseInt(params.get('quality_min') || '0', 10);
  if (!isNaN(qualityMin) && qualityMin > 0) {
    conditions.push(`quality_score >= $${idx}`);
    values.push(qualityMin);
    idx++;
  }

  const tagsParam = params.get('tags');
  if (tagsParam) {
    const tagList = tagsParam.split(',').map(t => t.trim()).filter(Boolean);
    if (tagList.length > 0) {
      conditions.push(`tags && $${idx}`);
      values.push(tagList);
      idx++;
    }
  }

  const q = params.get('search') || params.get('q') || '';
  if (q) {
    conditions.push(`search_vector @@ plainto_tsquery('english', $${idx})`);
    values.push(q);
    idx++;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { limit, offset, conditions, values, where };
}

// ── Re-implemented UPDATABLE_FIELDS set ─────────────────────────────────────

const UPDATABLE_FIELDS = new Set([
  'name', 'description', 'artifact_type', 'source', 'source_url',
  'language', 'tool_type', 'tool_metadata', 'tags', 'type_metadata',
  'primary_category', 'secondary_categories', 'quality_score',
  'complexity_score', 'has_description', 'has_documentation',
  'is_complete', 'validation_status', 'publishing_status',
  'marketplace_metadata', 'content',
]);

function buildUpdateClauses(body) {
  const setClauses = [];
  const values = [];
  let idx = 1;

  for (const [key, value] of Object.entries(body)) {
    if (!UPDATABLE_FIELDS.has(key)) continue;
    if (['tool_metadata', 'type_metadata', 'marketplace_metadata', 'content'].includes(key)) {
      setClauses.push(`${key} = $${idx}`);
      values.push(JSON.stringify(value));
    } else {
      setClauses.push(`${key} = $${idx}`);
      values.push(value);
    }
    idx++;
  }

  return { setClauses, values };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeParams(obj = {}) {
  return new URLSearchParams(obj);
}

function makeArtifactBody(overrides = {}) {
  return {
    artifact_type: 'workflow',
    name: 'Test Artifact',
    content: { nodes: [] },
    ...overrides,
  };
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('Artifact Routes', () => {

  describe('List — pagination', () => {
    it('defaults limit to 20 and offset to 0', () => {
      const { limit, offset } = parsePagination(makeParams());
      assert.equal(limit, 20);
      assert.equal(offset, 0);
    });

    it('respects provided limit and offset', () => {
      const { limit, offset } = parsePagination(makeParams({ limit: '50', offset: '10' }));
      assert.equal(limit, 50);
      assert.equal(offset, 10);
    });

    it('clamps limit to 100 maximum', () => {
      const { limit } = parsePagination(makeParams({ limit: '999' }));
      assert.equal(limit, 100);
    });

    it('clamps limit of exactly 100', () => {
      const { limit } = parsePagination(makeParams({ limit: '100' }));
      assert.equal(limit, 100);
    });

    it('treats invalid limit as default 20', () => {
      const { limit } = parsePagination(makeParams({ limit: 'abc' }));
      assert.equal(limit, 20);
    });

    it('treats negative offset as 0', () => {
      const { offset } = parsePagination(makeParams({ offset: '-5' }));
      assert.equal(offset, 0);
    });
  });

  describe('List — filter building', () => {
    it('builds artifact_type filter', () => {
      const { conditions, values } = buildListQuery(makeParams({ artifact_type: 'workflow' }));
      assert.ok(conditions.some(c => c.includes('artifact_type')));
      assert.ok(values.includes('workflow'));
    });

    it('builds primary_category filter', () => {
      const { conditions, values } = buildListQuery(makeParams({ primary_category: 'data-engineering' }));
      assert.ok(conditions.some(c => c.includes('primary_category')));
      assert.ok(values.includes('data-engineering'));
    });

    it('builds quality_min filter', () => {
      const { conditions, values } = buildListQuery(makeParams({ quality_min: '70' }));
      assert.ok(conditions.some(c => c.includes('quality_score')));
      assert.ok(values.includes(70));
    });

    it('ignores quality_min of 0', () => {
      const { conditions } = buildListQuery(makeParams({ quality_min: '0' }));
      assert.ok(!conditions.some(c => c.includes('quality_score')));
    });

    it('builds tags overlap filter', () => {
      const { conditions, values } = buildListQuery(makeParams({ tags: 'terraform,aws' }));
      assert.ok(conditions.some(c => c.includes('tags &&')));
      assert.deepEqual(values[values.length - 1], ['terraform', 'aws']);
    });

    it('strips empty where clause when no filters', () => {
      const { where } = buildListQuery(makeParams());
      assert.equal(where, '');
    });

    it('combines multiple filters with AND', () => {
      const { where } = buildListQuery(makeParams({ artifact_type: 'workflow', quality_min: '50' }));
      assert.ok(where.includes('AND'));
    });
  });

  describe('List — search query building', () => {
    it('builds plainto_tsquery clause for search param', () => {
      const { conditions, values } = buildListQuery(makeParams({ search: 'kubernetes deploy' }));
      assert.ok(conditions.some(c => c.includes('plainto_tsquery')));
      assert.ok(values.includes('kubernetes deploy'));
    });

    it('builds plainto_tsquery clause for q param', () => {
      const { conditions, values } = buildListQuery(makeParams({ q: 'n8n webhook' }));
      assert.ok(conditions.some(c => c.includes('plainto_tsquery')));
      assert.ok(values.includes('n8n webhook'));
    });

    it('handles special characters in search without error', () => {
      // Special chars are passed through — PG handles escaping
      const { conditions, values } = buildListQuery(makeParams({ search: "O'Reilly & AWS" }));
      assert.ok(conditions.some(c => c.includes('plainto_tsquery')));
      assert.ok(values.includes("O'Reilly & AWS"));
    });
  });

  describe('Get — UUID validation', () => {
    it('accepts a valid UUID', () => {
      assert.equal(validateUUID(randomUUID()), true);
    });

    it('rejects a non-UUID string', () => {
      assert.equal(validateUUID('not-a-uuid'), false);
    });

    it('rejects empty string', () => {
      assert.equal(validateUUID(''), false);
    });

    it('rejects null', () => {
      assert.equal(validateUUID(null), false);
    });

    it('rejects UUID with wrong segment lengths', () => {
      assert.equal(validateUUID('00000000-0000-0000-0000-0000000000'), false);
    });

    it('accepts uppercase UUID', () => {
      assert.equal(validateUUID('550E8400-E29B-41D4-A716-446655440000'), true);
    });
  });

  describe('Create — required field validation', () => {
    it('passes when all required fields present', () => {
      const { valid } = validateBody(makeArtifactBody(), ['artifact_type', 'name', 'content']);
      assert.equal(valid, true);
    });

    it('fails when name is missing', () => {
      const { valid, errors } = validateBody(
        makeArtifactBody({ name: undefined }),
        ['artifact_type', 'name', 'content']
      );
      assert.equal(valid, false);
      assert.ok(errors.some(e => e.includes('name')));
    });

    it('fails when artifact_type is missing', () => {
      const { valid, errors } = validateBody(
        makeArtifactBody({ artifact_type: undefined }),
        ['artifact_type', 'name', 'content']
      );
      assert.equal(valid, false);
      assert.ok(errors.some(e => e.includes('artifact_type')));
    });

    it('fails when content is missing', () => {
      const { valid, errors } = validateBody(
        makeArtifactBody({ content: undefined }),
        ['artifact_type', 'name', 'content']
      );
      assert.equal(valid, false);
      assert.ok(errors.some(e => e.includes('content')));
    });

    it('fails for empty string values', () => {
      const { valid, errors } = validateBody(
        makeArtifactBody({ name: '' }),
        ['artifact_type', 'name', 'content']
      );
      assert.equal(valid, false);
      assert.ok(errors.some(e => e.includes('name')));
    });

    it('returns all missing field errors at once', () => {
      const { valid, errors } = validateBody(
        {},
        ['artifact_type', 'name', 'content']
      );
      assert.equal(valid, false);
      assert.equal(errors.length, 3);
    });

    it('rejects non-object body', () => {
      const { valid } = validateBody(null, ['artifact_type', 'name', 'content']);
      assert.equal(valid, false);
    });

    it('rejects array body', () => {
      const { valid } = validateBody([], ['artifact_type', 'name', 'content']);
      assert.equal(valid, false);
    });

    it('ignores extra fields (no errors for them)', () => {
      const body = makeArtifactBody({ extra_field: 'ignored', another: 123 });
      const { valid } = validateBody(body, ['artifact_type', 'name', 'content']);
      assert.equal(valid, true);
    });
  });

  describe('Update — field filtering', () => {
    it('includes only updatable fields in SET clauses', () => {
      const body = { name: 'New Name', id: 'should-be-ignored', hash: 'also-ignored' };
      const { setClauses } = buildUpdateClauses(body);
      assert.ok(setClauses.some(c => c.startsWith('name')));
      assert.ok(!setClauses.some(c => c.startsWith('id')));
      assert.ok(!setClauses.some(c => c.startsWith('hash')));
    });

    it('allows partial update (only provided fields)', () => {
      const body = { quality_score: 85 };
      const { setClauses, values } = buildUpdateClauses(body);
      assert.equal(setClauses.length, 1);
      assert.ok(values.includes(85));
    });

    it('serializes JSONB fields to strings', () => {
      const body = { tool_metadata: { version: '2.0' } };
      const { values } = buildUpdateClauses(body);
      assert.equal(values[0], JSON.stringify({ version: '2.0' }));
    });

    it('returns empty setClauses for all non-updatable fields', () => {
      const body = { id: '123', hash: 'abc', source_id: 'x' };
      const { setClauses } = buildUpdateClauses(body);
      assert.equal(setClauses.length, 0);
    });

    it('handles tags array field', () => {
      const body = { tags: ['aws', 'k8s'] };
      const { setClauses, values } = buildUpdateClauses(body);
      assert.ok(setClauses.some(c => c.startsWith('tags')));
      assert.deepEqual(values[0], ['aws', 'k8s']);
    });
  });
});
