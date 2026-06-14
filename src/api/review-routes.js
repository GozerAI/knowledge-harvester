// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Ratings & Reviews API for artifacts.
 *
 * Routes handled:
 *   POST   /api/artifacts/:id/reviews
 *   GET    /api/artifacts/:id/reviews
 *   DELETE /api/reviews/:id
 *   GET    /api/artifacts/:id/rating
 */

import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { parsePagination } from './middleware.js';

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Validate a review body.
 * @param {object} body
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateReview(body) {
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

/**
 * Build a rating distribution map from an array of review rows.
 * @param {{ rating: number }[]} reviews
 * @returns {{ 1: number, 2: number, 3: number, 4: number, 5: number }}
 */
export function calculateRatingDistribution(reviews) {
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const review of reviews) {
    const r = Number(review.rating);
    if (r >= 1 && r <= 5) {
      dist[r]++;
    }
  }
  return dist;
}

// ── Route handlers ────────────────────────────────────────────────────────────

/**
 * POST /api/artifacts/:id/reviews
 */
export async function handleCreateReview(req, res, _params, artifactId) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' });
  }

  const { valid, errors } = validateReview(body);
  if (!valid) {
    return json(res, 400, { error: 'Validation failed', details: errors });
  }

  const { author_name, rating, review_text } = body;

  try {
    const result = await db.query(
      `INSERT INTO artifact_reviews (artifact_id, author_name, rating, review_text)
       VALUES ($1, $2, $3, $4)
       RETURNING id, artifact_id, author_name, rating, review_text, created_at`,
      [artifactId, author_name.trim(), Number(rating), review_text || null]
    );

    logger.info('Review created', { artifact_id: artifactId, review_id: result.rows[0].id });
    return json(res, 201, result.rows[0]);
  } catch (err) {
    logger.error('Failed to create review', { error: err.message });
    return json(res, 500, { error: 'Internal server error' });
  }
}

/**
 * GET /api/artifacts/:id/reviews
 */
export async function handleListReviews(req, res, params, artifactId) {
  const { limit, offset } = parsePagination(params);

  try {
    const countResult = await db.query(
      'SELECT COUNT(*) as count FROM artifact_reviews WHERE artifact_id = $1',
      [artifactId]
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const reviewsResult = await db.query(
      `SELECT id, artifact_id, author_name, rating, review_text, created_at
       FROM artifact_reviews
       WHERE artifact_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [artifactId, limit, offset]
    );

    const avgResult = await db.query(
      'SELECT ROUND(AVG(rating)::numeric, 2) as average_rating FROM artifact_reviews WHERE artifact_id = $1',
      [artifactId]
    );
    const average_rating = avgResult.rows[0].average_rating
      ? parseFloat(avgResult.rows[0].average_rating)
      : null;

    return json(res, 200, {
      total,
      limit,
      offset,
      average_rating,
      reviews: reviewsResult.rows,
    });
  } catch (err) {
    logger.error('Failed to list reviews', { error: err.message });
    return json(res, 500, { error: 'Internal server error' });
  }
}

/**
 * DELETE /api/reviews/:id
 */
export async function handleDeleteReview(req, res, _params, reviewId) {
  try {
    const result = await db.query(
      'DELETE FROM artifact_reviews WHERE id = $1 RETURNING id',
      [reviewId]
    );

    if (result.rows.length === 0) {
      return json(res, 404, { error: 'Review not found' });
    }

    res.writeHead(204);
    res.end();
  } catch (err) {
    logger.error('Failed to delete review', { error: err.message });
    return json(res, 500, { error: 'Internal server error' });
  }
}

/**
 * GET /api/artifacts/:id/rating
 */
export async function handleGetArtifactRating(req, res, _params, artifactId) {
  try {
    const result = await db.query(
      `SELECT rating FROM artifact_reviews WHERE artifact_id = $1`,
      [artifactId]
    );

    const reviews = result.rows;
    const review_count = reviews.length;
    const average_rating = review_count > 0
      ? parseFloat((reviews.reduce((sum, r) => sum + Number(r.rating), 0) / review_count).toFixed(2))
      : null;
    const distribution = calculateRatingDistribution(reviews);

    return json(res, 200, {
      artifact_id: artifactId,
      average_rating,
      review_count,
      distribution,
    });
  } catch (err) {
    logger.error('Failed to get artifact rating', { error: err.message });
    return json(res, 500, { error: 'Internal server error' });
  }
}
