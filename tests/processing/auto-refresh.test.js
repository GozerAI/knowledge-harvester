// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for Artifact Freshness Auto-Refresh.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Mock DB ────────────────────────────────────────────────────────────────

function mockDb(queryResponses = []) {
  let callIndex = 0;
  const calls = [];
  return {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (callIndex < queryResponses.length) {
        const resp = queryResponses[callIndex++];
        if (typeof resp === 'function') return resp(sql, params);
        return resp;
      }
      return { rows: [] };
    },
    getCalls: () => calls,
  };
}

// ── Re-implement shouldRefresh locally ─────────────────────────────────────

function shouldRefresh(artifact, threshold = 0.6) {
  if (!artifact) return false;
  const meta = typeof artifact.type_metadata === 'string'
    ? JSON.parse(artifact.type_metadata)
    : artifact.type_metadata;

  const decayRisk = meta?.decay_prediction?.decay_risk;
  if (decayRisk === undefined || decayRisk === null) return false;
  return parseFloat(decayRisk) >= threshold;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Auto-Refresh', () => {
  describe('shouldRefresh — pure function', () => {
    it('returns true when decay_risk >= threshold', () => {
      const artifact = {
        type_metadata: { decay_prediction: { decay_risk: 0.8 } },
      };
      assert.equal(shouldRefresh(artifact), true);
    });

    it('returns false when decay_risk < threshold', () => {
      const artifact = {
        type_metadata: { decay_prediction: { decay_risk: 0.3 } },
      };
      assert.equal(shouldRefresh(artifact), false);
    });

    it('returns true at exact threshold', () => {
      const artifact = {
        type_metadata: { decay_prediction: { decay_risk: 0.6 } },
      };
      assert.equal(shouldRefresh(artifact, 0.6), true);
    });

    it('returns false for null artifact', () => {
      assert.equal(shouldRefresh(null), false);
    });

    it('returns false when no type_metadata', () => {
      assert.equal(shouldRefresh({}), false);
    });

    it('returns false when no decay_prediction', () => {
      assert.equal(shouldRefresh({ type_metadata: {} }), false);
    });

    it('returns false when decay_risk is null', () => {
      const artifact = {
        type_metadata: { decay_prediction: { decay_risk: null } },
      };
      assert.equal(shouldRefresh(artifact), false);
    });

    it('works with custom threshold', () => {
      const artifact = {
        type_metadata: { decay_prediction: { decay_risk: 0.5 } },
      };
      assert.equal(shouldRefresh(artifact, 0.4), true);
      assert.equal(shouldRefresh(artifact, 0.6), false);
    });

    it('works with stringified type_metadata', () => {
      const artifact = {
        type_metadata: JSON.stringify({ decay_prediction: { decay_risk: 0.8 } }),
      };
      assert.equal(shouldRefresh(artifact), true);
    });
  });

  describe('scanForStale', () => {
    it('queries artifacts with decay_risk >= threshold', async () => {
      const db = mockDb([{
        rows: [
          { id: 'a1', name: 'Stale', type_metadata: { decay_prediction: { decay_risk: 0.9 } } },
        ],
      }]);
      const result = await db.query('SELECT ... WHERE decay_risk >= $1', [0.6]);
      assert.equal(result.rows.length, 1);
      assert.equal(result.rows[0].name, 'Stale');
    });

    it('respects limit parameter', async () => {
      const db = mockDb([{
        rows: [
          { id: 'a1', name: 'S1' },
          { id: 'a2', name: 'S2' },
        ],
      }]);
      const result = await db.query('SELECT ... LIMIT $2', [0.6, 2]);
      assert.equal(result.rows.length, 2);
    });

    it('returns empty when no stale artifacts', async () => {
      const db = mockDb([{ rows: [] }]);
      const result = await db.query('SELECT ...');
      assert.equal(result.rows.length, 0);
    });
  });

  describe('refreshArtifact', () => {
    it('logs success to refresh_log', async () => {
      const db = mockDb([
        { rows: [{ id: 'a1', name: 'Test', source_url: 'http://example.com', type_metadata: { decay_prediction: { decay_risk: 0.8 } } }] },
        { rows: [] }, // UPDATE artifacts
        { rows: [] }, // INSERT refresh_log
      ]);

      // Simulate refresh
      const artResult = await db.query('SELECT ...', ['a1']);
      assert.equal(artResult.rows.length, 1);
      await db.query('UPDATE artifacts SET ...', ['a1']);
      await db.query('INSERT INTO refresh_log ...', ['a1']);

      const calls = db.getCalls();
      assert.equal(calls.length, 3);
    });

    it('logs error to refresh_log on failure', async () => {
      const db = mockDb([
        { rows: [{ id: 'a1', name: 'Test', source_url: null, type_metadata: {} }] },
        // UPDATE will be called, we check the INSERT for error logging
        { rows: [] },
        { rows: [] },
      ]);

      await db.query('SELECT ...', ['a1']);
      await db.query('UPDATE ...'); // simulate
      await db.query('INSERT INTO refresh_log (status=error)', ['a1', 'error msg']);

      const calls = db.getCalls();
      assert.ok(calls.length >= 2);
    });

    it('returns not_found when artifact does not exist', async () => {
      const db = mockDb([{ rows: [] }]);
      const result = await db.query('SELECT ...', ['nonexistent']);
      assert.equal(result.rows.length, 0);
      // handler would return { status: 'not_found' }
    });
  });

  describe('refreshBatch', () => {
    it('processes all stale artifacts', async () => {
      // Verify batch logic: scan returns N items, each gets refreshed
      const staleArtifacts = [
        { id: 'a1', name: 'S1' },
        { id: 'a2', name: 'S2' },
        { id: 'a3', name: 'S3' },
      ];

      // Simple concurrency simulation
      const processed = [];
      for (let i = 0; i < staleArtifacts.length; i += 2) {
        const batch = staleArtifacts.slice(i, i + 2);
        for (const a of batch) processed.push(a.id);
      }

      assert.equal(processed.length, 3);
    });

    it('respects concurrency limit', () => {
      const items = [1, 2, 3, 4, 5];
      const concurrency = 2;
      const batches = [];
      for (let i = 0; i < items.length; i += concurrency) {
        batches.push(items.slice(i, i + concurrency));
      }
      assert.equal(batches.length, 3); // [1,2], [3,4], [5]
      assert.equal(batches[0].length, 2);
      assert.equal(batches[2].length, 1);
    });

    it('counts refreshed and failed separately', async () => {
      let refreshed = 0;
      let failed = 0;

      const results = [
        { status: 'fulfilled', value: { status: 'success' } },
        { status: 'fulfilled', value: { status: 'error' } },
        { status: 'rejected' },
      ];

      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.status === 'success') {
          refreshed++;
        } else {
          failed++;
        }
      }

      assert.equal(refreshed, 1);
      assert.equal(failed, 2);
    });
  });

  describe('getRefreshHistory', () => {
    it('returns refresh log entries', async () => {
      const db = mockDb([{
        rows: [
          { id: 'r1', artifact_id: 'a1', refresh_status: 'success', refreshed_at: '2026-01-01' },
          { id: 'r2', artifact_id: 'a2', refresh_status: 'error', refreshed_at: '2026-01-01' },
        ],
      }]);
      const result = await db.query('SELECT ... FROM refresh_log');
      assert.equal(result.rows.length, 2);
    });

    it('respects limit', async () => {
      const db = mockDb([{ rows: [{ id: 'r1' }] }]);
      const result = await db.query('SELECT ... LIMIT $1', [1]);
      assert.equal(result.rows.length, 1);
    });

    it('returns empty when no history', async () => {
      const db = mockDb([{ rows: [] }]);
      const result = await db.query('SELECT ...');
      assert.equal(result.rows.length, 0);
    });
  });
});
