// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Mock DB helper ──────────────────────────────────────────────────────────

function createMockDb(queryResults = {}) {
  const calls = [];
  return {
    query: async (text, params) => {
      calls.push({ text, params });
      for (const [key, result] of Object.entries(queryResults)) {
        if (text.includes(key)) return result;
      }
      return { rows: [], rowCount: 0 };
    },
    calls,
  };
}

// ── Reimplemented Union-Find from semantic-dedup.js ─────────────────────────

class UnionFind {
  constructor() {
    this.parent = new Map();
    this.rank = new Map();
  }

  find(x) {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
    if (this.parent.get(x) !== x) {
      this.parent.set(x, this.find(this.parent.get(x)));
    }
    return this.parent.get(x);
  }

  union(x, y) {
    const rootX = this.find(x);
    const rootY = this.find(y);
    if (rootX === rootY) return;
    const rankX = this.rank.get(rootX);
    const rankY = this.rank.get(rootY);
    if (rankX < rankY) {
      this.parent.set(rootX, rootY);
    } else if (rankX > rankY) {
      this.parent.set(rootY, rootX);
    } else {
      this.parent.set(rootY, rootX);
      this.rank.set(rootX, rankX + 1);
    }
  }
}

// ── Reimplemented core functions from semantic-dedup.js ─────────────────────

async function findSemanticDuplicates(db, limit = 100, threshold = 0.92) {
  const result = await db.query(
    `SELECT a1.id as id1, a1.name as name1, a1.quality_score as quality1, a1.updated_at as updated1,
            a2.id as id2, a2.name as name2, a2.quality_score as quality2, a2.updated_at as updated2,
            1 - (a1.embedding <=> a2.embedding) as similarity
     FROM artifacts a1
     JOIN artifacts a2 ON a1.id < a2.id
     WHERE a1.embedding IS NOT NULL
       AND a2.embedding IS NOT NULL
       AND 1 - (a1.embedding <=> a2.embedding) >= $1
     LIMIT $2`,
    [threshold, limit]
  );

  if (result.rows.length === 0) {
    return [];
  }

  const uf = new UnionFind();
  const artifactData = new Map();

  for (const row of result.rows) {
    uf.union(row.id1, row.id2);

    if (!artifactData.has(row.id1)) {
      artifactData.set(row.id1, {
        id: row.id1,
        name: row.name1,
        quality_score: row.quality1,
        updated_at: row.updated1,
        embedding_similarity: parseFloat(row.similarity),
      });
    } else {
      const existing = artifactData.get(row.id1);
      existing.embedding_similarity = Math.max(existing.embedding_similarity, parseFloat(row.similarity));
    }

    if (!artifactData.has(row.id2)) {
      artifactData.set(row.id2, {
        id: row.id2,
        name: row.name2,
        quality_score: row.quality2,
        updated_at: row.updated2,
        embedding_similarity: parseFloat(row.similarity),
      });
    } else {
      const existing = artifactData.get(row.id2);
      existing.embedding_similarity = Math.max(existing.embedding_similarity, parseFloat(row.similarity));
    }
  }

  const groupMap = new Map();
  for (const [id] of artifactData) {
    const root = uf.find(id);
    if (!groupMap.has(root)) {
      groupMap.set(root, []);
    }
    groupMap.get(root).push(artifactData.get(id));
  }

  return Array.from(groupMap.values()).filter(g => g.length >= 2);
}

function selectCanonical(group) {
  if (!group || group.length === 0) return null;
  if (group.length === 1) return group[0];

  return group.reduce((best, current) => {
    const bestScore = best.quality_score ?? 0;
    const currentScore = current.quality_score ?? 0;

    if (currentScore > bestScore) return current;
    if (currentScore < bestScore) return best;

    const bestDate = best.updated_at ? new Date(best.updated_at).getTime() : 0;
    const currentDate = current.updated_at ? new Date(current.updated_at).getTime() : 0;
    return currentDate > bestDate ? current : best;
  });
}

async function createSeeAlsoLinks(db, groups) {
  let links_created = 0;

  for (const group of groups) {
    const { canonical, members, group_id } = group;

    for (const member of members) {
      if (member.id === canonical.id) continue;

      const relationResult = await db.query(
        `INSERT INTO artifact_relations (source_id, target_id, relation_type, confidence)
         VALUES ($1, $2, 'see_also', 0.9)
         ON CONFLICT DO NOTHING`,
        [member.id, canonical.id]
      );
      links_created += relationResult.rowCount || 0;

      await db.query(
        `UPDATE artifact_duplicates
         SET canonical_id = $1, group_id = $2
         WHERE (original_id = $3 OR duplicate_id = $3)`,
        [canonical.id, group_id, member.id]
      );
    }
  }

  return { links_created };
}

async function runSemanticDedup(db, limit = 100, threshold = 0.92) {
  try {
    const groups = await findSemanticDuplicates(db, limit, threshold);

    if (groups.length === 0) {
      return { groups_found: 0, canonical_selected: 0, links_created: 0 };
    }

    const preparedGroups = groups.map(group => {
      const canonical = selectCanonical(group);
      return {
        canonical,
        members: group,
        group_id: 'test-group-id',
      };
    });

    const { links_created } = await createSeeAlsoLinks(db, preparedGroups);

    return {
      groups_found: groups.length,
      canonical_selected: preparedGroups.length,
      links_created,
    };
  } catch (err) {
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

// ── findSemanticDuplicates ──────────────────────────────────────────────────

describe('findSemanticDuplicates — empty results', () => {
  it('returns empty array when no embeddings exist', async () => {
    const db = createMockDb();
    const result = await findSemanticDuplicates(db);
    assert.deepStrictEqual(result, []);
  });

  it('returns empty array when query returns no rows', async () => {
    const db = createMockDb({ 'FROM artifacts': { rows: [], rowCount: 0 } });
    const result = await findSemanticDuplicates(db, 100, 0.92);
    assert.deepStrictEqual(result, []);
  });
});

describe('findSemanticDuplicates — grouping', () => {
  it('groups a single pair correctly', async () => {
    const db = createMockDb({
      'FROM artifacts': {
        rows: [{
          id1: 'aaa', name1: 'Artifact A', quality1: 80, updated1: '2026-01-01',
          id2: 'bbb', name2: 'Artifact B', quality2: 75, updated2: '2026-01-02',
          similarity: '0.95',
        }],
        rowCount: 1,
      },
    });
    const result = await findSemanticDuplicates(db, 100, 0.92);
    assert.equal(result.length, 1);
    assert.equal(result[0].length, 2);
  });

  it('groups multiple pairs into a single group when transitive (A~B, B~C)', async () => {
    const db = createMockDb({
      'FROM artifacts': {
        rows: [
          { id1: 'aaa', name1: 'A', quality1: 80, updated1: '2026-01-01',
            id2: 'bbb', name2: 'B', quality2: 75, updated2: '2026-01-02',
            similarity: '0.95' },
          { id1: 'bbb', name1: 'B', quality1: 75, updated1: '2026-01-02',
            id2: 'ccc', name2: 'C', quality2: 70, updated2: '2026-01-03',
            similarity: '0.93' },
        ],
        rowCount: 2,
      },
    });
    const result = await findSemanticDuplicates(db, 100, 0.92);
    assert.equal(result.length, 1, 'Should form one transitive group');
    assert.equal(result[0].length, 3, 'Group should contain A, B, C');
  });

  it('creates separate groups for unrelated pairs', async () => {
    const db = createMockDb({
      'FROM artifacts': {
        rows: [
          { id1: 'aaa', name1: 'A', quality1: 80, updated1: '2026-01-01',
            id2: 'bbb', name2: 'B', quality2: 75, updated2: '2026-01-02',
            similarity: '0.95' },
          { id1: 'ccc', name1: 'C', quality1: 70, updated1: '2026-01-03',
            id2: 'ddd', name2: 'D', quality2: 65, updated2: '2026-01-04',
            similarity: '0.94' },
        ],
        rowCount: 2,
      },
    });
    const result = await findSemanticDuplicates(db, 100, 0.92);
    assert.equal(result.length, 2, 'Should form two separate groups');
  });

  it('passes threshold to query as $1', async () => {
    const db = createMockDb();
    await findSemanticDuplicates(db, 50, 0.95);
    assert.equal(db.calls[0].params[0], 0.95);
  });

  it('passes limit to query as $2', async () => {
    const db = createMockDb();
    await findSemanticDuplicates(db, 50, 0.95);
    assert.equal(db.calls[0].params[1], 50);
  });

  it('returns similarity scores in results', async () => {
    const db = createMockDb({
      'FROM artifacts': {
        rows: [{
          id1: 'aaa', name1: 'A', quality1: 80, updated1: '2026-01-01',
          id2: 'bbb', name2: 'B', quality2: 75, updated2: '2026-01-02',
          similarity: '0.96',
        }],
        rowCount: 1,
      },
    });
    const result = await findSemanticDuplicates(db, 100, 0.92);
    const group = result[0];
    assert.ok(group.some(a => a.embedding_similarity === 0.96));
  });

  it('uses default limit of 100 and threshold of 0.92', async () => {
    const db = createMockDb();
    await findSemanticDuplicates(db);
    assert.equal(db.calls[0].params[0], 0.92);
    assert.equal(db.calls[0].params[1], 100);
  });

  it('keeps highest similarity when artifact appears in multiple pairs', async () => {
    const db = createMockDb({
      'FROM artifacts': {
        rows: [
          { id1: 'aaa', name1: 'A', quality1: 80, updated1: '2026-01-01',
            id2: 'bbb', name2: 'B', quality2: 75, updated2: '2026-01-02',
            similarity: '0.93' },
          { id1: 'aaa', name1: 'A', quality1: 80, updated1: '2026-01-01',
            id2: 'ccc', name2: 'C', quality2: 70, updated2: '2026-01-03',
            similarity: '0.97' },
        ],
        rowCount: 2,
      },
    });
    const result = await findSemanticDuplicates(db, 100, 0.92);
    const artifactA = result[0].find(a => a.id === 'aaa');
    assert.equal(artifactA.embedding_similarity, 0.97);
  });

  it('includes name and quality_score in returned artifacts', async () => {
    const db = createMockDb({
      'FROM artifacts': {
        rows: [{
          id1: 'aaa', name1: 'My Artifact', quality1: 85, updated1: '2026-01-01',
          id2: 'bbb', name2: 'Other Art', quality2: 60, updated2: '2026-01-02',
          similarity: '0.95',
        }],
        rowCount: 1,
      },
    });
    const result = await findSemanticDuplicates(db, 100, 0.92);
    const a = result[0].find(x => x.id === 'aaa');
    assert.equal(a.name, 'My Artifact');
    assert.equal(a.quality_score, 85);
  });
});

// ── selectCanonical ─────────────────────────────────────────────────────────

describe('selectCanonical — quality-based selection', () => {
  it('selects artifact with highest quality_score', () => {
    const group = [
      { id: 'a', quality_score: 70, updated_at: '2026-01-01' },
      { id: 'b', quality_score: 90, updated_at: '2026-01-01' },
      { id: 'c', quality_score: 80, updated_at: '2026-01-01' },
    ];
    const canonical = selectCanonical(group);
    assert.equal(canonical.id, 'b');
  });

  it('tiebreaks by most recent updated_at when quality is equal', () => {
    const group = [
      { id: 'a', quality_score: 80, updated_at: '2026-01-01' },
      { id: 'b', quality_score: 80, updated_at: '2026-03-01' },
      { id: 'c', quality_score: 80, updated_at: '2026-02-01' },
    ];
    const canonical = selectCanonical(group);
    assert.equal(canonical.id, 'b');
  });

  it('handles single-item group', () => {
    const group = [{ id: 'a', quality_score: 80, updated_at: '2026-01-01' }];
    const canonical = selectCanonical(group);
    assert.equal(canonical.id, 'a');
  });

  it('handles null quality scores (treats as 0)', () => {
    const group = [
      { id: 'a', quality_score: null, updated_at: '2026-01-01' },
      { id: 'b', quality_score: 50, updated_at: '2026-01-01' },
    ];
    const canonical = selectCanonical(group);
    assert.equal(canonical.id, 'b');
  });

  it('handles undefined quality scores (treats as 0)', () => {
    const group = [
      { id: 'a', updated_at: '2026-01-01' },
      { id: 'b', quality_score: 10, updated_at: '2026-01-01' },
    ];
    const canonical = selectCanonical(group);
    assert.equal(canonical.id, 'b');
  });

  it('handles null updated_at (treats as epoch)', () => {
    const group = [
      { id: 'a', quality_score: 80, updated_at: null },
      { id: 'b', quality_score: 80, updated_at: '2026-01-01' },
    ];
    const canonical = selectCanonical(group);
    assert.equal(canonical.id, 'b');
  });

  it('returns null for empty group', () => {
    const canonical = selectCanonical([]);
    assert.equal(canonical, null);
  });

  it('returns null for null group', () => {
    const canonical = selectCanonical(null);
    assert.equal(canonical, null);
  });

  it('returns full artifact object', () => {
    const group = [
      { id: 'a', name: 'Artifact A', quality_score: 90, updated_at: '2026-01-01', embedding_similarity: 0.95 },
    ];
    const canonical = selectCanonical(group);
    assert.equal(canonical.name, 'Artifact A');
    assert.equal(canonical.embedding_similarity, 0.95);
  });

  it('handles all null quality scores — picks by updated_at', () => {
    const group = [
      { id: 'a', quality_score: null, updated_at: '2026-01-01' },
      { id: 'b', quality_score: null, updated_at: '2026-03-01' },
    ];
    const canonical = selectCanonical(group);
    assert.equal(canonical.id, 'b');
  });
});

// ── createSeeAlsoLinks ─────────────────────────────────────────────────────

describe('createSeeAlsoLinks — relation creation', () => {
  it('creates see_also relations from non-canonical to canonical', async () => {
    const db = createMockDb({
      'INSERT INTO artifact_relations': { rows: [], rowCount: 1 },
      'UPDATE artifact_duplicates': { rows: [], rowCount: 1 },
    });
    const groups = [{
      canonical: { id: 'canonical-1' },
      members: [
        { id: 'canonical-1' },
        { id: 'member-1' },
        { id: 'member-2' },
      ],
      group_id: 'group-1',
    }];
    const result = await createSeeAlsoLinks(db, groups);
    assert.equal(result.links_created, 2);
  });

  it('inserts with relation_type see_also', async () => {
    const db = createMockDb({
      'INSERT INTO artifact_relations': { rows: [], rowCount: 1 },
      'UPDATE artifact_duplicates': { rows: [], rowCount: 1 },
    });
    const groups = [{
      canonical: { id: 'can' },
      members: [{ id: 'can' }, { id: 'dup' }],
      group_id: 'g1',
    }];
    await createSeeAlsoLinks(db, groups);
    const insertCall = db.calls.find(c => c.text.includes('INSERT INTO artifact_relations'));
    assert.ok(insertCall, 'Should have an INSERT call');
    assert.ok(insertCall.text.includes('see_also'));
  });

  it('sets canonical_id in artifact_duplicates', async () => {
    const db = createMockDb({
      'INSERT INTO artifact_relations': { rows: [], rowCount: 1 },
      'UPDATE artifact_duplicates': { rows: [], rowCount: 1 },
    });
    const groups = [{
      canonical: { id: 'can-id' },
      members: [{ id: 'can-id' }, { id: 'dup-id' }],
      group_id: 'g1',
    }];
    await createSeeAlsoLinks(db, groups);
    const updateCall = db.calls.find(c => c.text.includes('UPDATE artifact_duplicates'));
    assert.ok(updateCall);
    assert.equal(updateCall.params[0], 'can-id');
  });

  it('sets group_id in artifact_duplicates', async () => {
    const db = createMockDb({
      'INSERT INTO artifact_relations': { rows: [], rowCount: 1 },
      'UPDATE artifact_duplicates': { rows: [], rowCount: 1 },
    });
    const groups = [{
      canonical: { id: 'can-id' },
      members: [{ id: 'can-id' }, { id: 'dup-id' }],
      group_id: 'test-group-uuid',
    }];
    await createSeeAlsoLinks(db, groups);
    const updateCall = db.calls.find(c => c.text.includes('UPDATE artifact_duplicates'));
    assert.equal(updateCall.params[1], 'test-group-uuid');
  });

  it('handles empty groups array', async () => {
    const db = createMockDb();
    const result = await createSeeAlsoLinks(db, []);
    assert.equal(result.links_created, 0);
    assert.equal(db.calls.length, 0);
  });

  it('returns correct links_created count', async () => {
    const db = createMockDb({
      'INSERT INTO artifact_relations': { rows: [], rowCount: 1 },
      'UPDATE artifact_duplicates': { rows: [], rowCount: 1 },
    });
    const groups = [
      {
        canonical: { id: 'c1' },
        members: [{ id: 'c1' }, { id: 'm1' }, { id: 'm2' }],
        group_id: 'g1',
      },
      {
        canonical: { id: 'c2' },
        members: [{ id: 'c2' }, { id: 'm3' }],
        group_id: 'g2',
      },
    ];
    const result = await createSeeAlsoLinks(db, groups);
    // 2 links from group1 (m1->c1, m2->c1) + 1 from group2 (m3->c2) = 3
    assert.equal(result.links_created, 3);
  });

  it('skips canonical member — no self-link', async () => {
    const db = createMockDb({
      'INSERT INTO artifact_relations': { rows: [], rowCount: 1 },
      'UPDATE artifact_duplicates': { rows: [], rowCount: 1 },
    });
    const groups = [{
      canonical: { id: 'can' },
      members: [{ id: 'can' }, { id: 'dup' }],
      group_id: 'g1',
    }];
    await createSeeAlsoLinks(db, groups);
    const insertCalls = db.calls.filter(c => c.text.includes('INSERT INTO artifact_relations'));
    assert.equal(insertCalls.length, 1, 'Should only insert for non-canonical members');
    assert.equal(insertCalls[0].params[0], 'dup');
    assert.equal(insertCalls[0].params[1], 'can');
  });

  it('uses ON CONFLICT DO NOTHING to avoid duplicate links', async () => {
    const db = createMockDb({
      'INSERT INTO artifact_relations': { rows: [], rowCount: 0 },
      'UPDATE artifact_duplicates': { rows: [], rowCount: 1 },
    });
    const groups = [{
      canonical: { id: 'can' },
      members: [{ id: 'can' }, { id: 'dup' }],
      group_id: 'g1',
    }];
    const result = await createSeeAlsoLinks(db, groups);
    // rowCount 0 means conflict — no new link
    assert.equal(result.links_created, 0);
    const insertCall = db.calls.find(c => c.text.includes('INSERT'));
    assert.ok(insertCall.text.includes('ON CONFLICT DO NOTHING'));
  });
});

// ── runSemanticDedup ────────────────────────────────────────────────────────

describe('runSemanticDedup — orchestration', () => {
  it('orchestrates full flow and returns summary stats', async () => {
    const db = createMockDb({
      'FROM artifacts': {
        rows: [{
          id1: 'aaa', name1: 'A', quality1: 90, updated1: '2026-01-01',
          id2: 'bbb', name2: 'B', quality2: 70, updated2: '2026-01-02',
          similarity: '0.95',
        }],
        rowCount: 1,
      },
      'INSERT INTO artifact_relations': { rows: [], rowCount: 1 },
      'UPDATE artifact_duplicates': { rows: [], rowCount: 1 },
    });
    const result = await runSemanticDedup(db, 100, 0.92);
    assert.equal(result.groups_found, 1);
    assert.equal(result.canonical_selected, 1);
    assert.equal(result.links_created, 1);
  });

  it('returns zeros when no duplicates found', async () => {
    const db = createMockDb();
    const result = await runSemanticDedup(db, 100, 0.92);
    assert.deepStrictEqual(result, { groups_found: 0, canonical_selected: 0, links_created: 0 });
  });

  it('passes limit and threshold through to query', async () => {
    const db = createMockDb();
    await runSemanticDedup(db, 50, 0.88);
    assert.equal(db.calls[0].params[0], 0.88);
    assert.equal(db.calls[0].params[1], 50);
  });

  it('handles db errors gracefully by throwing', async () => {
    const db = {
      query: async () => { throw new Error('Connection refused'); },
    };
    await assert.rejects(
      () => runSemanticDedup(db, 100, 0.92),
      { message: 'Connection refused' }
    );
  });

  it('handles multiple groups correctly', async () => {
    const db = createMockDb({
      'FROM artifacts': {
        rows: [
          { id1: 'a1', name1: 'A1', quality1: 80, updated1: '2026-01-01',
            id2: 'a2', name2: 'A2', quality2: 70, updated2: '2026-01-02',
            similarity: '0.95' },
          { id1: 'b1', name1: 'B1', quality1: 60, updated1: '2026-01-01',
            id2: 'b2', name2: 'B2', quality2: 90, updated2: '2026-01-02',
            similarity: '0.93' },
        ],
        rowCount: 2,
      },
      'INSERT INTO artifact_relations': { rows: [], rowCount: 1 },
      'UPDATE artifact_duplicates': { rows: [], rowCount: 1 },
    });
    const result = await runSemanticDedup(db, 100, 0.92);
    assert.equal(result.groups_found, 2);
    assert.equal(result.canonical_selected, 2);
    assert.equal(result.links_created, 2);
  });

  it('selects correct canonical in each group', async () => {
    const db = createMockDb({
      'FROM artifacts': {
        rows: [{
          id1: 'low', name1: 'Low Quality', quality1: 30, updated1: '2026-01-01',
          id2: 'high', name2: 'High Quality', quality2: 95, updated2: '2026-01-02',
          similarity: '0.96',
        }],
        rowCount: 1,
      },
      'INSERT INTO artifact_relations': { rows: [], rowCount: 1 },
      'UPDATE artifact_duplicates': { rows: [], rowCount: 1 },
    });
    await runSemanticDedup(db, 100, 0.92);
    // The INSERT call should have the non-canonical as source, canonical as target
    const insertCall = db.calls.find(c => c.text.includes('INSERT INTO artifact_relations'));
    assert.ok(insertCall);
    assert.equal(insertCall.params[0], 'low', 'source should be the non-canonical');
    assert.equal(insertCall.params[1], 'high', 'target should be the canonical');
  });

  it('uses default limit and threshold when not provided', async () => {
    const db = createMockDb();
    await runSemanticDedup(db);
    assert.equal(db.calls[0].params[0], 0.92);
    assert.equal(db.calls[0].params[1], 100);
  });
});

// ── UnionFind ───────────────────────────────────────────────────────────────

describe('UnionFind — transitive grouping', () => {
  it('groups elements transitively', () => {
    const uf = new UnionFind();
    uf.union('a', 'b');
    uf.union('b', 'c');
    assert.equal(uf.find('a'), uf.find('c'));
  });

  it('keeps separate groups separate', () => {
    const uf = new UnionFind();
    uf.union('a', 'b');
    uf.union('c', 'd');
    assert.notEqual(uf.find('a'), uf.find('c'));
  });

  it('handles single element', () => {
    const uf = new UnionFind();
    const root = uf.find('x');
    assert.equal(root, 'x');
  });

  it('handles union of already-united elements', () => {
    const uf = new UnionFind();
    uf.union('a', 'b');
    uf.union('a', 'b');
    assert.equal(uf.find('a'), uf.find('b'));
  });
});
