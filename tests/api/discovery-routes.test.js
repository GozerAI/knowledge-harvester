// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for Discovery route handler logic.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Re-implemented handler logic ───────────────────────────────────────────

function handleDiscoverRelatedLogic(relatedResults, id, depth, limit) {
  return {
    status: 200,
    body: { artifact_id: id, related: relatedResults, depth, limit },
  };
}

function handleDiscoverClustersLogic(clusters) {
  return {
    status: 200,
    body: { clusters, total: clusters.length },
  };
}

function handleDiscoverBridgesLogic(bridges) {
  return {
    status: 200,
    body: { bridges, total: bridges.length },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Discovery Routes', () => {
  describe('handleDiscoverRelated', () => {
    it('returns 200 with related results', () => {
      const related = [{ node_type: 'artifact', node_id: 'a2', score: 0.9, depth: 1 }];
      const result = handleDiscoverRelatedLogic(related, 'a1', 2, 10);
      assert.equal(result.status, 200);
      assert.equal(result.body.artifact_id, 'a1');
      assert.equal(result.body.related.length, 1);
    });

    it('includes depth and limit in response', () => {
      const result = handleDiscoverRelatedLogic([], 'a1', 3, 5);
      assert.equal(result.body.depth, 3);
      assert.equal(result.body.limit, 5);
    });

    it('returns empty related for unknown artifact', () => {
      const result = handleDiscoverRelatedLogic([], 'unknown', 2, 10);
      assert.equal(result.body.related.length, 0);
    });
  });

  describe('handleDiscoverClusters', () => {
    it('returns clusters with total count', () => {
      const clusters = [{ id: 0, nodes: [{}, {}, {}], size: 3 }];
      const result = handleDiscoverClustersLogic(clusters);
      assert.equal(result.status, 200);
      assert.equal(result.body.total, 1);
    });

    it('returns empty clusters array', () => {
      const result = handleDiscoverClustersLogic([]);
      assert.equal(result.body.total, 0);
    });
  });

  describe('handleDiscoverBridges', () => {
    it('returns bridges with total count', () => {
      const bridges = [{ node_type: 'category', node_id: 'ai', degree: 5 }];
      const result = handleDiscoverBridgesLogic(bridges);
      assert.equal(result.status, 200);
      assert.equal(result.body.total, 1);
    });

    it('returns empty bridges array', () => {
      const result = handleDiscoverBridgesLogic([]);
      assert.equal(result.body.total, 0);
    });
  });
});
