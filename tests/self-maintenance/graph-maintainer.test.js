// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #875 — Knowledge Graph Maintainer (dedicated)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAINTENANCE_OPS } from '../../src/self-maintenance/graph-maintainer.js';

describe('Graph Maintainer (source import)', () => {
  it('should define 4 maintenance operations', () => {
    assert.equal(MAINTENANCE_OPS.length, 4);
  });
  it('should include pruneStaleEdges', () => {
    assert.ok(MAINTENANCE_OPS.includes('pruneStaleEdges'));
  });
  it('should include removeOrphanNodes', () => {
    assert.ok(MAINTENANCE_OPS.includes('removeOrphanNodes'));
  });
  it('should include discoverNewEdges', () => {
    assert.ok(MAINTENANCE_OPS.includes('discoverNewEdges'));
  });
  it('should include checkConsistency', () => {
    assert.ok(MAINTENANCE_OPS.includes('checkConsistency'));
  });
});
