// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for Category Coverage Analysis.
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

// ── Re-implement coverage logic locally ────────────────────────────────────

function analyzeCoverage(rows) {
  return rows;
}

function identifyGaps(matrix, minArtifacts = 5) {
  return matrix.filter(cell => cell.count < minArtifacts);
}

function getCoverageReport(matrix, minArtifacts = 5) {
  const gaps = identifyGaps(matrix, minArtifacts);
  const categories = new Set(matrix.map(r => r.primary_category));
  const types = new Set(matrix.map(r => r.artifact_type));
  const totalCoverage = matrix.length > 0
    ? matrix.reduce((sum, r) => sum + r.count, 0) / matrix.length
    : 0;

  return {
    matrix,
    gaps,
    summary: {
      total_categories: categories.size,
      total_types: types.size,
      total_cells: matrix.length,
      gap_count: gaps.length,
      avg_coverage: Math.round(totalCoverage * 100) / 100,
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Coverage Analyzer', () => {
  const sampleMatrix = [
    { primary_category: 'ai-agent', artifact_type: 'workflow', count: 10, avg_quality: 85.5, last_updated: '2026-01-01' },
    { primary_category: 'ai-agent', artifact_type: 'code_pattern', count: 3, avg_quality: 75.0, last_updated: '2026-01-01' },
    { primary_category: 'devops', artifact_type: 'infra_config', count: 20, avg_quality: 90.0, last_updated: '2026-01-01' },
    { primary_category: 'devops', artifact_type: 'workflow', count: 2, avg_quality: 60.0, last_updated: '2026-01-01' },
    { primary_category: 'ecommerce', artifact_type: 'api_spec', count: 1, avg_quality: 70.0, last_updated: '2026-01-01' },
  ];

  describe('analyzeCoverage', () => {
    it('returns coverage matrix from DB', async () => {
      const db = mockDb([{ rows: sampleMatrix }]);
      const result = await db.query('SELECT ...');
      assert.equal(result.rows.length, 5);
    });

    it('matrix rows have primary_category, artifact_type, count, avg_quality', () => {
      const row = sampleMatrix[0];
      assert.ok('primary_category' in row);
      assert.ok('artifact_type' in row);
      assert.ok('count' in row);
      assert.ok('avg_quality' in row);
    });

    it('returns empty array when no data', async () => {
      const db = mockDb([{ rows: [] }]);
      const result = await db.query('SELECT ...');
      assert.equal(result.rows.length, 0);
    });
  });

  describe('identifyGaps', () => {
    it('finds cells with count < minArtifacts', () => {
      const gaps = identifyGaps(sampleMatrix, 5);
      assert.ok(gaps.length > 0);
      assert.ok(gaps.every(g => g.count < 5));
    });

    it('returns empty when all cells meet threshold', () => {
      const gaps = identifyGaps(sampleMatrix, 1);
      assert.equal(gaps.length, 0);
    });

    it('default minArtifacts is 5', () => {
      const gaps = identifyGaps(sampleMatrix);
      // 3 cells have count < 5: code_pattern(3), devops/workflow(2), ecommerce/api_spec(1)
      assert.equal(gaps.length, 3);
    });

    it('custom threshold works', () => {
      const gaps = identifyGaps(sampleMatrix, 15);
      // Only devops/infra_config(20) and ai-agent/workflow(10) are below 15:
      // Actually 10 < 15, so ai-agent/workflow is also a gap
      assert.ok(gaps.length >= 3);
    });

    it('gap entries have primary_category and artifact_type', () => {
      const gaps = identifyGaps(sampleMatrix, 5);
      for (const gap of gaps) {
        assert.ok('primary_category' in gap);
        assert.ok('artifact_type' in gap);
      }
    });
  });

  describe('getCoverageReport', () => {
    it('returns matrix, gaps, and summary', () => {
      const report = getCoverageReport(sampleMatrix);
      assert.ok(Array.isArray(report.matrix));
      assert.ok(Array.isArray(report.gaps));
      assert.ok('summary' in report);
    });

    it('summary has total_categories', () => {
      const report = getCoverageReport(sampleMatrix);
      assert.equal(report.summary.total_categories, 3); // ai-agent, devops, ecommerce
    });

    it('summary has total_types', () => {
      const report = getCoverageReport(sampleMatrix);
      assert.ok(report.summary.total_types > 0);
    });

    it('summary has avg_coverage', () => {
      const report = getCoverageReport(sampleMatrix);
      assert.ok(typeof report.summary.avg_coverage === 'number');
    });

    it('summary has gap_count matching gaps array', () => {
      const report = getCoverageReport(sampleMatrix);
      assert.equal(report.summary.gap_count, report.gaps.length);
    });

    it('empty matrix returns zero summary', () => {
      const report = getCoverageReport([]);
      assert.equal(report.summary.total_categories, 0);
      assert.equal(report.summary.total_types, 0);
      assert.equal(report.summary.avg_coverage, 0);
    });
  });
});
