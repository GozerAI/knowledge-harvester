// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for review-routes.js logic.
 *
 * Since review-routes.js imports db/client.js (which requires PG env vars),
 * we follow the established project pattern of reimplementing pure functions
 * locally for unit testing — identical logic, no DB dependency.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Reimplemented from review-routes.js ──────────────────────────────────────

function validateReview(body) {
  const errors = [];

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: ['Request body must be a JSON object'] };
  }

  if (!body.author_name || typeof body.author_name !== 'string' || body.author_name.trim() === '') {
    errors.push('author_name is required');
  }

  if (body.rating === undefined || body.rating === null || body.rating === '') {
    errors.push('rating is required');
  } else {
    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      errors.push('rating must be an integer between 1 and 5');
    }
  }

  return { valid: errors.length === 0, errors };
}

function calculateRatingDistribution(reviews) {
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const review of reviews) {
    const r = Number(review.rating);
    if (r >= 1 && r <= 5) {
      dist[r]++;
    }
  }
  return dist;
}

// ── validateReview ────────────────────────────────────────────────────────────

describe('validateReview', () => {
  it('accepts a valid review with all fields', () => {
    const result = validateReview({ author_name: 'Alice', rating: 4, review_text: 'Great!' });
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it('accepts a valid review without optional review_text', () => {
    const result = validateReview({ author_name: 'Bob', rating: 5 });
    assert.equal(result.valid, true);
  });

  it('rejects missing author_name', () => {
    const result = validateReview({ rating: 3 });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('author_name')));
  });

  it('rejects empty string author_name', () => {
    const result = validateReview({ author_name: '   ', rating: 3 });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('author_name')));
  });

  it('rejects missing rating', () => {
    const result = validateReview({ author_name: 'Alice' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('rating is required')));
  });

  it('rejects rating of 0', () => {
    const result = validateReview({ author_name: 'Alice', rating: 0 });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('between 1 and 5')));
  });

  it('rejects rating of 6', () => {
    const result = validateReview({ author_name: 'Alice', rating: 6 });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('between 1 and 5')));
  });

  it('rejects negative rating', () => {
    const result = validateReview({ author_name: 'Alice', rating: -1 });
    assert.equal(result.valid, false);
  });

  it('rejects non-integer rating (float)', () => {
    const result = validateReview({ author_name: 'Alice', rating: 3.5 });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('integer')));
  });

  it('rejects non-object body (array)', () => {
    const result = validateReview([{ author_name: 'Alice', rating: 3 }]);
    assert.equal(result.valid, false);
  });

  it('rejects null body', () => {
    const result = validateReview(null);
    assert.equal(result.valid, false);
  });

  it('collects multiple errors at once', () => {
    const result = validateReview({});
    assert.equal(result.valid, false);
    assert.ok(result.errors.length >= 2);
  });

  it('treats rating of "3" (string coercing to integer) as valid', () => {
    // Number("3") === 3, Number.isInteger(3) === true
    const result = validateReview({ author_name: 'Alice', rating: '3' });
    assert.equal(result.valid, true);
  });

  it('rejects rating of "abc"', () => {
    const result = validateReview({ author_name: 'Alice', rating: 'abc' });
    assert.equal(result.valid, false);
  });
});

// ── calculateRatingDistribution ───────────────────────────────────────────────

describe('calculateRatingDistribution', () => {
  it('returns all zeros for an empty array', () => {
    const dist = calculateRatingDistribution([]);
    assert.deepEqual(dist, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  });

  it('counts a single 5-star review', () => {
    const dist = calculateRatingDistribution([{ rating: 5 }]);
    assert.deepEqual(dist, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 });
  });

  it('counts mixed ratings correctly', () => {
    const reviews = [
      { rating: 1 }, { rating: 5 }, { rating: 3 },
      { rating: 5 }, { rating: 2 }, { rating: 3 },
    ];
    const dist = calculateRatingDistribution(reviews);
    assert.deepEqual(dist, { 1: 1, 2: 1, 3: 2, 4: 0, 5: 2 });
  });

  it('counts when all reviews are the same rating', () => {
    const reviews = [{ rating: 4 }, { rating: 4 }, { rating: 4 }];
    const dist = calculateRatingDistribution(reviews);
    assert.deepEqual(dist, { 1: 0, 2: 0, 3: 0, 4: 3, 5: 0 });
  });

  it('ignores out-of-range ratings', () => {
    const dist = calculateRatingDistribution([{ rating: 0 }, { rating: 6 }, { rating: -1 }]);
    assert.deepEqual(dist, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  });
});

// ── Pagination logic ──────────────────────────────────────────────────────────

describe('review list pagination logic', () => {
  function applyPagination(total, limit, offset) {
    const clampedLimit = Math.min(Math.max(1, limit), 100);
    const clampedOffset = Math.max(0, offset);
    const hasMore = clampedOffset + clampedLimit < total;
    return { limit: clampedLimit, offset: clampedOffset, hasMore };
  }

  it('first page with default limit', () => {
    const { limit, offset, hasMore } = applyPagination(50, 20, 0);
    assert.equal(limit, 20);
    assert.equal(offset, 0);
    assert.equal(hasMore, true);
  });

  it('last page has no more items', () => {
    const { hasMore } = applyPagination(15, 20, 0);
    assert.equal(hasMore, false);
  });

  it('clamps limit to 100', () => {
    const { limit } = applyPagination(200, 500, 0);
    assert.equal(limit, 100);
  });

  it('offset beyond total still resolves without error', () => {
    const { hasMore } = applyPagination(5, 20, 100);
    assert.equal(hasMore, false);
  });
});

// ── Rating average logic ──────────────────────────────────────────────────────

describe('rating average calculation logic', () => {
  function calcAverage(reviews) {
    if (reviews.length === 0) return null;
    const sum = reviews.reduce((acc, r) => acc + Number(r.rating), 0);
    return parseFloat((sum / reviews.length).toFixed(2));
  }

  it('returns null when there are no reviews', () => {
    assert.equal(calcAverage([]), null);
  });

  it('returns exact rating for a single review', () => {
    assert.equal(calcAverage([{ rating: 4 }]), 4);
  });

  it('calculates correct average for mixed ratings', () => {
    const reviews = [{ rating: 1 }, { rating: 5 }, { rating: 3 }];
    assert.equal(calcAverage(reviews), 3.0);
  });

  it('rounds to 2 decimal places', () => {
    const reviews = [{ rating: 1 }, { rating: 2 }];
    assert.equal(calcAverage(reviews), 1.5);
  });

  it('handles all 5-star reviews', () => {
    const reviews = [{ rating: 5 }, { rating: 5 }, { rating: 5 }];
    assert.equal(calcAverage(reviews), 5.0);
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('review edge cases', () => {
  it('validateReview accepts very long review_text without validation error', () => {
    const longText = 'A'.repeat(10000);
    const result = validateReview({ author_name: 'Alice', rating: 3, review_text: longText });
    assert.equal(result.valid, true);
  });

  it('validateReview accepts special characters in author_name', () => {
    const result = validateReview({ author_name: "O'Brien & <test>", rating: 2 });
    assert.equal(result.valid, true);
  });

  it('validateReview rejects rating of null', () => {
    const result = validateReview({ author_name: 'Alice', rating: null });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('rating is required')));
  });
});
