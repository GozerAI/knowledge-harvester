// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #693 — Autonomous Knowledge Gap Detection
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Re-implement core logic locally for unit testing ──

function severityRank(severity) {
  const ranks = { critical: 0, high: 1, medium: 2, low: 3 };
  return ranks[severity] ?? 4;
}

function suggestSources(category, type) {
  const sourceMap = {
    workflow: ['n8n-community', 'github', 'activepieces', 'temporal'],
    code_pattern: ['github', 'github-agents', 'langgraph'],
    infra_config: ['terraform', 'helm', 'docker-compose', 'k8s-manifests', 'ansible'],
    ai_ml_asset: ['github-agents', 'comfyui', 'mlflow', 'jupyter'],
    api_spec: ['github', 'openapi-specs'],
    data_asset: ['dbt', 'kaggle'],
    documentation: ['github', 'adrs', 'runbooks'],
  };
  return sourceMap[type] || ['github'];
}

function buildCoverageGaps(rows, minArtifacts) {
  const gaps = [];
  for (const row of rows) {
    if (row.cnt < minArtifacts) {
      const severity = row.cnt === 0 ? 'critical' : row.cnt < Math.floor(minArtifacts / 2) ? 'high' : 'medium';
      gaps.push({
        category: row.primary_category,
        type: row.artifact_type,
        severity,
        reason: 'insufficient_coverage',
        current_count: row.cnt,
        recommended_count: minArtifacts,
        suggested_sources: suggestSources(row.primary_category, row.artifact_type),
      });
    }
  }
  return gaps;
}

describe('Knowledge Gap Detector', () => {
  describe('severityRank', () => {
    it('should rank critical as 0', () => {
      assert.equal(severityRank('critical'), 0);
    });

    it('should rank high as 1', () => {
      assert.equal(severityRank('high'), 1);
    });

    it('should rank medium as 2', () => {
      assert.equal(severityRank('medium'), 2);
    });

    it('should rank low as 3', () => {
      assert.equal(severityRank('low'), 3);
    });

    it('should rank unknown as 4', () => {
      assert.equal(severityRank('unknown'), 4);
    });
  });

  describe('suggestSources', () => {
    it('should return workflow sources', () => {
      const sources = suggestSources('automation', 'workflow');
      assert.ok(sources.includes('n8n-community'));
      assert.ok(sources.includes('github'));
    });

    it('should return infra sources', () => {
      const sources = suggestSources('devops', 'infra_config');
      assert.ok(sources.includes('terraform'));
      assert.ok(sources.includes('helm'));
    });

    it('should default to github for unknown types', () => {
      const sources = suggestSources('unknown', 'unknown_type');
      assert.deepEqual(sources, ['github']);
    });

    it('should return AI sources for ai_ml_asset', () => {
      const sources = suggestSources('ai', 'ai_ml_asset');
      assert.ok(sources.includes('github-agents'));
      assert.ok(sources.includes('mlflow'));
    });

    it('should return api sources', () => {
      const sources = suggestSources('api', 'api_spec');
      assert.ok(sources.includes('openapi-specs'));
    });
  });

  describe('buildCoverageGaps', () => {
    it('should detect critical gap when count is 0', () => {
      const rows = [{ primary_category: 'ai', artifact_type: 'workflow', cnt: 0 }];
      const gaps = buildCoverageGaps(rows, 5);
      assert.equal(gaps.length, 1);
      assert.equal(gaps[0].severity, 'critical');
    });

    it('should detect high gap when count < half', () => {
      const rows = [{ primary_category: 'devops', artifact_type: 'infra_config', cnt: 1 }];
      const gaps = buildCoverageGaps(rows, 5);
      assert.equal(gaps.length, 1);
      assert.equal(gaps[0].severity, 'high');
    });

    it('should detect medium gap when close to threshold', () => {
      const rows = [{ primary_category: 'data', artifact_type: 'data_asset', cnt: 4 }];
      const gaps = buildCoverageGaps(rows, 5);
      assert.equal(gaps.length, 1);
      assert.equal(gaps[0].severity, 'medium');
    });

    it('should not report gap when count meets threshold', () => {
      const rows = [{ primary_category: 'ai', artifact_type: 'workflow', cnt: 5 }];
      const gaps = buildCoverageGaps(rows, 5);
      assert.equal(gaps.length, 0);
    });

    it('should include suggested sources in gaps', () => {
      const rows = [{ primary_category: 'devops', artifact_type: 'workflow', cnt: 0 }];
      const gaps = buildCoverageGaps(rows, 3);
      assert.ok(gaps[0].suggested_sources.length > 0);
    });

    it('should set correct recommended count', () => {
      const rows = [{ primary_category: 'ai', artifact_type: 'code_pattern', cnt: 1 }];
      const gaps = buildCoverageGaps(rows, 10);
      assert.equal(gaps[0].recommended_count, 10);
      assert.equal(gaps[0].current_count, 1);
    });

    it('should handle multiple rows', () => {
      const rows = [
        { primary_category: 'a', artifact_type: 'workflow', cnt: 0 },
        { primary_category: 'b', artifact_type: 'workflow', cnt: 10 },
        { primary_category: 'c', artifact_type: 'code_pattern', cnt: 1 },
      ];
      const gaps = buildCoverageGaps(rows, 5);
      assert.equal(gaps.length, 2);
    });

    it('should handle empty rows', () => {
      const gaps = buildCoverageGaps([], 5);
      assert.equal(gaps.length, 0);
    });
  });

  describe('gap sorting', () => {
    it('should sort gaps by severity', () => {
      const gaps = [
        { severity: 'low' },
        { severity: 'critical' },
        { severity: 'medium' },
        { severity: 'high' },
      ];
      gaps.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
      assert.equal(gaps[0].severity, 'critical');
      assert.equal(gaps[1].severity, 'high');
      assert.equal(gaps[2].severity, 'medium');
      assert.equal(gaps[3].severity, 'low');
    });
  });
});
