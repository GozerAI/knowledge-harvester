// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Reimplemented pure functions from trendscope-client.js ──────────────────

const CATEGORY_MAP = {
  'ai-agent': 'technology',
  'ai-image-generation': 'technology',
  'ml-data-ops': 'technology',
  'streaming-realtime': 'technology',
  'ci-cd-pipeline': 'technology',
  'devops-monitoring': 'technology',
  'infrastructure-as-code': 'technology',
  'security-automation': 'technology',
  'ecommerce': 'ecommerce',
  'lead-gen-crm': 'business',
  'finance-accounting': 'business',
  'business-process': 'business',
  'customer-support': 'consumer',
  'general-productivity': 'consumer',
  'iot-home-automation': 'consumer',
  'data-pipeline': 'niche_market',
  'data-processing': 'niche_market',
  'orchestration': 'niche_market',
  'integration-pipeline': 'niche_market',
  'multi-step-automation': 'emerging',
  'content-marketing': 'emerging',
};

function mapCategory(khCategory) {
  return CATEGORY_MAP[khCategory] || 'technology';
}

// ── Reimplemented from relation-builder.js ───────────────────────────────────

function calculateTagOverlap(tagsA, tagsB) {
  if (!Array.isArray(tagsA) || !Array.isArray(tagsB) || tagsA.length === 0 || tagsB.length === 0) {
    return { overlap_count: 0, overlap_ratio: 0 };
  }
  const setA = new Set(tagsA);
  let overlap_count = 0;
  for (const tag of tagsB) {
    if (setA.has(tag)) overlap_count++;
  }
  const union = new Set([...tagsA, ...tagsB]).size;
  const overlap_ratio = union === 0 ? 0 : overlap_count / union;
  return { overlap_count, overlap_ratio };
}

// ── Reimplemented from trend-enricher.js ─────────────────────────────────────

const MATCH_THRESHOLD = 1;

const SIGNAL_PRIORITY = { strong_buy: 5, buy: 4, hold: 3, sell: 2, strong_sell: 1 };

function sortBySignalPriority(signals) {
  return [...signals].sort((a, b) => (SIGNAL_PRIORITY[b.signal] || 0) - (SIGNAL_PRIORITY[a.signal] || 0));
}

function matchTrends(artifactTags, trendEntries) {
  const matchedSignals = [];
  for (const trend of trendEntries) {
    const { overlap_count } = calculateTagOverlap(artifactTags, trend.keywords);
    if (overlap_count >= MATCH_THRESHOLD) {
      matchedSignals.push({
        trend_name: trend.name,
        signal: trend.signal,
        velocity: trend.velocity,
        momentum: trend.momentum,
        matched_at: new Date().toISOString(),
      });
    }
  }
  return sortBySignalPriority(matchedSignals);
}

// ── Reimplemented from recommender.js ────────────────────────────────────────

function applyTrendBoost(baseScore, marketplaceMetadata) {
  if (!marketplaceMetadata) return baseScore;
  const trendSignals = marketplaceMetadata.trend_signals;
  if (!Array.isArray(trendSignals) || trendSignals.length === 0) return baseScore;
  const hasBuySignal = trendSignals.some(
    s => s.signal === 'buy' || s.signal === 'strong_buy'
  );
  if (hasBuySignal) {
    return Math.min(1.0, baseScore + 0.1);
  }
  return baseScore;
}

// ── Category Mapping Tests ──────────────────────────────────────────────────

describe('mapCategory — all 21 KH categories map correctly', () => {
  it('ai-agent → technology', () => assert.equal(mapCategory('ai-agent'), 'technology'));
  it('ai-image-generation → technology', () => assert.equal(mapCategory('ai-image-generation'), 'technology'));
  it('ml-data-ops → technology', () => assert.equal(mapCategory('ml-data-ops'), 'technology'));
  it('streaming-realtime → technology', () => assert.equal(mapCategory('streaming-realtime'), 'technology'));
  it('ci-cd-pipeline → technology', () => assert.equal(mapCategory('ci-cd-pipeline'), 'technology'));
  it('devops-monitoring → technology', () => assert.equal(mapCategory('devops-monitoring'), 'technology'));
  it('infrastructure-as-code → technology', () => assert.equal(mapCategory('infrastructure-as-code'), 'technology'));
  it('security-automation → technology', () => assert.equal(mapCategory('security-automation'), 'technology'));
  it('ecommerce → ecommerce', () => assert.equal(mapCategory('ecommerce'), 'ecommerce'));
  it('lead-gen-crm → business', () => assert.equal(mapCategory('lead-gen-crm'), 'business'));
  it('finance-accounting → business', () => assert.equal(mapCategory('finance-accounting'), 'business'));
  it('business-process → business', () => assert.equal(mapCategory('business-process'), 'business'));
  it('customer-support → consumer', () => assert.equal(mapCategory('customer-support'), 'consumer'));
  it('general-productivity → consumer', () => assert.equal(mapCategory('general-productivity'), 'consumer'));
  it('iot-home-automation → consumer', () => assert.equal(mapCategory('iot-home-automation'), 'consumer'));
  it('data-pipeline → niche_market', () => assert.equal(mapCategory('data-pipeline'), 'niche_market'));
  it('data-processing → niche_market', () => assert.equal(mapCategory('data-processing'), 'niche_market'));
  it('orchestration → niche_market', () => assert.equal(mapCategory('orchestration'), 'niche_market'));
  it('integration-pipeline → niche_market', () => assert.equal(mapCategory('integration-pipeline'), 'niche_market'));
  it('multi-step-automation → emerging', () => assert.equal(mapCategory('multi-step-automation'), 'emerging'));
  it('content-marketing → emerging', () => assert.equal(mapCategory('content-marketing'), 'emerging'));
});

describe('mapCategory — fallback', () => {
  it('unknown category falls back to technology', () => {
    assert.equal(mapCategory('unknown-category'), 'technology');
  });

  it('empty string falls back to technology', () => {
    assert.equal(mapCategory(''), 'technology');
  });
});

// ── Match Threshold Tests ───────────────────────────────────────────────────

describe('MATCH_THRESHOLD behavior', () => {
  const trend = { name: 'Test Trend', signal: 'buy', velocity: 0.5, momentum: 0.8, keywords: ['automation', 'workflow'] };

  it('overlap of 0 produces no match', () => {
    const result = matchTrends(['unrelated', 'tags'], [trend]);
    assert.equal(result.length, 0);
  });

  it('overlap of 1 produces a match', () => {
    const result = matchTrends(['automation', 'unrelated'], [trend]);
    assert.equal(result.length, 1);
    assert.equal(result[0].trend_name, 'Test Trend');
  });

  it('overlap of 2 also produces a match', () => {
    const result = matchTrends(['automation', 'workflow'], [trend]);
    assert.equal(result.length, 1);
  });
});

// ── Signal Sorting Tests ────────────────────────────────────────────────────

describe('signal priority sorting', () => {
  it('strong_buy sorts before buy', () => {
    const signals = [
      { signal: 'buy', trend_name: 'B' },
      { signal: 'strong_buy', trend_name: 'SB' },
    ];
    const sorted = sortBySignalPriority(signals);
    assert.equal(sorted[0].trend_name, 'SB');
    assert.equal(sorted[1].trend_name, 'B');
  });

  it('full priority order: strong_buy > buy > hold > sell > strong_sell', () => {
    const signals = [
      { signal: 'strong_sell', trend_name: 'SS' },
      { signal: 'hold', trend_name: 'H' },
      { signal: 'strong_buy', trend_name: 'SB' },
      { signal: 'sell', trend_name: 'S' },
      { signal: 'buy', trend_name: 'B' },
    ];
    const sorted = sortBySignalPriority(signals);
    assert.equal(sorted[0].trend_name, 'SB');
    assert.equal(sorted[1].trend_name, 'B');
    assert.equal(sorted[2].trend_name, 'H');
    assert.equal(sorted[3].trend_name, 'S');
    assert.equal(sorted[4].trend_name, 'SS');
  });

  it('unknown signals sort to the end (priority 0)', () => {
    const signals = [
      { signal: 'hold', trend_name: 'H' },
      { signal: 'unknown', trend_name: 'U' },
    ];
    const sorted = sortBySignalPriority(signals);
    assert.equal(sorted[0].trend_name, 'H');
    assert.equal(sorted[1].trend_name, 'U');
  });
});

// ── Multiple Trends Matching Same Artifact ──────────────────────────────────

describe('multiple trends matching same artifact', () => {
  it('returns all matching trends', () => {
    const trends = [
      { name: 'AI Agents', signal: 'strong_buy', velocity: 0.9, momentum: 0.8, keywords: ['agent', 'ai'] },
      { name: 'Automation', signal: 'buy', velocity: 0.6, momentum: 0.5, keywords: ['automation', 'workflow'] },
      { name: 'Blockchain', signal: 'sell', velocity: 0.2, momentum: 0.1, keywords: ['blockchain', 'crypto'] },
    ];
    const result = matchTrends(['agent', 'automation', 'pipeline'], trends);
    assert.equal(result.length, 2);
    // strong_buy should come first
    assert.equal(result[0].signal, 'strong_buy');
    assert.equal(result[1].signal, 'buy');
  });
});

// ── Empty Inputs ────────────────────────────────────────────────────────────

describe('empty inputs', () => {
  it('empty tags produce no matches', () => {
    const trends = [
      { name: 'T1', signal: 'buy', velocity: 0, momentum: 0, keywords: ['test'] },
    ];
    const result = matchTrends([], trends);
    assert.equal(result.length, 0);
  });

  it('empty trend entries produce no matches', () => {
    const result = matchTrends(['automation', 'workflow'], []);
    assert.equal(result.length, 0);
  });
});

// ── Tag Overlap Integration ─────────────────────────────────────────────────

describe('calculateTagOverlap integration', () => {
  it('identical arrays have full overlap', () => {
    const { overlap_count, overlap_ratio } = calculateTagOverlap(['a', 'b', 'c'], ['a', 'b', 'c']);
    assert.equal(overlap_count, 3);
    assert.equal(overlap_ratio, 1.0);
  });

  it('disjoint arrays have zero overlap', () => {
    const { overlap_count, overlap_ratio } = calculateTagOverlap(['a', 'b'], ['c', 'd']);
    assert.equal(overlap_count, 0);
    assert.equal(overlap_ratio, 0);
  });

  it('partial overlap calculates correctly', () => {
    const { overlap_count } = calculateTagOverlap(['a', 'b', 'c'], ['b', 'c', 'd']);
    assert.equal(overlap_count, 2);
  });

  it('null input returns zero overlap', () => {
    const { overlap_count } = calculateTagOverlap(null, ['a']);
    assert.equal(overlap_count, 0);
  });
});

// ── applyTrendBoost Tests ───────────────────────────────────────────────────

describe('applyTrendBoost — no metadata', () => {
  it('returns base score when marketplace_metadata is null', () => {
    assert.equal(applyTrendBoost(0.7, null), 0.7);
  });

  it('returns base score when marketplace_metadata is undefined', () => {
    assert.equal(applyTrendBoost(0.5, undefined), 0.5);
  });
});

describe('applyTrendBoost — no trend_signals', () => {
  it('returns base score when trend_signals is missing', () => {
    assert.equal(applyTrendBoost(0.6, {}), 0.6);
  });

  it('returns base score when trend_signals is not an array', () => {
    assert.equal(applyTrendBoost(0.6, { trend_signals: 'invalid' }), 0.6);
  });
});

describe('applyTrendBoost — empty trend_signals array', () => {
  it('returns base score for empty array', () => {
    assert.equal(applyTrendBoost(0.7, { trend_signals: [] }), 0.7);
  });
});

describe('applyTrendBoost — buy signal', () => {
  it('adds 0.1 boost for buy signal', () => {
    const meta = { trend_signals: [{ signal: 'buy' }] };
    assert.ok(Math.abs(applyTrendBoost(0.7, meta) - 0.8) < 1e-10);
  });
});

describe('applyTrendBoost — strong_buy signal', () => {
  it('adds 0.1 boost for strong_buy signal', () => {
    const meta = { trend_signals: [{ signal: 'strong_buy' }] };
    assert.ok(Math.abs(applyTrendBoost(0.7, meta) - 0.8) < 1e-10);
  });
});

describe('applyTrendBoost — hold signal', () => {
  it('no boost for hold signal', () => {
    const meta = { trend_signals: [{ signal: 'hold' }] };
    assert.equal(applyTrendBoost(0.7, meta), 0.7);
  });
});

describe('applyTrendBoost — sell signal', () => {
  it('no boost for sell signal', () => {
    const meta = { trend_signals: [{ signal: 'sell' }] };
    assert.equal(applyTrendBoost(0.7, meta), 0.7);
  });
});

describe('applyTrendBoost — caps at 1.0', () => {
  it('does not exceed 1.0 when base score is 0.95', () => {
    const meta = { trend_signals: [{ signal: 'buy' }] };
    assert.equal(applyTrendBoost(0.95, meta), 1.0);
  });

  it('does not exceed 1.0 when base score is 1.0', () => {
    const meta = { trend_signals: [{ signal: 'strong_buy' }] };
    assert.equal(applyTrendBoost(1.0, meta), 1.0);
  });
});

// ── Graceful Handling When Trendscope Unreachable ────────────────────────────

describe('graceful degradation — empty results', () => {
  it('matchTrends returns empty array when no trends provided', () => {
    const result = matchTrends(['automation', 'workflow', 'ai'], []);
    assert.equal(result.length, 0);
  });

  it('matchTrends returns empty array when tags are empty', () => {
    const trends = [
      { name: 'T', signal: 'buy', velocity: 0, momentum: 0, keywords: ['ai'] },
    ];
    const result = matchTrends([], trends);
    assert.equal(result.length, 0);
  });
});
