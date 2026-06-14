// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Pure function re-implementation (no DB / API deps) ──

const RECENCY_BRACKETS = [
  { maxDays: 7,   points: 40 },
  { maxDays: 30,  points: 30 },
  { maxDays: 90,  points: 20 },
  { maxDays: 180, points: 10 },
  { maxDays: 365, points: 5  },
];

const STAR_BRACKETS = [
  { min: 5000, points: 30 },
  { min: 1001, points: 25 },
  { min: 501,  points: 20 },
  { min: 101,  points: 15 },
  { min: 11,   points: 10 },
  { min: 1,    points: 5  },
  { min: 0,    points: 0  },
];

const FORK_BRACKETS = [
  { min: 101, points: 15 },
  { min: 51,  points: 12 },
  { min: 21,  points: 9  },
  { min: 6,   points: 6  },
  { min: 1,   points: 3  },
  { min: 0,   points: 0  },
];

const ARCHIVED_PENALTY = 20;

function scoreBracket(value, brackets) {
  const n = typeof value === 'number' && !isNaN(value) ? value : 0;
  for (const { min, points } of brackets) {
    if (n >= min) return points;
  }
  return 0;
}

function scoreRecency(lastCommitDate) {
  if (!lastCommitDate) return 0;
  const commitDate = new Date(lastCommitDate);
  if (isNaN(commitDate.getTime())) return 0;
  const ageDays = (Date.now() - commitDate.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays < 0) return 40;
  for (const { maxDays, points } of RECENCY_BRACKETS) {
    if (ageDays < maxDays) return points;
  }
  return 0;
}

function calculateFreshness(repoData = {}) {
  const stars = repoData.stars ?? 0;
  const forks = repoData.forks ?? 0;
  const is_archived = repoData.is_archived ?? false;
  const last_commit = repoData.last_commit ?? null;

  const recencyScore = scoreRecency(last_commit);
  const starScore = scoreBracket(stars, STAR_BRACKETS);
  const forkScore = scoreBracket(forks, FORK_BRACKETS);
  const archivedPenalty = is_archived ? ARCHIVED_PENALTY : 0;

  const raw = recencyScore + starScore + forkScore - archivedPenalty;
  return Math.max(0, Math.min(100, raw));
}

// ── Helpers ──

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}


// ── Perfect freshness ──

describe('calculateFreshness — perfect freshness', () => {
  it('returns maximum possible score (85) for ideal repo', () => {
    // recency(40) + stars(30) + forks(15) = 85; no archived penalty
    const score = calculateFreshness({
      last_commit: daysAgo(1),
      stars: 10000,
      forks: 500,
      is_archived: false,
    });
    assert.equal(score, 85);
  });

  it('score is in range 80-100 for a very fresh, popular repo', () => {
    const score = calculateFreshness({
      last_commit: daysAgo(3),
      stars: 2000,
      forks: 200,
    });
    assert.ok(score >= 80, `Expected >= 80, got ${score}`);
  });
});


// ── Stale repo ──

describe('calculateFreshness — stale repo', () => {
  it('returns 0 for a repo with no activity and no stars', () => {
    const score = calculateFreshness({
      last_commit: daysAgo(400),
      stars: 0,
      forks: 0,
      is_archived: false,
    });
    assert.equal(score, 0);
  });

  it('returns a low score for a repo with no stars and very old commit', () => {
    const score = calculateFreshness({
      last_commit: daysAgo(730),
      stars: 5,
      forks: 2,
    });
    assert.ok(score <= 15, `Expected <= 15, got ${score}`);
  });
});


// ── Archived penalty ──

describe('calculateFreshness — archived penalty', () => {
  it('applies -20 penalty for archived repos', () => {
    const unarchived = calculateFreshness({ last_commit: daysAgo(10), stars: 100, forks: 10, is_archived: false });
    const archived = calculateFreshness({ last_commit: daysAgo(10), stars: 100, forks: 10, is_archived: true });
    assert.equal(unarchived - archived, ARCHIVED_PENALTY);
  });

  it('archived repo with many stars still gets penalized', () => {
    const active = calculateFreshness({ last_commit: daysAgo(5), stars: 8000, forks: 600 });
    const archived = calculateFreshness({ last_commit: daysAgo(5), stars: 8000, forks: 600, is_archived: true });
    assert.ok(archived < active);
    assert.equal(active - archived, ARCHIVED_PENALTY);
  });
});


// ── Recency component ──

describe('calculateFreshness — recency scoring', () => {
  it('scores 40 for commit within 7 days', () => {
    // Isolate recency: stars=0, forks=0
    const score = calculateFreshness({ last_commit: daysAgo(3), stars: 0, forks: 0 });
    assert.equal(score, 40);
  });

  it('scores 30 for commit 7-29 days ago', () => {
    const score = calculateFreshness({ last_commit: daysAgo(15), stars: 0, forks: 0 });
    assert.equal(score, 30);
  });

  it('scores 20 for commit 30-89 days ago', () => {
    const score = calculateFreshness({ last_commit: daysAgo(60), stars: 0, forks: 0 });
    assert.equal(score, 20);
  });

  it('scores 10 for commit 90-179 days ago', () => {
    const score = calculateFreshness({ last_commit: daysAgo(120), stars: 0, forks: 0 });
    assert.equal(score, 10);
  });

  it('scores 5 for commit 180-364 days ago', () => {
    const score = calculateFreshness({ last_commit: daysAgo(270), stars: 0, forks: 0 });
    assert.equal(score, 5);
  });

  it('scores 0 for commit 365+ days ago', () => {
    const score = calculateFreshness({ last_commit: daysAgo(400), stars: 0, forks: 0 });
    assert.equal(score, 0);
  });

  it('boundary: exactly 7 days ago still gets 30 (not 40)', () => {
    // ageDays = 7.0 — fails the < 7 check, falls through to < 30
    const score = calculateFreshness({ last_commit: daysAgo(7), stars: 0, forks: 0 });
    assert.equal(score, 30);
  });

  it('boundary: exactly 365 days ago scores 0', () => {
    const score = calculateFreshness({ last_commit: daysAgo(365), stars: 0, forks: 0 });
    assert.equal(score, 0);
  });
});


// ── Star scoring component ──

describe('calculateFreshness — star scaling', () => {
  it('0 stars = 0 points', () => {
    const score = calculateFreshness({ stars: 0, forks: 0, last_commit: null });
    assert.equal(score, 0);
  });

  it('1-10 stars = 5 points', () => {
    const score = calculateFreshness({ stars: 5, forks: 0, last_commit: null });
    assert.equal(score, 5);
  });

  it('11-100 stars = 10 points', () => {
    const score = calculateFreshness({ stars: 50, forks: 0, last_commit: null });
    assert.equal(score, 10);
  });

  it('101-500 stars = 15 points', () => {
    const score = calculateFreshness({ stars: 300, forks: 0, last_commit: null });
    assert.equal(score, 15);
  });

  it('501-1000 stars = 20 points', () => {
    const score = calculateFreshness({ stars: 750, forks: 0, last_commit: null });
    assert.equal(score, 20);
  });

  it('1001-4999 stars = 25 points', () => {
    const score = calculateFreshness({ stars: 2000, forks: 0, last_commit: null });
    assert.equal(score, 25);
  });

  it('5000+ stars = 30 points', () => {
    const score = calculateFreshness({ stars: 5000, forks: 0, last_commit: null });
    assert.equal(score, 30);
  });
});


// ── Fork scoring component ──

describe('calculateFreshness — fork scaling', () => {
  it('0 forks = 0 points', () => {
    const score = calculateFreshness({ forks: 0, stars: 0, last_commit: null });
    assert.equal(score, 0);
  });

  it('1-5 forks = 3 points', () => {
    const score = calculateFreshness({ forks: 3, stars: 0, last_commit: null });
    assert.equal(score, 3);
  });

  it('6-20 forks = 6 points', () => {
    const score = calculateFreshness({ forks: 10, stars: 0, last_commit: null });
    assert.equal(score, 6);
  });

  it('21-50 forks = 9 points', () => {
    const score = calculateFreshness({ forks: 35, stars: 0, last_commit: null });
    assert.equal(score, 9);
  });

  it('51-100 forks = 12 points', () => {
    const score = calculateFreshness({ forks: 75, stars: 0, last_commit: null });
    assert.equal(score, 12);
  });

  it('100+ forks = 15 points', () => {
    const score = calculateFreshness({ forks: 200, stars: 0, last_commit: null });
    assert.equal(score, 15);
  });
});


// ── Clamping ──

describe('calculateFreshness — score clamping', () => {
  it('never exceeds 100', () => {
    // Max possible = 40 + 30 + 15 = 85; still verify clamp path
    for (let i = 0; i < 5; i++) {
      const score = calculateFreshness({
        last_commit: daysAgo(i),
        stars: 100000,
        forks: 100000,
        is_archived: false,
      });
      assert.ok(score <= 100, `Score ${score} exceeded 100`);
    }
  });

  it('never goes below 0', () => {
    const score = calculateFreshness({
      last_commit: daysAgo(1000),
      stars: 0,
      forks: 0,
      is_archived: true, // penalty can't drive below 0
    });
    assert.ok(score >= 0, `Score ${score} went below 0`);
  });
});


// ── Edge cases ──

describe('calculateFreshness — edge cases', () => {
  it('zero everything returns 0', () => {
    assert.equal(calculateFreshness({ stars: 0, forks: 0, last_commit: null, is_archived: false }), 0);
  });

  it('null last_commit returns 0 recency points', () => {
    const score = calculateFreshness({ last_commit: null, stars: 0, forks: 0 });
    assert.equal(score, 0);
  });

  it('missing fields default to 0', () => {
    assert.equal(calculateFreshness({}), 0);
  });

  it('invalid date string returns 0 recency', () => {
    const score = calculateFreshness({ last_commit: 'not-a-date', stars: 0, forks: 0 });
    assert.equal(score, 0);
  });

  it('archived with high stars still produces lower score than non-archived', () => {
    const active = calculateFreshness({ last_commit: daysAgo(5), stars: 5000, forks: 200, is_archived: false });
    const archived = calculateFreshness({ last_commit: daysAgo(5), stars: 5000, forks: 200, is_archived: true });
    assert.ok(archived < active);
  });
});
