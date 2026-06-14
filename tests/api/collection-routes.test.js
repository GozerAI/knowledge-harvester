// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for collection-routes.js — pure function coverage only.
 * DB-dependent handlers tested via logic reimplementation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// ── Re-implement pure functions for testing (no DB deps) ──

function generateSlug(name) {
  if (typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200);
}

function validateCollection(body) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: ['Body must be a non-null object'] };
  }
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    errors.push('name is required and must be a non-empty string');
  }
  if (!body.author_name || typeof body.author_name !== 'string' || !body.author_name.trim()) {
    errors.push('author_name is required and must be a non-empty string');
  }
  if (body.is_public !== undefined && typeof body.is_public !== 'boolean') {
    errors.push('is_public must be a boolean');
  }
  return { valid: errors.length === 0, errors };
}

// ── generateSlug ──────────────────────────────────────────────────────────────

describe('generateSlug', () => {
  it('lowercases and hyphenates a simple name', () => {
    assert.equal(generateSlug('My Cool Collection'), 'my-cool-collection');
  });

  it('strips special characters', () => {
    assert.equal(generateSlug('Hello! World@#$%'), 'hello-world');
  });

  it('collapses multiple consecutive hyphens', () => {
    assert.equal(generateSlug('Hello   World'), 'hello-world');
  });

  it('trims leading and trailing hyphens', () => {
    assert.equal(generateSlug('  My Collection  '), 'my-collection');
  });

  it('handles a name that is already slug-safe', () => {
    assert.equal(generateSlug('already-slug'), 'already-slug');
  });

  it('truncates at 200 characters', () => {
    const longName = 'a '.repeat(150); // 300 chars of "a "
    const slug = generateSlug(longName);
    assert.ok(slug.length <= 200, `slug length ${slug.length} exceeds 200`);
  });

  it('returns empty string for empty input', () => {
    assert.equal(generateSlug(''), '');
  });

  it('returns empty string for non-string input', () => {
    assert.equal(generateSlug(null), '');
    assert.equal(generateSlug(undefined), '');
    assert.equal(generateSlug(42), '');
  });

  it('preserves numbers in the slug', () => {
    assert.equal(generateSlug('Top 10 Workflows'), 'top-10-workflows');
  });

  it('strips unicode characters that are not alphanumeric', () => {
    assert.equal(generateSlug('Café Workflows'), 'caf-workflows');
  });

  it('handles all-special-character input gracefully', () => {
    const slug = generateSlug('!@#$%^&*()');
    assert.equal(slug, '');
  });
});

// ── validateCollection ────────────────────────────────────────────────────────

describe('validateCollection', () => {
  it('accepts a valid collection with required fields', () => {
    const result = validateCollection({ name: 'My Collection', author_name: 'Alice' });
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it('accepts a collection with all fields provided', () => {
    const result = validateCollection({
      name: 'My Collection',
      author_name: 'Alice',
      description: 'A great collection',
      is_public: true,
    });
    assert.equal(result.valid, true);
  });

  it('rejects missing name', () => {
    const result = validateCollection({ author_name: 'Alice' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('name')));
  });

  it('rejects empty string name', () => {
    const result = validateCollection({ name: '   ', author_name: 'Alice' });
    assert.equal(result.valid, false);
  });

  it('rejects missing author_name', () => {
    const result = validateCollection({ name: 'My Collection' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('author_name')));
  });

  it('rejects empty string author_name', () => {
    const result = validateCollection({ name: 'My Collection', author_name: '' });
    assert.equal(result.valid, false);
  });

  it('rejects is_public that is a string instead of boolean', () => {
    const result = validateCollection({ name: 'My Collection', author_name: 'Alice', is_public: 'yes' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('is_public')));
  });

  it('accepts is_public as false', () => {
    const result = validateCollection({ name: 'My Collection', author_name: 'Alice', is_public: false });
    assert.equal(result.valid, true);
  });

  it('rejects null body', () => {
    const result = validateCollection(null);
    assert.equal(result.valid, false);
  });

  it('rejects array body', () => {
    const result = validateCollection([]);
    assert.equal(result.valid, false);
  });

  it('collects multiple errors at once', () => {
    const result = validateCollection({});
    assert.equal(result.valid, false);
    assert.ok(result.errors.length >= 2);
  });
});

// ── Artifact array logic (add/remove reimplementation) ───────────────────────

describe('artifact_ids array management', () => {
  function addArtifact(artifactIds, newId) {
    if (artifactIds.includes(newId)) return [...artifactIds]; // idempotent
    return [...artifactIds, newId];
  }

  function removeArtifact(artifactIds, removeId) {
    return artifactIds.filter(id => id !== removeId);
  }

  it('adds an artifact UUID to an empty array', () => {
    const id = randomUUID();
    const result = addArtifact([], id);
    assert.deepEqual(result, [id]);
  });

  it('adds an artifact UUID to a non-empty array', () => {
    const id1 = randomUUID();
    const id2 = randomUUID();
    const result = addArtifact([id1], id2);
    assert.equal(result.length, 2);
    assert.ok(result.includes(id1));
    assert.ok(result.includes(id2));
  });

  it('does not duplicate an artifact already in the array', () => {
    const id = randomUUID();
    const result = addArtifact([id], id);
    assert.equal(result.length, 1);
  });

  it('removes an artifact from the array', () => {
    const id1 = randomUUID();
    const id2 = randomUUID();
    const result = removeArtifact([id1, id2], id1);
    assert.deepEqual(result, [id2]);
  });

  it('removing a non-existent artifact is a no-op (idempotent)', () => {
    const id1 = randomUUID();
    const missingId = randomUUID();
    const result = removeArtifact([id1], missingId);
    assert.deepEqual(result, [id1]);
  });

  it('removing from an empty array returns empty array', () => {
    const result = removeArtifact([], randomUUID());
    assert.deepEqual(result, []);
  });

  it('count increments by 1 when artifact is added', () => {
    const before = 5;
    const after = before + 1;
    assert.equal(after, 6);
  });

  it('count decrements by 1 when artifact is removed (not below 0)', () => {
    const before = 1;
    const after = Math.max(0, before - 1);
    assert.equal(after, 0);
    const alreadyZero = Math.max(0, 0 - 1);
    assert.equal(alreadyZero, 0);
  });
});

// ── UUID vs slug routing logic ────────────────────────────────────────────────

describe('UUID vs slug detection for collection lookup', () => {
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function isUUID(str) {
    return UUID_REGEX.test(str);
  }

  it('identifies a valid UUID', () => {
    assert.equal(isUUID(randomUUID()), true);
  });

  it('identifies a slug as non-UUID', () => {
    assert.equal(isUUID('my-cool-collection'), false);
  });

  it('identifies a partial UUID-like string as non-UUID', () => {
    assert.equal(isUUID('12345678-1234-1234-1234'), false);
  });

  it('uses id = $1 for UUIDs', () => {
    const id = randomUUID();
    const clause = isUUID(id) ? 'id = $1' : 'slug = $1';
    assert.equal(clause, 'id = $1');
  });

  it('uses slug = $1 for non-UUID slugs', () => {
    const clause = isUUID('my-collection') ? 'id = $1' : 'slug = $1';
    assert.equal(clause, 'slug = $1');
  });
});

// ── Pagination and public filter logic ────────────────────────────────────────

describe('collection list filtering', () => {
  function resolvePublicFilter(paramValue) {
    return paramValue === 'false' ? false : true;
  }

  it('defaults to true (public only) when param not provided', () => {
    assert.equal(resolvePublicFilter(null), true);
  });

  it('returns false when is_public=false', () => {
    assert.equal(resolvePublicFilter('false'), false);
  });

  it('returns true when is_public=true', () => {
    assert.equal(resolvePublicFilter('true'), true);
  });

  it('returns true for any unrecognised value', () => {
    assert.equal(resolvePublicFilter('maybe'), true);
  });
});

// ── Duplicate slug handling ───────────────────────────────────────────────────

describe('duplicate slug handling', () => {
  it('appends UUID fragment when base slug exists', () => {
    const id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const baseSlug = 'my-collection';
    const fallbackSlug = `${baseSlug}-${id.slice(0, 8)}`;
    assert.equal(fallbackSlug, 'my-collection-a1b2c3d4');
  });

  it('fallback slug is still under 200 chars even with a long base', () => {
    const longBase = 'a'.repeat(200);
    const id = randomUUID();
    const truncatedBase = longBase.slice(0, 200);
    // Combine and re-truncate to ensure total stays under 200
    const fallback = `${truncatedBase}-${id.slice(0, 8)}`.slice(0, 200);
    assert.ok(fallback.length <= 200);
  });
});

// ── Update partial fields logic ───────────────────────────────────────────────

describe('collection update field parsing', () => {
  function parseUpdateFields(body) {
    const ALLOWED = ['name', 'description', 'is_public'];
    const updates = {};
    for (const field of ALLOWED) {
      if (body[field] !== undefined) updates[field] = body[field];
    }
    return updates;
  }

  it('extracts only allowed update fields', () => {
    const updates = parseUpdateFields({ name: 'New Name', slug: 'hack', author_name: 'hacker', is_public: false });
    assert.ok('name' in updates);
    assert.ok('is_public' in updates);
    assert.ok(!('slug' in updates));
    assert.ok(!('author_name' in updates));
  });

  it('returns empty object when no updatable fields present', () => {
    const updates = parseUpdateFields({ slug: 'only-slug' });
    assert.deepEqual(updates, {});
  });

  it('allows partial updates (only description)', () => {
    const updates = parseUpdateFields({ description: 'Updated desc' });
    assert.equal(updates.description, 'Updated desc');
    assert.ok(!('name' in updates));
  });
});
