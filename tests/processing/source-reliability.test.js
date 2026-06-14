// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for Source Reliability — reputation scoring, freshness detection,
 * stale source handling, and source deduplication.
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

// ── Re-implement source reputation scoring locally ─────────────────────────

const SOURCE_BASE_REPUTATION = {
  'n8n-community': 85,
  'github': 75,
  'activepieces': 70,
  'node-red': 70,
  'reddit': 40,
  'pipedream': 65,
  'comfyui': 60,
  'temporal': 80,
  'airflow': 80,
  'prefect': 75,
  'dagster': 75,
  'windmill': 70,
  'flowise': 60,
  'dify': 60,
  'langchain': 70,
  'crewai': 65,
  'home-assistant': 65,
  'tekton': 75,
  'github-actions': 75,
  'mlflow': 70,
  'dbt': 75,
  'camunda': 70,
  'kafka-connect': 70,
  'camel': 65,
};

function getBaseReputation(source) {
  return SOURCE_BASE_REPUTATION[source] ?? 50;
}

/**
 * Calculate a source's reputation score based on historical harvest data.
 *
 * @param {string} source - Source identifier
 * @param {{ successRate: number, avgQuality: number, totalHarvested: number, lastHarvestAge: number }} stats
 * @returns {{ score: number, tier: string, factors: object }}
 */
function calculateSourceReputation(source, stats = {}) {
  const base = getBaseReputation(source);
  const successRate = stats.successRate ?? 1.0;
  const avgQuality = stats.avgQuality ?? 50;
  const totalHarvested = stats.totalHarvested ?? 0;
  const lastHarvestAgeDays = stats.lastHarvestAge ?? 0;

  // Success rate factor: 0-15 points
  const successFactor = Math.round(successRate * 15);

  // Quality factor: 0-15 points (avgQuality is 0-100)
  const qualityFactor = Math.round((avgQuality / 100) * 15);

  // Volume factor: 0-10 points (diminishing returns)
  const volumeFactor = Math.min(Math.round(Math.log2(Math.max(totalHarvested, 1)) * 2), 10);

  // Freshness penalty: 0 to -20 points
  let freshnessPenalty = 0;
  if (lastHarvestAgeDays > 90) freshnessPenalty = -10;
  if (lastHarvestAgeDays > 180) freshnessPenalty = -15;
  if (lastHarvestAgeDays > 365) freshnessPenalty = -20;

  const rawScore = base + successFactor + qualityFactor + volumeFactor + freshnessPenalty;
  const score = Math.max(0, Math.min(100, rawScore));

  let tier;
  if (score >= 80) tier = 'gold';
  else if (score >= 60) tier = 'silver';
  else if (score >= 40) tier = 'bronze';
  else tier = 'untrusted';

  return {
    score,
    tier,
    factors: {
      base,
      successFactor,
      qualityFactor,
      volumeFactor,
      freshnessPenalty,
    },
  };
}

/**
 * Detect if a source is still fresh (has been harvested recently).
 *
 * @param {object} sourceInfo - { last_harvest: ISO string, harvest_interval_hours: number }
 * @returns {{ isFresh: boolean, ageHours: number, overdueHours: number }}
 */
function detectSourceFreshness(sourceInfo) {
  if (!sourceInfo || !sourceInfo.last_harvest) {
    return { isFresh: false, ageHours: Infinity, overdueHours: Infinity };
  }

  const lastHarvest = new Date(sourceInfo.last_harvest);
  if (isNaN(lastHarvest.getTime())) {
    return { isFresh: false, ageHours: Infinity, overdueHours: Infinity };
  }

  const ageMs = Date.now() - lastHarvest.getTime();
  const ageHours = Math.round(ageMs / (1000 * 60 * 60));
  const intervalHours = sourceInfo.harvest_interval_hours || 24;
  const overdueHours = Math.max(0, ageHours - intervalHours);
  const isFresh = ageHours <= intervalHours;

  return { isFresh, ageHours, overdueHours };
}

/**
 * Identify stale sources that haven't been harvested within their schedule.
 *
 * @param {Array<object>} sources - Array of source info objects
 * @param {number} [overdueThresholdHours=48] - Hours overdue before considered stale
 * @returns {Array<object>} Stale sources sorted by overdue hours descending
 */
function findStaleSources(sources, overdueThresholdHours = 48) {
  return sources
    .map(src => {
      const freshness = detectSourceFreshness(src);
      return { ...src, ...freshness };
    })
    .filter(src => src.overdueHours >= overdueThresholdHours)
    .sort((a, b) => b.overdueHours - a.overdueHours);
}

/**
 * Deduplicate sources by canonical URL or identifier.
 * Two sources are duplicates if they point to the same base URL or source_id.
 *
 * @param {Array<object>} sources - Array of { source, url, source_id }
 * @returns {{ unique: Array, duplicates: Array<{ kept: object, removed: object }> }}
 */
function deduplicateSources(sources) {
  const seen = new Map();
  const unique = [];
  const duplicates = [];

  for (const src of sources) {
    const key = normalizeSourceKey(src);
    if (seen.has(key)) {
      const existing = seen.get(key);
      // Keep the one with higher reputation or more recent harvest
      const existingAge = existing.last_harvest ? new Date(existing.last_harvest).getTime() : 0;
      const currentAge = src.last_harvest ? new Date(src.last_harvest).getTime() : 0;
      if (currentAge > existingAge) {
        // Replace: current is newer
        duplicates.push({ kept: src, removed: existing });
        const idx = unique.indexOf(existing);
        if (idx >= 0) unique[idx] = src;
        seen.set(key, src);
      } else {
        duplicates.push({ kept: existing, removed: src });
      }
    } else {
      seen.set(key, src);
      unique.push(src);
    }
  }

  return { unique, duplicates };
}

function normalizeSourceKey(src) {
  if (src.source_id) return `${src.source}:${src.source_id}`;
  if (src.url) {
    // Normalize URL: strip protocol, trailing slash, query params
    return src.url
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '')
      .replace(/\?.*$/, '')
      .toLowerCase();
  }
  return `${src.source}:${src.name || 'unknown'}`;
}


// ── Tests ──────────────────────────────────────────────────────────────────

describe('Source Reputation Scoring', () => {
  describe('getBaseReputation', () => {
    it('returns known reputation for n8n-community', () => {
      assert.equal(getBaseReputation('n8n-community'), 85);
    });

    it('returns known reputation for github', () => {
      assert.equal(getBaseReputation('github'), 75);
    });

    it('returns known reputation for reddit', () => {
      assert.equal(getBaseReputation('reddit'), 40);
    });

    it('returns default 50 for unknown source', () => {
      assert.equal(getBaseReputation('unknown-source'), 50);
    });

    it('returns known reputation for all registered sources', () => {
      for (const [source, expected] of Object.entries(SOURCE_BASE_REPUTATION)) {
        assert.equal(getBaseReputation(source), expected, `Failed for ${source}`);
      }
    });
  });

  describe('calculateSourceReputation', () => {
    it('returns base score with no stats', () => {
      const result = calculateSourceReputation('n8n-community');
      assert.ok(result.score >= 85);
      assert.equal(result.tier, 'gold');
    });

    it('boosts score for high success rate', () => {
      const low = calculateSourceReputation('reddit', { successRate: 0.2 });
      const high = calculateSourceReputation('reddit', { successRate: 1.0 });
      assert.ok(high.score > low.score);
    });

    it('boosts score for high average quality', () => {
      const low = calculateSourceReputation('github', { avgQuality: 20 });
      const high = calculateSourceReputation('github', { avgQuality: 90 });
      assert.ok(high.score > low.score);
    });

    it('boosts score for volume with diminishing returns', () => {
      const none = calculateSourceReputation('github', { totalHarvested: 0 });
      const some = calculateSourceReputation('github', { totalHarvested: 100 });
      const lots = calculateSourceReputation('github', { totalHarvested: 10000 });
      assert.ok(some.score > none.score);
      assert.ok(lots.score >= some.score);
      // Diminishing returns: the difference between 100 and 10000 should be smaller
      // than if it were linear
      assert.ok(lots.factors.volumeFactor <= 10);
    });

    it('applies freshness penalty for old harvests', () => {
      const fresh = calculateSourceReputation('github', { lastHarvestAge: 30 });
      const stale90 = calculateSourceReputation('github', { lastHarvestAge: 100 });
      const stale180 = calculateSourceReputation('github', { lastHarvestAge: 200 });
      const stale365 = calculateSourceReputation('github', { lastHarvestAge: 400 });

      assert.ok(fresh.score > stale90.score);
      assert.ok(stale90.score > stale180.score);
      assert.ok(stale180.score > stale365.score);

      assert.equal(fresh.factors.freshnessPenalty, 0);
      assert.equal(stale90.factors.freshnessPenalty, -10);
      assert.equal(stale180.factors.freshnessPenalty, -15);
      assert.equal(stale365.factors.freshnessPenalty, -20);
    });

    it('clamps score to 0-100 range', () => {
      const maxed = calculateSourceReputation('n8n-community', {
        successRate: 1.0, avgQuality: 100, totalHarvested: 100000,
      });
      assert.ok(maxed.score <= 100);

      const minimal = calculateSourceReputation('reddit', {
        successRate: 0, avgQuality: 0, lastHarvestAge: 500,
      });
      assert.ok(minimal.score >= 0);
    });

    it('assigns gold tier for score >= 80', () => {
      const result = calculateSourceReputation('n8n-community', { successRate: 0.9, avgQuality: 70 });
      assert.equal(result.tier, 'gold');
    });

    it('assigns silver tier for score 60-79', () => {
      const result = calculateSourceReputation('comfyui', { successRate: 0.7, avgQuality: 50 });
      assert.equal(result.tier, 'silver');
    });

    it('assigns bronze tier for score 40-59', () => {
      const result = calculateSourceReputation('reddit', { successRate: 0.5, avgQuality: 30 });
      assert.equal(result.tier, 'bronze');
    });

    it('assigns untrusted tier for score < 40', () => {
      const result = calculateSourceReputation('reddit', {
        successRate: 0, avgQuality: 0, lastHarvestAge: 400,
      });
      assert.equal(result.tier, 'untrusted');
    });

    it('returns factors breakdown', () => {
      const result = calculateSourceReputation('github', {
        successRate: 0.8, avgQuality: 60, totalHarvested: 50, lastHarvestAge: 10,
      });
      assert.ok('base' in result.factors);
      assert.ok('successFactor' in result.factors);
      assert.ok('qualityFactor' in result.factors);
      assert.ok('volumeFactor' in result.factors);
      assert.ok('freshnessPenalty' in result.factors);
    });

    it('handles all sources without error', () => {
      for (const source of Object.keys(SOURCE_BASE_REPUTATION)) {
        const result = calculateSourceReputation(source);
        assert.ok(typeof result.score === 'number', `${source} score should be number`);
        assert.ok(typeof result.tier === 'string', `${source} tier should be string`);
      }
    });
  });
});


describe('Source Freshness Detection', () => {
  function hoursAgo(n) {
    return new Date(Date.now() - n * 60 * 60 * 1000).toISOString();
  }

  describe('detectSourceFreshness', () => {
    it('returns fresh for recent harvest within interval', () => {
      const result = detectSourceFreshness({
        last_harvest: hoursAgo(12),
        harvest_interval_hours: 24,
      });
      assert.equal(result.isFresh, true);
      assert.ok(result.ageHours <= 13);
      assert.equal(result.overdueHours, 0);
    });

    it('returns stale for overdue harvest', () => {
      const result = detectSourceFreshness({
        last_harvest: hoursAgo(72),
        harvest_interval_hours: 24,
      });
      assert.equal(result.isFresh, false);
      assert.ok(result.ageHours >= 71);
      assert.ok(result.overdueHours >= 47);
    });

    it('returns not fresh for null sourceInfo', () => {
      const result = detectSourceFreshness(null);
      assert.equal(result.isFresh, false);
      assert.equal(result.ageHours, Infinity);
    });

    it('returns not fresh for missing last_harvest', () => {
      const result = detectSourceFreshness({ harvest_interval_hours: 24 });
      assert.equal(result.isFresh, false);
      assert.equal(result.ageHours, Infinity);
    });

    it('returns not fresh for invalid date', () => {
      const result = detectSourceFreshness({
        last_harvest: 'not-a-date',
        harvest_interval_hours: 24,
      });
      assert.equal(result.isFresh, false);
    });

    it('uses default 24h interval when not specified', () => {
      const result = detectSourceFreshness({
        last_harvest: hoursAgo(12),
      });
      assert.equal(result.isFresh, true);
    });

    it('exact boundary: age equals interval is still fresh', () => {
      const result = detectSourceFreshness({
        last_harvest: hoursAgo(24),
        harvest_interval_hours: 24,
      });
      assert.equal(result.isFresh, true);
      assert.equal(result.overdueHours, 0);
    });

    it('overdueHours is never negative', () => {
      const result = detectSourceFreshness({
        last_harvest: hoursAgo(1),
        harvest_interval_hours: 48,
      });
      assert.equal(result.overdueHours, 0);
    });
  });
});


describe('Stale Source Handling', () => {
  function hoursAgo(n) {
    return new Date(Date.now() - n * 60 * 60 * 1000).toISOString();
  }

  describe('findStaleSources', () => {
    it('returns sources overdue by more than threshold', () => {
      const sources = [
        { source: 'github', last_harvest: hoursAgo(100), harvest_interval_hours: 24 },
        { source: 'reddit', last_harvest: hoursAgo(10), harvest_interval_hours: 24 },
        { source: 'n8n-community', last_harvest: hoursAgo(200), harvest_interval_hours: 24 },
      ];
      const stale = findStaleSources(sources, 48);
      assert.equal(stale.length, 2);
      assert.equal(stale[0].source, 'n8n-community'); // most overdue first
    });

    it('returns empty when all sources are fresh', () => {
      const sources = [
        { source: 'github', last_harvest: hoursAgo(10), harvest_interval_hours: 24 },
        { source: 'reddit', last_harvest: hoursAgo(5), harvest_interval_hours: 24 },
      ];
      const stale = findStaleSources(sources, 48);
      assert.equal(stale.length, 0);
    });

    it('sorts by overdue hours descending', () => {
      const sources = [
        { source: 'a', last_harvest: hoursAgo(100), harvest_interval_hours: 24 },
        { source: 'b', last_harvest: hoursAgo(200), harvest_interval_hours: 24 },
        { source: 'c', last_harvest: hoursAgo(150), harvest_interval_hours: 24 },
      ];
      const stale = findStaleSources(sources, 48);
      assert.equal(stale[0].source, 'b');
      assert.equal(stale[1].source, 'c');
      assert.equal(stale[2].source, 'a');
    });

    it('handles empty sources array', () => {
      assert.deepEqual(findStaleSources([], 48), []);
    });

    it('uses default threshold of 48 hours', () => {
      const sources = [
        { source: 'a', last_harvest: hoursAgo(80), harvest_interval_hours: 24 },
      ];
      const stale = findStaleSources(sources);
      assert.equal(stale.length, 1);
    });

    it('includes freshness data in output', () => {
      const sources = [
        { source: 'a', last_harvest: hoursAgo(100), harvest_interval_hours: 24 },
      ];
      const stale = findStaleSources(sources, 48);
      assert.ok('isFresh' in stale[0]);
      assert.ok('ageHours' in stale[0]);
      assert.ok('overdueHours' in stale[0]);
      assert.equal(stale[0].isFresh, false);
    });
  });
});


describe('Source Deduplication', () => {
  describe('normalizeSourceKey', () => {
    it('uses source_id when available', () => {
      const key = normalizeSourceKey({ source: 'github', source_id: 'repo/123' });
      assert.equal(key, 'github:repo/123');
    });

    it('normalizes URL by stripping protocol and trailing slash', () => {
      const key = normalizeSourceKey({ source: 'github', url: 'https://github.com/user/repo/' });
      assert.equal(key, 'github.com/user/repo');
    });

    it('strips query params from URL', () => {
      const key = normalizeSourceKey({ source: 'github', url: 'https://example.com/path?foo=bar' });
      assert.equal(key, 'example.com/path');
    });

    it('lowercases URL', () => {
      const key = normalizeSourceKey({ source: 'github', url: 'https://GitHub.com/User/Repo' });
      assert.equal(key, 'github.com/user/repo');
    });

    it('falls back to source:name for no URL or source_id', () => {
      const key = normalizeSourceKey({ source: 'reddit', name: 'my-thread' });
      assert.equal(key, 'reddit:my-thread');
    });

    it('uses unknown when no name either', () => {
      const key = normalizeSourceKey({ source: 'reddit' });
      assert.equal(key, 'reddit:unknown');
    });
  });

  describe('deduplicateSources', () => {
    it('keeps unique sources', () => {
      const sources = [
        { source: 'github', source_id: 'a' },
        { source: 'github', source_id: 'b' },
        { source: 'reddit', source_id: 'c' },
      ];
      const { unique, duplicates } = deduplicateSources(sources);
      assert.equal(unique.length, 3);
      assert.equal(duplicates.length, 0);
    });

    it('removes exact duplicates by source_id', () => {
      const sources = [
        { source: 'github', source_id: 'a', last_harvest: '2026-01-01T00:00:00Z' },
        { source: 'github', source_id: 'a', last_harvest: '2026-02-01T00:00:00Z' },
      ];
      const { unique, duplicates } = deduplicateSources(sources);
      assert.equal(unique.length, 1);
      assert.equal(duplicates.length, 1);
      // Keeps the newer one
      assert.ok(unique[0].last_harvest.includes('2026-02'));
    });

    it('removes duplicates by normalized URL', () => {
      const sources = [
        { source: 'github', url: 'https://github.com/user/repo', last_harvest: '2026-01-01T00:00:00Z' },
        { source: 'github', url: 'http://github.com/user/repo/', last_harvest: '2026-01-15T00:00:00Z' },
      ];
      const { unique, duplicates } = deduplicateSources(sources);
      assert.equal(unique.length, 1);
      assert.equal(duplicates.length, 1);
    });

    it('reports which was kept and which removed', () => {
      const older = { source: 'github', source_id: 'x', last_harvest: '2026-01-01T00:00:00Z' };
      const newer = { source: 'github', source_id: 'x', last_harvest: '2026-03-01T00:00:00Z' };
      const { duplicates } = deduplicateSources([older, newer]);
      assert.equal(duplicates.length, 1);
      assert.equal(duplicates[0].kept, newer);
      assert.equal(duplicates[0].removed, older);
    });

    it('handles empty input', () => {
      const { unique, duplicates } = deduplicateSources([]);
      assert.equal(unique.length, 0);
      assert.equal(duplicates.length, 0);
    });

    it('handles multiple groups of duplicates', () => {
      const sources = [
        { source: 'github', source_id: 'a', last_harvest: '2026-01-01T00:00:00Z' },
        { source: 'github', source_id: 'b', last_harvest: '2026-01-01T00:00:00Z' },
        { source: 'github', source_id: 'a', last_harvest: '2026-02-01T00:00:00Z' },
        { source: 'github', source_id: 'b', last_harvest: '2026-02-01T00:00:00Z' },
      ];
      const { unique, duplicates } = deduplicateSources(sources);
      assert.equal(unique.length, 2);
      assert.equal(duplicates.length, 2);
    });

    it('prefers older entry when newer has no last_harvest', () => {
      const sources = [
        { source: 'github', source_id: 'x', last_harvest: '2026-01-01T00:00:00Z' },
        { source: 'github', source_id: 'x' },
      ];
      const { unique } = deduplicateSources(sources);
      assert.equal(unique.length, 1);
      assert.ok(unique[0].last_harvest);
    });
  });
});
