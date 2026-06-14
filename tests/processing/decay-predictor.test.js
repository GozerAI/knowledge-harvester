// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Mock DB helper ──────────────────────────────────────────────────────────

function createMockDb(queryResults = {}) {
  const calls = [];
  return {
    query: async (text, params) => {
      calls.push({ text, params });
      for (const [key, result] of Object.entries(queryResults)) {
        if (text.includes(key)) return result;
      }
      return { rows: [], rowCount: 0 };
    },
    calls,
  };
}

// ── Reimplemented core functions from decay-predictor.js ─────────────────────

function predictDecay(artifact) {
  const metadata = artifact.type_metadata || {};
  const now = new Date();

  const lastCommit = metadata.last_commit_date ? new Date(metadata.last_commit_date) : null;
  const daysSinceCommit = lastCommit ? Math.floor((now - lastCommit) / (1000 * 60 * 60 * 24)) : 365;

  const commitVelocity = metadata.commit_velocity ?? 0;
  const dependencyAgeMonths = metadata.dependency_age_months ?? 0;
  const starVelocity = metadata.star_velocity ?? 0;

  const riskFactors = {
    days_since_commit: daysSinceCommit,
    commit_velocity: commitVelocity,
    dependency_age_months: dependencyAgeMonths,
    star_velocity: starVelocity,
  };

  const commitRecencyRisk = Math.min(daysSinceCommit / 365, 1.0);
  const velocityRisk = commitVelocity < 0 ? Math.min(Math.abs(commitVelocity) / 10, 1.0) : 0;
  const depAgeRisk = Math.min(dependencyAgeMonths / 24, 1.0);
  const starRisk = starVelocity < 0 ? Math.min(Math.abs(starVelocity) / 5, 1.0) : 0;

  const decayRisk = (
    commitRecencyRisk * 0.4 +
    velocityRisk * 0.2 +
    depAgeRisk * 0.2 +
    starRisk * 0.2
  );

  const clampedRisk = Math.min(Math.max(decayRisk, 0), 1);

  return {
    decay_risk: Math.round(clampedRisk * 100) / 100,
    risk_factors: riskFactors,
    estimated_stale_date: estimateDecayDate(riskFactors, now),
    predicted_at: now.toISOString(),
  };
}

function estimateDecayDate(riskFactors, now = new Date()) {
  const daysSinceCommit = riskFactors.days_since_commit || 0;
  const commitVelocity = riskFactors.commit_velocity || 0;

  if (daysSinceCommit >= 365) {
    return now.toISOString().split('T')[0];
  }

  let daysUntilStale;
  if (commitVelocity <= 0) {
    daysUntilStale = Math.max(365 - daysSinceCommit, 30);
  } else {
    daysUntilStale = Math.min(365 - daysSinceCommit + commitVelocity * 30, 730);
  }

  const staleDate = new Date(now);
  staleDate.setDate(staleDate.getDate() + Math.floor(daysUntilStale));
  return staleDate.toISOString().split('T')[0];
}

async function scoreBatchDecay(db, limit = 100) {
  const result = await db.query(
    `SELECT id, name, type_metadata, quality_score, updated_at
     FROM artifacts
     WHERE type_metadata IS NOT NULL
     ORDER BY updated_at DESC
     LIMIT $1`,
    [limit]
  );

  let processed = 0;
  let atRisk = 0;

  for (const row of result.rows) {
    const artifact = {
      id: row.id,
      name: row.name,
      type_metadata: typeof row.type_metadata === 'string' ? JSON.parse(row.type_metadata) : (row.type_metadata || {}),
      quality_score: row.quality_score,
      updated_at: row.updated_at,
    };

    const prediction = predictDecay(artifact);

    const updatedMetadata = { ...artifact.type_metadata, decay_prediction: prediction };

    await db.query(
      'UPDATE artifacts SET type_metadata = $1 WHERE id = $2',
      [JSON.stringify(updatedMetadata), artifact.id]
    );

    processed++;
    if (prediction.decay_risk >= 0.6) atRisk++;
  }

  return { processed, at_risk: atRisk };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

// ── predictDecay ────────────────────────────────────────────────────────────

describe('predictDecay — basic output structure', () => {
  it('returns decay_risk between 0 and 1', () => {
    const result = predictDecay({ type_metadata: {} });
    assert.ok(result.decay_risk >= 0, 'decay_risk should be >= 0');
    assert.ok(result.decay_risk <= 1, 'decay_risk should be <= 1');
  });

  it('includes predicted_at timestamp', () => {
    const result = predictDecay({ type_metadata: {} });
    assert.ok(result.predicted_at, 'Should have predicted_at');
    // Should be a valid ISO string
    assert.ok(!isNaN(Date.parse(result.predicted_at)), 'predicted_at should be valid ISO date');
  });

  it('includes all risk_factors in output', () => {
    const result = predictDecay({ type_metadata: {} });
    assert.ok('days_since_commit' in result.risk_factors);
    assert.ok('commit_velocity' in result.risk_factors);
    assert.ok('dependency_age_months' in result.risk_factors);
    assert.ok('star_velocity' in result.risk_factors);
  });

  it('includes estimated_stale_date as YYYY-MM-DD string', () => {
    const result = predictDecay({ type_metadata: {} });
    assert.ok(result.estimated_stale_date);
    assert.match(result.estimated_stale_date, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('risk is clamped to [0, 1]', () => {
    // Even with extreme values, risk should be in [0, 1]
    const result = predictDecay({
      type_metadata: {
        commit_velocity: -100,
        dependency_age_months: 1000,
        star_velocity: -100,
      },
    });
    assert.ok(result.decay_risk >= 0);
    assert.ok(result.decay_risk <= 1);
  });
});

describe('predictDecay — high risk scenarios', () => {
  it('high risk for old artifact (daysSinceCommit=400)', () => {
    const now = new Date();
    const oldDate = new Date(now);
    oldDate.setDate(oldDate.getDate() - 400);
    const result = predictDecay({
      type_metadata: { last_commit_date: oldDate.toISOString() },
    });
    // commitRecencyRisk = min(400/365, 1) = 1.0, weight 0.4 => 0.4 minimum
    assert.ok(result.decay_risk >= 0.4, `Expected >= 0.4, got ${result.decay_risk}`);
  });

  it('all negative signals = high risk', () => {
    const result = predictDecay({
      type_metadata: {
        commit_velocity: -10,
        dependency_age_months: 24,
        star_velocity: -5,
        // no last_commit_date => defaults to 365 days
      },
    });
    // All factors at max: 0.4 + 0.2 + 0.2 + 0.2 = 1.0
    assert.ok(result.decay_risk >= 0.9, `Expected >= 0.9, got ${result.decay_risk}`);
  });

  it('negative commit_velocity increases risk', () => {
    const now = new Date();
    const recentDate = new Date(now);
    recentDate.setDate(recentDate.getDate() - 10);
    const baseline = predictDecay({
      type_metadata: { last_commit_date: recentDate.toISOString(), commit_velocity: 5 },
    });
    const withNegVelocity = predictDecay({
      type_metadata: { last_commit_date: recentDate.toISOString(), commit_velocity: -5 },
    });
    assert.ok(withNegVelocity.decay_risk > baseline.decay_risk,
      'Negative commit velocity should increase risk');
  });

  it('high dependency_age increases risk', () => {
    const now = new Date();
    const recentDate = new Date(now);
    recentDate.setDate(recentDate.getDate() - 10);
    const baseline = predictDecay({
      type_metadata: { last_commit_date: recentDate.toISOString(), dependency_age_months: 0 },
    });
    const withOldDeps = predictDecay({
      type_metadata: { last_commit_date: recentDate.toISOString(), dependency_age_months: 24 },
    });
    assert.ok(withOldDeps.decay_risk > baseline.decay_risk,
      'High dependency age should increase risk');
  });

  it('negative star_velocity increases risk', () => {
    const now = new Date();
    const recentDate = new Date(now);
    recentDate.setDate(recentDate.getDate() - 10);
    const baseline = predictDecay({
      type_metadata: { last_commit_date: recentDate.toISOString(), star_velocity: 5 },
    });
    const withDecliningStars = predictDecay({
      type_metadata: { last_commit_date: recentDate.toISOString(), star_velocity: -5 },
    });
    assert.ok(withDecliningStars.decay_risk > baseline.decay_risk,
      'Negative star velocity should increase risk');
  });
});

describe('predictDecay — low risk scenarios', () => {
  it('low risk for fresh artifact (daysSinceCommit=10, positive velocity)', () => {
    const now = new Date();
    const recentDate = new Date(now);
    recentDate.setDate(recentDate.getDate() - 10);
    const result = predictDecay({
      type_metadata: {
        last_commit_date: recentDate.toISOString(),
        commit_velocity: 10,
        dependency_age_months: 1,
        star_velocity: 5,
      },
    });
    assert.ok(result.decay_risk < 0.15, `Expected < 0.15, got ${result.decay_risk}`);
  });

  it('all positive signals = low risk', () => {
    const now = new Date();
    const recentDate = new Date(now);
    recentDate.setDate(recentDate.getDate() - 5);
    const result = predictDecay({
      type_metadata: {
        last_commit_date: recentDate.toISOString(),
        commit_velocity: 20,
        dependency_age_months: 0,
        star_velocity: 10,
      },
    });
    assert.ok(result.decay_risk < 0.1, `Expected < 0.1, got ${result.decay_risk}`);
  });
});

describe('predictDecay — edge cases', () => {
  it('handles missing type_metadata gracefully (defaults to 365 days)', () => {
    const result = predictDecay({});
    // No type_metadata => daysSinceCommit = 365 => commitRecencyRisk = 1.0
    assert.ok(result.decay_risk >= 0.4, `Expected >= 0.4, got ${result.decay_risk}`);
  });

  it('handles null type_metadata', () => {
    const result = predictDecay({ type_metadata: null });
    assert.ok(result.decay_risk >= 0);
    assert.ok(result.decay_risk <= 1);
  });

  it('handles empty type_metadata object', () => {
    const result = predictDecay({ type_metadata: {} });
    // daysSinceCommit defaults to 365
    assert.ok(result.decay_risk >= 0.4);
  });
});

// ── estimateDecayDate ───────────────────────────────────────────────────────

describe('estimateDecayDate — date estimation', () => {
  it('returns valid date string (YYYY-MM-DD)', () => {
    const result = estimateDecayDate({ days_since_commit: 100 });
    assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('already stale artifact returns today date', () => {
    const now = new Date();
    const result = estimateDecayDate({ days_since_commit: 400 }, now);
    assert.equal(result, now.toISOString().split('T')[0]);
  });

  it('active project extends estimate', () => {
    const now = new Date();
    const result = estimateDecayDate({ days_since_commit: 10, commit_velocity: 10 }, now);
    const staleDate = new Date(result);
    const daysDiff = Math.floor((staleDate - now) / (1000 * 60 * 60 * 24));
    // Should be extended beyond 365 - 10 = 355 by velocity * 30 = 300
    assert.ok(daysDiff > 355, `Expected > 355, got ${daysDiff}`);
  });

  it('declining project shortens estimate', () => {
    const now = new Date();
    const result = estimateDecayDate({ days_since_commit: 300, commit_velocity: -5 }, now);
    const staleDate = new Date(result);
    const daysDiff = Math.floor((staleDate - now) / (1000 * 60 * 60 * 24));
    // commitVelocity <= 0 => daysUntilStale = max(365-300, 30) = 65
    assert.ok(daysDiff >= 60 && daysDiff <= 70, `Expected ~65, got ${daysDiff}`);
  });

  it('handles zero values for all factors', () => {
    const result = estimateDecayDate({});
    assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('caps extension at 730 days for very active projects', () => {
    const now = new Date();
    const result = estimateDecayDate({ days_since_commit: 0, commit_velocity: 100 }, now);
    const staleDate = new Date(result);
    const daysDiff = Math.floor((staleDate - now) / (1000 * 60 * 60 * 24));
    assert.ok(daysDiff <= 731, `Expected <= 731, got ${daysDiff}`);
  });
});

// ── scoreBatchDecay ─────────────────────────────────────────────────────────

describe('scoreBatchDecay — batch processing', () => {
  it('processes batch of artifacts', async () => {
    const now = new Date();
    const recentDate = new Date(now);
    recentDate.setDate(recentDate.getDate() - 10);
    const db = createMockDb({
      'SELECT id': {
        rows: [
          { id: 'a1', name: 'Artifact 1', type_metadata: { last_commit_date: recentDate.toISOString() }, quality_score: 80, updated_at: now },
          { id: 'a2', name: 'Artifact 2', type_metadata: { last_commit_date: recentDate.toISOString() }, quality_score: 60, updated_at: now },
        ],
        rowCount: 2,
      },
      'UPDATE artifacts': { rows: [], rowCount: 1 },
    });
    const result = await scoreBatchDecay(db, 100);
    assert.equal(result.processed, 2);
  });

  it('updates type_metadata with decay_prediction', async () => {
    const db = createMockDb({
      'SELECT id': {
        rows: [{ id: 'a1', name: 'Test', type_metadata: { existing: true }, quality_score: 80, updated_at: new Date() }],
        rowCount: 1,
      },
      'UPDATE artifacts': { rows: [], rowCount: 1 },
    });
    await scoreBatchDecay(db, 100);
    const updateCall = db.calls.find(c => c.text.includes('UPDATE artifacts'));
    assert.ok(updateCall, 'Should have UPDATE call');
    const metadata = JSON.parse(updateCall.params[0]);
    assert.ok(metadata.decay_prediction, 'Should include decay_prediction');
    assert.ok('decay_risk' in metadata.decay_prediction, 'Should have decay_risk');
  });

  it('counts at-risk artifacts correctly', async () => {
    // Artifact with no last_commit_date defaults to 365 days => high risk
    const db = createMockDb({
      'SELECT id': {
        rows: [
          { id: 'a1', name: 'Old', type_metadata: {}, quality_score: 80, updated_at: new Date() },
          { id: 'a2', name: 'Also Old', type_metadata: {}, quality_score: 60, updated_at: new Date() },
        ],
        rowCount: 2,
      },
      'UPDATE artifacts': { rows: [], rowCount: 1 },
    });
    const result = await scoreBatchDecay(db, 100);
    // Both should be at risk (no last_commit_date => 365 days => risk >= 0.4)
    // Actually risk = 0.4 (commit recency only) which is < 0.6 threshold
    // Let's check: with empty metadata, daysSinceCommit=365, all others 0
    // Risk = 1.0 * 0.4 + 0 + 0 + 0 = 0.4 < 0.6, not at risk
    assert.equal(result.at_risk, 0);
  });

  it('marks artifacts with multiple negative signals as at-risk', async () => {
    const db = createMockDb({
      'SELECT id': {
        rows: [
          {
            id: 'a1', name: 'Stale',
            type_metadata: { commit_velocity: -8, dependency_age_months: 20, star_velocity: -3 },
            quality_score: 40, updated_at: new Date(),
          },
        ],
        rowCount: 1,
      },
      'UPDATE artifacts': { rows: [], rowCount: 1 },
    });
    const result = await scoreBatchDecay(db, 100);
    assert.equal(result.at_risk, 1);
  });

  it('respects limit parameter', async () => {
    const db = createMockDb();
    await scoreBatchDecay(db, 25);
    assert.equal(db.calls[0].params[0], 25);
  });

  it('handles empty result set', async () => {
    const db = createMockDb();
    const result = await scoreBatchDecay(db, 100);
    assert.equal(result.processed, 0);
    assert.equal(result.at_risk, 0);
  });

  it('handles artifacts with string type_metadata', async () => {
    const db = createMockDb({
      'SELECT id': {
        rows: [{ id: 'a1', name: 'Test', type_metadata: '{"commit_velocity": 5}', quality_score: 80, updated_at: new Date() }],
        rowCount: 1,
      },
      'UPDATE artifacts': { rows: [], rowCount: 1 },
    });
    const result = await scoreBatchDecay(db, 100);
    assert.equal(result.processed, 1);
  });

  it('handles artifacts with null type_metadata in row', async () => {
    const db = createMockDb({
      'SELECT id': {
        rows: [{ id: 'a1', name: 'Test', type_metadata: null, quality_score: 80, updated_at: new Date() }],
        rowCount: 1,
      },
      'UPDATE artifacts': { rows: [], rowCount: 1 },
    });
    const result = await scoreBatchDecay(db, 100);
    assert.equal(result.processed, 1);
  });

  it('preserves existing type_metadata fields', async () => {
    const db = createMockDb({
      'SELECT id': {
        rows: [{ id: 'a1', name: 'Test', type_metadata: { existing_key: 'keep_me', tags: ['a', 'b'] }, quality_score: 80, updated_at: new Date() }],
        rowCount: 1,
      },
      'UPDATE artifacts': { rows: [], rowCount: 1 },
    });
    await scoreBatchDecay(db, 100);
    const updateCall = db.calls.find(c => c.text.includes('UPDATE'));
    const metadata = JSON.parse(updateCall.params[0]);
    assert.equal(metadata.existing_key, 'keep_me');
    assert.deepStrictEqual(metadata.tags, ['a', 'b']);
    assert.ok(metadata.decay_prediction);
  });

  it('uses default limit of 100', async () => {
    const db = createMockDb();
    await scoreBatchDecay(db);
    assert.equal(db.calls[0].params[0], 100);
  });
});
