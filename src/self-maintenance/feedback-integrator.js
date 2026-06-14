// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #888 — Feedback Integration Loop
 *
 * Integrates feedback signals (quality reports, user ratings, usage signals,
 * deprecation notices, corrections) back into artifact quality scoring.
 */

const FEEDBACK_TYPES = [
  'quality_report',
  'user_rating',
  'usage_signal',
  'deprecation_notice',
  'correction',
];

const FEEDBACK_WEIGHTS = {
  quality_report: 0.3,
  user_rating: 0.25,
  usage_signal: 0.2,
  deprecation_notice: 0.15,
  correction: 0.1,
};

/**
 * Validate a feedback item.
 * @param {object} item
 * @returns {boolean}
 */
export function isValidFeedback(item) {
  return item != null && !!item.artifact_id && !!item.type && FEEDBACK_TYPES.includes(item.type);
}

/**
 * Compute quality adjustment from feedback.
 * @param {object} feedback
 * @returns {number} adjustment (-20 to +20)
 */
export function computeAdjustment(feedback) {
  const weight = FEEDBACK_WEIGHTS[feedback.type] || 0.1;
  let base = 0;

  switch (feedback.type) {
    case 'user_rating':
      // Rating 1-5 maps to -10 to +10
      base = ((feedback.value || 3) - 3) * 5;
      break;
    case 'quality_report':
      base = feedback.value === 'good' ? 5 : feedback.value === 'poor' ? -10 : 0;
      break;
    case 'usage_signal':
      base = Math.min((feedback.value || 0) * 0.5, 10);
      break;
    case 'deprecation_notice':
      base = -15;
      break;
    case 'correction':
      base = -5; // Correction means something was wrong
      break;
  }

  return Math.round(base * weight * 10) / 10;
}

/**
 * Record a feedback item.
 * @param {object} db
 * @param {object} feedbackItem
 * @returns {Promise<{ recorded: boolean }>}
 */
export async function recordFeedback(db, feedbackItem) {
  if (!isValidFeedback(feedbackItem)) return { recorded: false };

  try {
    await db.query(
      `INSERT INTO feedback (artifact_id, type, value, metadata, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [feedbackItem.artifact_id, feedbackItem.type,
       JSON.stringify(feedbackItem.value), JSON.stringify(feedbackItem.metadata || {})]
    );
    return { recorded: true };
  } catch {
    return { recorded: false };
  }
}

/**
 * Process pending feedback and adjust quality scores.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ processed: number, adjustments: object[], summary: object }>}
 */
export async function processFeedback(db, options = {}) {
  const limit = options.limit || 100;

  try {
    const result = await db.query(
      `SELECT id, artifact_id, type, value FROM feedback
       WHERE processed = false ORDER BY created_at ASC LIMIT $1`,
      [limit]
    );

    const adjustments = [];
    for (const fb of result.rows) {
      const adj = computeAdjustment(fb);
      if (adj !== 0) {
        await db.query(
          `UPDATE artifacts SET quality_score = LEAST(100, GREATEST(0, COALESCE(quality_score, 50) + $1))
           WHERE id = $2`,
          [adj, fb.artifact_id]
        );
        adjustments.push({ artifact_id: fb.artifact_id, adjustment: adj, feedback_type: fb.type });
      }
      await db.query(`UPDATE feedback SET processed = true WHERE id = $1`, [fb.id]);
    }

    return {
      processed: result.rows.length,
      adjustments,
      summary: {
        total_processed: result.rows.length,
        adjustments_applied: adjustments.length,
        processed_at: new Date().toISOString(),
      },
    };
  } catch {
    return { processed: 0, adjustments: [], summary: { error: 'feedback_table_not_found' } };
  }
}

export { FEEDBACK_TYPES, FEEDBACK_WEIGHTS };
