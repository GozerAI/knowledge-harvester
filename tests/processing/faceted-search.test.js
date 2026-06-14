// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Reimplemented from faceted-search.js — WHERE clause builder

function buildWhereClause(filters) {
  if (!filters || typeof filters !== 'object') return { where: '', params: [] };

  const conditions = [];
  const params = [];

  if (filters.tool_type) {
    conditions.push('tool_type = ?');
    params.push(filters.tool_type);
  }
  if (filters.primary_category) {
    conditions.push('primary_category = ?');
    params.push(filters.primary_category);
  }
  if (filters.language) {
    conditions.push('language = ?');
    params.push(filters.language);
  }
  if (filters.trigger_type) {
    conditions.push('trigger_type = ?');
    params.push(filters.trigger_type);
  }
  if (filters.min_quality != null) {
    conditions.push('quality_score >= ?');
    params.push(filters.min_quality);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, params };
}

function buildSearchQuery(filters, opts = {}) {
  const { limit = 50 } = opts;
  const { where, params } = buildWhereClause(filters);
  const sql = `SELECT * FROM workflows ${where} ORDER BY quality_score DESC LIMIT ?`;
  return { sql, params: [...params, limit] };
}


describe('buildWhereClause — single filter', () => {
  it('builds correct WHERE for tool_type filter', () => {
    const { where, params } = buildWhereClause({ tool_type: 'tekton' });
    assert.equal(where, 'WHERE tool_type = ?');
    assert.deepEqual(params, ['tekton']);
  });
});


describe('buildWhereClause — multiple filters', () => {
  it('builds correct WHERE for multiple filters', () => {
    const { where, params } = buildWhereClause({ tool_type: 'dbt', primary_category: 'data-pipeline', min_quality: 40 });
    assert.ok(where.includes('tool_type = ?'));
    assert.ok(where.includes('primary_category = ?'));
    assert.ok(where.includes('quality_score >= ?'));
    assert.ok(where.includes('AND'));
    assert.equal(params.length, 3);
  });
});


describe('buildWhereClause — no filters', () => {
  it('returns empty WHERE when no filters provided', () => {
    const { where, params } = buildWhereClause({});
    assert.equal(where, '');
    assert.deepEqual(params, []);
  });
});


describe('buildSearchQuery — limit', () => {
  it('respects limit parameter', () => {
    const { sql, params } = buildSearchQuery({ tool_type: 'camunda' }, { limit: 10 });
    assert.ok(sql.includes('LIMIT ?'));
    assert.equal(params[params.length - 1], 10);
  });

  it('uses default limit of 50', () => {
    const { params } = buildSearchQuery({});
    assert.equal(params[params.length - 1], 50);
  });
});


describe('buildWhereClause — null/undefined filters', () => {
  it('returns empty for null filters', () => {
    const { where, params } = buildWhereClause(null);
    assert.equal(where, '');
    assert.deepEqual(params, []);
  });

  it('returns empty for undefined filters', () => {
    const { where, params } = buildWhereClause(undefined);
    assert.equal(where, '');
    assert.deepEqual(params, []);
  });
});
