// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for fork-routes.js logic.
 *
 * Since fork-routes.js imports db/client.js (which requires PG env vars),
 * we follow the established project pattern of reimplementing pure functions
 * locally for unit testing — identical logic, no DB dependency.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// ── Reimplemented from fork-routes.js ────────────────────────────────────────

function buildForkData(original, authorName, modifications) {
  const originalMeta = original.type_metadata
    ? (typeof original.type_metadata === 'string'
        ? JSON.parse(original.type_metadata)
        : original.type_metadata)
    : {};

  const type_metadata = {
    ...originalMeta,
    forked_from: original.id,
    fork_modifications: modifications || null,
  };

  return {
    id: randomUUID(),
    artifact_type: original.artifact_type,
    source: original.source,
    source_url: original.source_url || null,
    source_id: original.source_id || null,
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    content: original.content,
    name: original.name ? `Fork of ${original.name}` : 'Forked artifact',
    description: original.description || '',
    author_username: authorName,
    author_profile_url: null,
    language: original.language || null,
    tool_type: original.tool_type || null,
    tool_metadata: original.tool_metadata
      ? (typeof original.tool_metadata === 'string' ? original.tool_metadata : JSON.stringify(original.tool_metadata))
      : '{}',
    tags: original.tags || [],
    type_metadata: JSON.stringify(type_metadata),
    primary_category: original.primary_category || null,
    secondary_categories: original.secondary_categories || '{}',
    quality_score: original.quality_score || 0,
    complexity_score: original.complexity_score || 0,
    has_description: Boolean(original.description),
    has_documentation: original.has_documentation || false,
    is_complete: original.is_complete ?? true,
    validation_status: 'untested',
    processing_status: 'raw',
    marketplace_metadata: '{}',
  };
}

function isFork(artifact) {
  if (!artifact || !artifact.type_metadata) return false;
  try {
    const meta = typeof artifact.type_metadata === 'string'
      ? JSON.parse(artifact.type_metadata)
      : artifact.type_metadata;
    return Boolean(meta.forked_from);
  } catch {
    return false;
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeArtifact(overrides = {}) {
  return {
    id: randomUUID(),
    artifact_type: 'workflow',
    source: 'n8n-community',
    source_url: 'https://example.com/workflows/42',
    source_id: 'wf-42',
    content: { nodes: [{ id: 1, type: 'http' }], connections: {} },
    name: 'Email Automator',
    description: 'Automates emails',
    author_username: 'original_author',
    author_profile_url: 'https://example.com/original_author',
    language: null,
    tool_type: 'n8n',
    tool_metadata: JSON.stringify({ version: '1.0' }),
    tags: ['email', 'automation'],
    type_metadata: JSON.stringify({ some_key: 'some_value' }),
    primary_category: 'integration-pipeline',
    secondary_categories: '{}',
    quality_score: 75,
    complexity_score: 30,
    has_description: true,
    has_documentation: false,
    is_complete: true,
    validation_status: 'passing',
    ...overrides,
  };
}

// ── buildForkData ─────────────────────────────────────────────────────────────

describe('buildForkData', () => {
  it('generates a new UUID for the fork', () => {
    const original = makeArtifact();
    const fork = buildForkData(original, 'fork_author', null);
    assert.notEqual(fork.id, original.id);
    assert.match(fork.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('sets forked_from to the original artifact id', () => {
    const original = makeArtifact();
    const fork = buildForkData(original, 'fork_author', null);
    const meta = JSON.parse(fork.type_metadata);
    assert.equal(meta.forked_from, original.id);
  });

  it('copies content from the original', () => {
    const original = makeArtifact();
    const fork = buildForkData(original, 'fork_author', null);
    assert.deepEqual(fork.content, original.content);
  });

  it('sets author_username to the fork author, not the original', () => {
    const original = makeArtifact();
    const fork = buildForkData(original, 'new_person', null);
    assert.equal(fork.author_username, 'new_person');
    assert.notEqual(fork.author_username, original.author_username);
  });

  it('prefixes the name with "Fork of"', () => {
    const original = makeArtifact({ name: 'Email Automator' });
    const fork = buildForkData(original, 'fork_author', null);
    assert.equal(fork.name, 'Fork of Email Automator');
  });

  it('falls back to "Forked artifact" when original has no name', () => {
    const original = makeArtifact({ name: '' });
    const fork = buildForkData(original, 'fork_author', null);
    assert.equal(fork.name, 'Forked artifact');
  });

  it('stores modifications in type_metadata.fork_modifications', () => {
    const original = makeArtifact();
    const fork = buildForkData(original, 'fork_author', 'Added webhook trigger');
    const meta = JSON.parse(fork.type_metadata);
    assert.equal(meta.fork_modifications, 'Added webhook trigger');
  });

  it('sets fork_modifications to null when no modifications provided', () => {
    const original = makeArtifact();
    const fork = buildForkData(original, 'fork_author', undefined);
    const meta = JSON.parse(fork.type_metadata);
    assert.equal(meta.fork_modifications, null);
  });

  it('preserves existing type_metadata fields from original', () => {
    const original = makeArtifact({ type_metadata: JSON.stringify({ some_key: 'some_value' }) });
    const fork = buildForkData(original, 'fork_author', null);
    const meta = JSON.parse(fork.type_metadata);
    assert.equal(meta.some_key, 'some_value');
    assert.equal(meta.forked_from, original.id);
  });

  it('handles original with null type_metadata', () => {
    const original = makeArtifact({ type_metadata: null });
    const fork = buildForkData(original, 'fork_author', null);
    const meta = JSON.parse(fork.type_metadata);
    assert.equal(meta.forked_from, original.id);
  });

  it('copies artifact_type from original', () => {
    const original = makeArtifact({ artifact_type: 'code_pattern' });
    const fork = buildForkData(original, 'fork_author', null);
    assert.equal(fork.artifact_type, 'code_pattern');
  });

  it('sets validation_status to "untested" regardless of original', () => {
    const original = makeArtifact({ validation_status: 'passing' });
    const fork = buildForkData(original, 'fork_author', null);
    assert.equal(fork.validation_status, 'untested');
  });

  it('sets processing_status to "raw"', () => {
    const original = makeArtifact();
    const fork = buildForkData(original, 'fork_author', null);
    assert.equal(fork.processing_status, 'raw');
  });
});

// ── isFork ────────────────────────────────────────────────────────────────────

describe('isFork', () => {
  it('returns true for a forked artifact with forked_from in type_metadata', () => {
    const artifact = { type_metadata: JSON.stringify({ forked_from: randomUUID() }) };
    assert.equal(isFork(artifact), true);
  });

  it('returns false for an original artifact with no forked_from', () => {
    const artifact = { type_metadata: JSON.stringify({ some_key: 'val' }) };
    assert.equal(isFork(artifact), false);
  });

  it('returns false when type_metadata is null', () => {
    assert.equal(isFork({ type_metadata: null }), false);
  });

  it('returns false when artifact is null', () => {
    assert.equal(isFork(null), false);
  });

  it('returns false when artifact has no type_metadata field', () => {
    assert.equal(isFork({}), false);
  });

  it('handles type_metadata as a parsed object (not a string)', () => {
    const artifact = { type_metadata: { forked_from: randomUUID() } };
    assert.equal(isFork(artifact), true);
  });

  it('returns false when type_metadata is malformed JSON', () => {
    const artifact = { type_metadata: 'not-json{{{' };
    assert.equal(isFork(artifact), false);
  });
});

// ── Fork chaining (fork-of-a-fork) ───────────────────────────────────────────

describe('fork chaining', () => {
  it('a fork of a fork sets forked_from to its immediate parent', () => {
    const original = makeArtifact();
    const fork1 = buildForkData(original, 'author_a', null);
    const fork2 = buildForkData(fork1, 'author_b', 'Second level fork');
    const meta = JSON.parse(fork2.type_metadata);
    assert.equal(meta.forked_from, fork1.id);
    assert.notEqual(meta.forked_from, original.id);
  });

  it('a fork of a fork is still detected as a fork by isFork', () => {
    const original = makeArtifact();
    const fork1 = buildForkData(original, 'author_a', null);
    const fork2 = buildForkData(fork1, 'author_b', null);
    assert.equal(isFork(fork2), true);
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('fork edge cases', () => {
  it('handles missing author_name by storing the provided empty value', () => {
    // Validation of author_name is the handler's responsibility, not buildForkData
    const original = makeArtifact();
    const fork = buildForkData(original, '', null);
    assert.equal(fork.author_username, '');
  });

  it('handles original with no tags (defaults to empty array)', () => {
    const original = makeArtifact({ tags: null });
    const fork = buildForkData(original, 'author', null);
    assert.deepEqual(fork.tags, []);
  });

  it('copies tags from original', () => {
    const original = makeArtifact({ tags: ['email', 'crm'] });
    const fork = buildForkData(original, 'author', null);
    assert.deepEqual(fork.tags, ['email', 'crm']);
  });
});
