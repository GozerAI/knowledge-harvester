// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for semantic (vector) search handler logic.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  extractSearchParams,
  validateSearchQuery,
  buildVectorQuery,
  formatSearchResults,
  createSemanticSearchHandler,
} from '../../src/api/semantic-search.js';

function makeParams(obj = {}) {
  return new URLSearchParams(obj);
}

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

describe('Semantic Search', () => {
  describe('Query parameter extraction', () => {
    it('extracts q and default limit', () => {
      const { q, limit } = extractSearchParams(makeParams({ q: 'kubernetes ingress' }));
      assert.equal(q, 'kubernetes ingress');
      assert.equal(limit, DEFAULT_LIMIT);
    });

    it('extracts custom limit', () => {
      const { limit } = extractSearchParams(makeParams({ q: 'deploy', limit: '25' }));
      assert.equal(limit, 25);
    });

    it('clamps limit to MAX_LIMIT', () => {
      const { limit } = extractSearchParams(makeParams({ q: 'test', limit: '999' }));
      assert.equal(limit, MAX_LIMIT);
    });

    it('returns empty string for missing q', () => {
      const { q } = extractSearchParams(makeParams());
      assert.equal(q, '');
    });

    it('falls back to default limit for non-numeric limit param', () => {
      const { limit } = extractSearchParams(makeParams({ q: 'test', limit: 'abc' }));
      assert.equal(limit, DEFAULT_LIMIT);
    });
  });

  describe('Query validation', () => {
    it('rejects empty query', () => {
      const { valid } = validateSearchQuery('');
      assert.equal(valid, false);
    });

    it('rejects whitespace-only query', () => {
      const { valid } = validateSearchQuery('   ');
      assert.equal(valid, false);
    });

    it('rejects null query', () => {
      const { valid } = validateSearchQuery(null);
      assert.equal(valid, false);
    });

    it('accepts a normal query string', () => {
      const { valid } = validateSearchQuery('deploy nginx to kubernetes');
      assert.equal(valid, true);
    });

    it('accepts a query with special characters', () => {
      const { valid } = validateSearchQuery('CI/CD & Docker');
      assert.equal(valid, true);
    });

    it('includes error message on failure', () => {
      const { error } = validateSearchQuery('');
      assert.ok(typeof error === 'string' && error.length > 0);
    });
  });

  describe('pgvector cosine distance query building', () => {
    it('includes cosine distance operator (<=>) in SQL', () => {
      const { sql } = buildVectorQuery(10);
      assert.ok(sql.includes('<=>'));
    });

    it('orders by embedding distance', () => {
      const { sql } = buildVectorQuery(10);
      assert.ok(sql.includes('ORDER BY embedding <=>'));
    });

    it('selects score as 1 - cosine distance', () => {
      const { sql } = buildVectorQuery(10);
      assert.ok(sql.includes('1 - (embedding <=>'));
    });

    it('passes limit as $2 parameter', () => {
      const { params } = buildVectorQuery(20);
      assert.equal(params[1], 20);
    });

    it('filters out artifacts without embeddings', () => {
      const { sql } = buildVectorQuery(10);
      assert.ok(sql.includes('embedding IS NOT NULL'));
    });
  });

  describe('Result formatting', () => {
    it('formats results with expected fields', () => {
      const rows = [{
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'K8s Deploy',
        artifact_type: 'workflow',
        primary_category: 'devops',
        tags: ['kubernetes', 'deploy'],
        quality_score: 80,
        score: 0.92345,
      }];
      const results = formatSearchResults(rows);
      assert.equal(results.length, 1);
      assert.equal(results[0].id, rows[0].id);
      assert.equal(results[0].name, rows[0].name);
      assert.equal(results[0].score, 0.9235);
    });

    it('handles empty rows array', () => {
      const results = formatSearchResults([]);
      assert.deepEqual(results, []);
    });

    it('defaults primary_category to null when missing', () => {
      const rows = [{ id: '1', name: 'x', artifact_type: 'workflow', primary_category: null, tags: [], quality_score: 0, score: 0.5 }];
      const [result] = formatSearchResults(rows);
      assert.equal(result.primary_category, null);
    });

    it('defaults tags to empty array when missing', () => {
      const rows = [{ id: '1', name: 'x', artifact_type: 'workflow', primary_category: null, tags: undefined, quality_score: 0, score: 0.5 }];
      const [result] = formatSearchResults(rows);
      assert.deepEqual(result.tags, []);
    });
  });

  describe('Handler integration', () => {
    it('queries by computed query embedding instead of name lookup', async () => {
      const calls = [];
      const handler = createSemanticSearchHandler({
        fetchImpl: async () => ({
          ok: true,
          async json() {
            return { embedding: [0.1, 0.2, 0.3] };
          },
        }),
        database: {
          async query(sql, params) {
            calls.push({ sql, params });
            return {
              rows: [{
                id: '123e4567-e89b-12d3-a456-426614174000',
                name: 'K8s Deploy',
                artifact_type: 'workflow',
                primary_category: 'devops',
                tags: ['kubernetes'],
                quality_score: 80,
                score: 0.92345,
              }],
            };
          },
        },
      });
      const res = createResponseRecorder();

      await handler({}, res, makeParams({ q: 'deploy nginx to kubernetes', limit: '5' }));

      assert.equal(calls.length, 1);
      assert.ok(calls[0].sql.includes('$1::vector'));
      assert.deepEqual(calls[0].params, ['[0.1,0.2,0.3]', 5]);
      assert.equal(res.writes[0].status, 200);
      assert.equal(res.writes[1].body.results[0].score, 0.9235);
    });

    it('returns 400 for whitespace-only queries', async () => {
      const handler = createSemanticSearchHandler({
        fetchImpl: async () => {
          throw new Error('should not fetch');
        },
        database: {
          async query() {
            throw new Error('should not query');
          },
        },
      });
      const res = createResponseRecorder();

      await handler({}, res, makeParams({ q: '   ' }));

      assert.equal(res.writes[0].status, 400);
      assert.ok(res.writes[1].body.error.includes('required'));
    });
  });
});
