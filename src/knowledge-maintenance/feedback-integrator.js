// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #888 — Autonomous Knowledge Feedback Integration
 *
 * Integrates feedback signals (quality reports, user ratings, usage data)
 * into artifact quality scores and metadata.
 */

const FEEDBACK_TYPES = ['quality_report', 'user_rating', 'usage_signal', 'deprecation_notice', 'correction'];

/**
 * Process and integrate feedback into the knowledge base.
 * @param {object} db
 * @param {object[]} feedbackItems
 * @param {object} [options]
 * @returns {Promise<{ processed: number, applied: number, summary: object }>}
 */
export async function integrateFeedback(db, feedbackItems, options = {}) {
  let processed = 0;
  let applied = 0;

  for (const item of feedbackItems) {
    if (!isValidFeedback(item)) continue;
    processed++;

    const result = await applyFeedback(db, item);
    if (result.applied) applied++;
  }

  return {
    processed,
    applied,
    summary: {
      total_received: feedbackItems.length,
      valid: processed,
      applied,
      by_type: countBy(feedbackItems.filter(f => isValidFeedback(f)), 'type'),
      integrated_at: new Date().toISOString(),
    },
  };
}

function isValidFeedback(item) {
  return item && item.artifact_id && item.type && FEEDBACK_TYPES.includes(item.type);
}

async function applyFeedback(db, item) {
  try {
    switch (item.type) {
      case 'user_rating': {
        const rating = Number(item.value);
        if (isNaN(rating) || rating < 1 || rating > 5) return { applied: false };
        // Blend user rating into quality score (20% weight)
        await db.query(
          `UPDATE artifacts
           SET quality_score = ROUND((COALESCE(quality_score, 50) * 0.8 + ($1 * 20) * 0.2)::numeric),
               type_metadata = COALESCE(type_metadata, '{}'::jsonb) || jsonb_build_object('last_rating', $1, 'rated_at', $2)
           WHERE id = $3`,
          [rating, new Date().toISOString(), item.artifact_id]
        );
        return { applied: true };
      }
      case 'quality_report': {
        await db.query(
          `UPDATE artifacts
           SET type_metadata = COALESCE(type_metadata, '{}'::jsonb) || jsonb_build_object('quality_report', $1, 'reported_at', $2)
           WHERE id = $3`,
          [item.value || item.details, new Date().toISOString(), item.artifact_id]
        );
        return { applied: true };
      }
      case 'deprecation_notice': {
        await db.query(
          `UPDATE artifacts
           SET type_metadata = COALESCE(type_metadata, '{}'::jsonb) || jsonb_build_object('deprecated', true, 'deprecation_reason', $1, 'deprecated_at', $2)
           WHERE id = $3`,
          [item.value || 'deprecated', new Date().toISOString(), item.artifact_id]
        );
        return { applied: true };
      }
      case 'correction': {
        if (item.field && item.value) {
          // Only allow safe fields
          const safeFields = ['name', 'description', 'primary_category'];
          if (safeFields.includes(item.field)) {
            await db.query(
              `UPDATE artifacts SET ${item.field} = $1, updated_at = NOW() WHERE id = $2`,
              [item.value, item.artifact_id]
            );
            return { applied: true };
          }
        }
        return { applied: false };
      }
      case 'usage_signal': {
        await db.query(
          `UPDATE artifacts
           SET type_metadata = COALESCE(type_metadata, '{}'::jsonb) ||
               jsonb_build_object('usage_count', COALESCE((type_metadata->>'usage_count')::int, 0) + 1, 'last_used', $1)
           WHERE id = $2`,
          [new Date().toISOString(), item.artifact_id]
        );
        return { applied: true };
      }
      default:
        return { applied: false };
    }
  } catch {
    return { applied: false };
  }
}

function countBy(arr, field) {
  const c = {};
  for (const item of arr) { c[item[field]] = (c[item[field]] || 0) + 1; }
  return c;
}

export { FEEDBACK_TYPES, isValidFeedback };
