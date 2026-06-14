// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for contributor-routes.js logic.
 *
 * Since contributor-routes.js imports db/client.js (which requires PG env vars),
 * we follow the established project pattern of reimplementing pure functions
 * locally for unit testing — identical logic, no DB dependency.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Reimplemented from contributor-routes.js ─────────────────────────────────

function buildContributorProfile(stats, recentArtifacts) {
  return {
    author_username: stats.author_username,
    artifact_count: parseInt(stats.artifact_count, 10),
    avg_quality: stats.avg_quality !== null && stats.avg_quality !== undefined
      ? parseFloat(Number(stats.avg_quality).toFixed(2))
      : null,
    expertise: Array.isArray(stats.expertise)
      ? stats.expertise.filter(Boolean)
      : [],
    last_contribution: stats.last_contribution || null,
    recent_artifacts: recentArtifacts.map(a => ({
      id: a.id,
      name: a.name,
      artifact_type: a.artifact_type,
      primary_category: a.primary_category,
      quality_score: a.quality_score,
      discovered_at: a.discovered_at,
    })),
  };
}

function parseContributorSort(params) {
  const ALLOWED_FIELDS = ['artifact_count', 'avg_quality'];
  const ALLOWED_DIRECTIONS = ['asc', 'desc'];

  const rawField = (params.get('sort_by') || '').toLowerCase();
  const rawDir = (params.get('order') || '').toLowerCase();

  const field = ALLOWED_FIELDS.includes(rawField) ? rawField : 'artifact_count';
  const direction = ALLOWED_DIRECTIONS.includes(rawDir) ? rawDir : 'desc';

  return { field, direction };
}

// ── parseContributorSort ──────────────────────────────────────────────────────

describe('parseContributorSort', () => {
  function makeParams(obj) {
    return new URLSearchParams(obj);
  }

  it('returns default field and direction when no params given', () => {
    const result = parseContributorSort(makeParams({}));
    assert.equal(result.field, 'artifact_count');
    assert.equal(result.direction, 'desc');
  });

  it('parses sort_by=artifact_count', () => {
    const result = parseContributorSort(makeParams({ sort_by: 'artifact_count' }));
    assert.equal(result.field, 'artifact_count');
  });

  it('parses sort_by=avg_quality', () => {
    const result = parseContributorSort(makeParams({ sort_by: 'avg_quality' }));
    assert.equal(result.field, 'avg_quality');
  });

  it('falls back to artifact_count for an invalid sort field', () => {
    const result = parseContributorSort(makeParams({ sort_by: 'malicious_field; DROP TABLE users--' }));
    assert.equal(result.field, 'artifact_count');
  });

  it('parses order=asc', () => {
    const result = parseContributorSort(makeParams({ order: 'asc' }));
    assert.equal(result.direction, 'asc');
  });

  it('parses order=desc', () => {
    const result = parseContributorSort(makeParams({ order: 'desc' }));
    assert.equal(result.direction, 'desc');
  });

  it('falls back to desc for an invalid direction', () => {
    const result = parseContributorSort(makeParams({ order: 'sideways' }));
    assert.equal(result.direction, 'desc');
  });

  it('is case-insensitive for field and direction', () => {
    const result = parseContributorSort(makeParams({ sort_by: 'AVG_QUALITY', order: 'ASC' }));
    assert.equal(result.field, 'avg_quality');
    assert.equal(result.direction, 'asc');
  });
});

// ── buildContributorProfile ───────────────────────────────────────────────────

describe('buildContributorProfile', () => {
  function makeStats(overrides = {}) {
    return {
      author_username: 'alice',
      artifact_count: 42,
      avg_quality: 78.5,
      expertise: ['n8n', 'data-processing', 'ai-agent'],
      last_contribution: '2026-03-01T12:00:00Z',
      ...overrides,
    };
  }

  function makeArtifact(overrides = {}) {
    return {
      id: 'uuid-001',
      name: 'Test Workflow',
      artifact_type: 'workflow',
      primary_category: 'data-processing',
      quality_score: 80,
      discovered_at: '2026-03-01T10:00:00Z',
      ...overrides,
    };
  }

  it('builds a profile with correct top-level fields', () => {
    const profile = buildContributorProfile(makeStats(), []);
    assert.equal(profile.author_username, 'alice');
    assert.equal(profile.artifact_count, 42);
    assert.equal(profile.avg_quality, 78.5);
    assert.deepEqual(profile.expertise, ['n8n', 'data-processing', 'ai-agent']);
    assert.equal(profile.last_contribution, '2026-03-01T12:00:00Z');
  });

  it('includes recent_artifacts in the profile', () => {
    const profile = buildContributorProfile(makeStats(), [makeArtifact()]);
    assert.equal(profile.recent_artifacts.length, 1);
    assert.equal(profile.recent_artifacts[0].name, 'Test Workflow');
  });

  it('maps artifact fields to summary shape (no workflow_json, no tool_metadata)', () => {
    const full = makeArtifact({ workflow_json: '{"big":"object"}', tool_metadata: '{...}' });
    const profile = buildContributorProfile(makeStats(), [full]);
    const a = profile.recent_artifacts[0];
    assert.ok(!('workflow_json' in a));
    assert.ok(!('tool_metadata' in a));
    assert.ok('id' in a);
    assert.ok('name' in a);
    assert.ok('artifact_type' in a);
    assert.ok('primary_category' in a);
    assert.ok('quality_score' in a);
    assert.ok('discovered_at' in a);
  });

  it('returns empty recent_artifacts when none provided', () => {
    const profile = buildContributorProfile(makeStats(), []);
    assert.deepEqual(profile.recent_artifacts, []);
  });

  it('returns null avg_quality when stats has null avg_quality', () => {
    const profile = buildContributorProfile(makeStats({ avg_quality: null }), []);
    assert.equal(profile.avg_quality, null);
  });

  it('returns null avg_quality when stats has undefined avg_quality', () => {
    const profile = buildContributorProfile(makeStats({ avg_quality: undefined }), []);
    assert.equal(profile.avg_quality, null);
  });

  it('returns empty expertise array when expertise is null', () => {
    const profile = buildContributorProfile(makeStats({ expertise: null }), []);
    assert.deepEqual(profile.expertise, []);
  });

  it('filters null/empty values from expertise array', () => {
    const profile = buildContributorProfile(makeStats({ expertise: ['n8n', null, '', 'ai-agent'] }), []);
    assert.deepEqual(profile.expertise, ['n8n', 'ai-agent']);
  });

  it('parses artifact_count as integer even when stored as string', () => {
    const profile = buildContributorProfile(makeStats({ artifact_count: '15' }), []);
    assert.equal(typeof profile.artifact_count, 'number');
    assert.equal(profile.artifact_count, 15);
  });

  it('rounds avg_quality to 2 decimal places', () => {
    const profile = buildContributorProfile(makeStats({ avg_quality: 78.555 }), []);
    assert.equal(profile.avg_quality, 78.56);
  });
});

// ── Pagination logic ──────────────────────────────────────────────────────────

describe('contributor list pagination', () => {
  function paginateContributors(total, limit, offset) {
    const clampedLimit = Math.min(Math.max(1, limit), 100);
    const clampedOffset = Math.max(0, offset);
    const hasMore = clampedOffset + clampedLimit < total;
    return { total, limit: clampedLimit, offset: clampedOffset, hasMore };
  }

  it('returns hasMore true when items remain after current page', () => {
    const { hasMore } = paginateContributors(100, 20, 0);
    assert.equal(hasMore, true);
  });

  it('returns hasMore false on last page', () => {
    const { hasMore } = paginateContributors(20, 20, 0);
    assert.equal(hasMore, false);
  });

  it('handles offset beyond total gracefully', () => {
    const { hasMore } = paginateContributors(5, 20, 50);
    assert.equal(hasMore, false);
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('contributor edge cases', () => {
  it('buildContributorProfile with zero artifact_count', () => {
    const stats = {
      author_username: 'ghost',
      artifact_count: 0,
      avg_quality: null,
      expertise: [],
      last_contribution: null,
    };
    const profile = buildContributorProfile(stats, []);
    assert.equal(profile.artifact_count, 0);
    assert.equal(profile.avg_quality, null);
    assert.equal(profile.last_contribution, null);
    assert.deepEqual(profile.recent_artifacts, []);
  });

  it('buildContributorProfile handles multiple recent artifacts', () => {
    const stats = {
      author_username: 'bob',
      artifact_count: 3,
      avg_quality: 70,
      expertise: ['github'],
      last_contribution: '2026-03-10T00:00:00Z',
    };
    const artifacts = [
      { id: 'a1', name: 'W1', artifact_type: 'workflow', primary_category: 'ai-agent', quality_score: 65, discovered_at: '2026-03-09T00:00:00Z' },
      { id: 'a2', name: 'W2', artifact_type: 'workflow', primary_category: 'data-processing', quality_score: 75, discovered_at: '2026-03-08T00:00:00Z' },
    ];
    const profile = buildContributorProfile(stats, artifacts);
    assert.equal(profile.recent_artifacts.length, 2);
    assert.equal(profile.recent_artifacts[0].id, 'a1');
  });
});
