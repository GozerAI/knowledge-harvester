// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import { db } from '../../src/db/client.js';
import { handleGraphMaterialize, handleGraphQuery } from '../../src/api/graph-routes.js';

function createResponseRecorder() {
  const writes = [];
  return {
    writes,
    writeHead(status, headers) {
      writes.push({ status, headers });
    },
    end(body) {
      writes.push({ body: JSON.parse(body) });
    },
  };
}

function makeJsonRequest(body) {
  return Readable.from([Buffer.from(JSON.stringify(body))]);
}

describe('graph routes', () => {
  it('returns a graph subgraph with nodes and edges', async () => {
    const originalQuery = db.query;

    db.query = async (sql) => {
      if (sql.includes('WITH RECURSIVE graph_walk')) {
        return {
          rows: [
            { node_type: 'artifact', node_id: 'a1', label: 'Runbook', properties: {}, depth: 0 },
            { node_type: 'claim', node_id: 'c1', label: 'Rollback required', properties: {}, depth: 1 },
          ],
        };
      }
      if (sql.includes('FROM graph_edges')) {
        return {
          rows: [{
            id: 'edge-1',
            source_type: 'claim',
            source_id: 'c1',
            target_type: 'artifact',
            target_id: 'a1',
            edge_type: 'about',
            weight: 0.9,
            metadata: {},
          }],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    };

    try {
      const res = createResponseRecorder();
      await handleGraphQuery(
        makeJsonRequest({
          start_type: 'artifact',
          start_id: 'a1',
          edge_types: ['about'],
          depth: 2,
        }),
        res,
      );

      assert.equal(res.writes[0].status, 200);
      assert.equal(res.writes[1].body.total_nodes, 2);
      assert.equal(res.writes[1].body.total_edges, 1);
      assert.equal(res.writes[1].body.edges[0].edge_type, 'about');
    } finally {
      db.query = originalQuery;
    }
  });

  it('materializes the graph via API', async () => {
    const originalQuery = db.query;
    const artifactId = randomUUID();

    db.query = async (sql, params = []) => {
      if (sql.includes('FROM artifacts WHERE publishing_status')) {
        return {
          rows: [{
            id: artifactId,
            name: 'Incident Runbook',
            artifact_type: 'documentation',
            primary_category: 'operations',
            quality_score: 80,
          }],
        };
      }
      if (sql.includes('FROM artifact_relations')) return { rows: [] };
      if (sql.includes('FROM workflows')) return { rows: [] };
      if (sql.includes('FROM source_records')) return { rows: [] };
      if (sql.includes('FROM knowledge_claims')) return { rows: [] };
      if (sql.includes('FROM claim_evidence')) return { rows: [] };
      if (sql.includes('INSERT INTO graph_nodes')) {
        return { rows: [{ node_type: params[0], node_id: params[1] }] };
      }
      if (sql.includes('INSERT INTO graph_edges')) {
        return { rows: [{ source_type: params[0], target_type: params[2], edge_type: params[4] }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    };

    try {
      const res = createResponseRecorder();
      await handleGraphMaterialize({}, res);

      assert.equal(res.writes[0].status, 200);
      assert.equal(res.writes[1].body.nodes_created, 1);
      assert.equal(res.writes[1].body.edges_created, 1);
    } finally {
      db.query = originalQuery;
    }
  });
});
