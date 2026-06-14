// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildArtifactSourceSummary,
  buildWorkflowSourceSummary,
  normalizeSourceRecordFilters,
  createSourceRecord,
  listSourceRecords,
  summarizeSourceRecords,
} from '../../src/db/source-record-store.js';

describe('source-record-store', () => {
  it('builds accepted summaries for workflows and artifacts', () => {
    assert.match(
      buildWorkflowSourceSummary({
        workflow_name: 'Order Sync',
        original_description: 'Synchronizes orders',
        metadata: { node_count: 8, trigger_type: 'webhook' },
      }),
      /Order Sync/,
    );
    assert.match(
      buildArtifactSourceSummary({
        name: 'acme/docs/policy.md',
        artifact_type: 'documentation',
        description: 'Security policy',
        tool_type: 'policy',
      }),
      /documentation/,
    );
  });

  it('normalizes source record filters', () => {
    const filters = normalizeSourceRecordFilters({
      decision: 'ACCEPTED',
      storedKind: 'ARTIFACT',
      limit: '999',
      offset: '-5',
      sinceHours: '99999',
    });

    assert.equal(filters.decision, 'accepted');
    assert.equal(filters.storedKind, 'artifact');
    assert.equal(filters.limit, 100);
    assert.equal(filters.offset, 0);
    assert.equal(filters.sinceHours, 24 * 180);
  });

  it('creates a source record', async () => {
    const calls = [];
    const database = {
      async query(sql, params) {
        calls.push({ sql, params });
        return { rows: [{ id: params[0], source: params[1], decision: params[11] }] };
      },
    };

    const result = await createSourceRecord(database, {
      source: 'github',
      decision: 'accepted',
      itemName: 'acme/repo/file.md',
    });

    assert.equal(calls.length, 1);
    assert.ok(calls[0].sql.includes('INSERT INTO source_records'));
    assert.equal(result.source, 'github');
    assert.equal(result.decision, 'accepted');
  });

  it('lists source records', async () => {
    const database = {
      async query(sql) {
        if (sql.startsWith('SELECT COUNT(*)::int AS count FROM source_records')) {
          return { rows: [{ count: 2 }] };
        }
        return {
          rows: [{
            id: '123e4567-e89b-12d3-a456-426614174000',
            source: 'github',
            decision: 'accepted',
            item_name: 'acme/repo/file.md',
          }],
        };
      },
    };

    const result = await listSourceRecords(database, { decision: 'accepted' });
    assert.equal(result.total, 2);
    assert.equal(result.records[0].decision, 'accepted');
  });

  it('summarizes source records by decision and source', async () => {
    const database = {
      async query(sql) {
        if (sql.includes('AS total')) return { rows: [{ total: 5 }] };
        if (sql.includes('GROUP BY decision')) return { rows: [{ decision: 'accepted', count: 3 }] };
        return { rows: [{ source: 'github', count: 4 }] };
      },
    };

    const result = await summarizeSourceRecords(database, { sinceHours: 48 });
    assert.equal(result.total, 5);
    assert.equal(result.window_hours, 48);
    assert.equal(result.by_decision[0].decision, 'accepted');
  });
});
