// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #887 — Autonomous Knowledge Retention Policy
 *
 * Manages retention policies that determine how long knowledge artifacts
 * are kept based on quality, access frequency, and category importance.
 */

const DEFAULT_POLICIES = {
  high_quality: { minScore: 70, retentionDays: Infinity, description: 'Keep indefinitely' },
  medium_quality: { minScore: 40, retentionDays: 365, description: 'Keep for 1 year' },
  low_quality: { minScore: 0, retentionDays: 180, description: 'Keep for 6 months' },
  unscored: { minScore: null, retentionDays: 90, description: 'Keep for 3 months' },
};

/**
 * Apply retention policies to the knowledge base.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ expired: number, retained: number, summary: object }>}
 */
export async function applyRetentionPolicies(db, options = {}) {
  const policies = options.policies || DEFAULT_POLICIES;
  const dryRun = options.dryRun || false;

  let expired = 0;
  let retained = 0;
  const byPolicy = {};

  for (const [policyName, policy] of Object.entries(policies)) {
    if (policy.retentionDays === Infinity) continue;

    const cutoff = new Date(Date.now() - policy.retentionDays * 86400000).toISOString();
    let query, params;

    if (policy.minScore === null) {
      query = `SELECT COUNT(*)::int AS count FROM artifacts WHERE quality_score IS NULL AND created_at < $1 AND (type_metadata->>'archived') IS DISTINCT FROM 'true'`;
      params = [cutoff];
    } else {
      const maxScore = getMaxScore(policies, policyName);
      query = `SELECT COUNT(*)::int AS count FROM artifacts WHERE quality_score >= $1 AND quality_score < $2 AND created_at < $3 AND (type_metadata->>'archived') IS DISTINCT FROM 'true'`;
      params = [policy.minScore, maxScore, cutoff];
    }

    try {
      const result = await db.query(query, params);
      const count = result.rows[0]?.count || 0;
      byPolicy[policyName] = count;

      if (!dryRun && count > 0) {
        let updateQuery, updateParams;
        if (policy.minScore === null) {
          updateQuery = `UPDATE artifacts SET type_metadata = COALESCE(type_metadata, '{}'::jsonb) || jsonb_build_object('archived', true, 'archive_reason', 'retention_policy', 'policy', $1) WHERE quality_score IS NULL AND created_at < $2 AND (type_metadata->>'archived') IS DISTINCT FROM 'true'`;
          updateParams = [policyName, cutoff];
        } else {
          const maxScore = getMaxScore(policies, policyName);
          updateQuery = `UPDATE artifacts SET type_metadata = COALESCE(type_metadata, '{}'::jsonb) || jsonb_build_object('archived', true, 'archive_reason', 'retention_policy', 'policy', $1) WHERE quality_score >= $2 AND quality_score < $3 AND created_at < $4 AND (type_metadata->>'archived') IS DISTINCT FROM 'true'`;
          updateParams = [policyName, policy.minScore, maxScore, cutoff];
        }
        const updateResult = await db.query(updateQuery, updateParams);
        expired += updateResult.rowCount || 0;
      } else {
        expired += count;
      }
    } catch {
      byPolicy[policyName] = 0;
    }
  }

  // Count retained
  try {
    const totalResult = await db.query(
      `SELECT COUNT(*)::int AS count FROM artifacts WHERE (type_metadata->>'archived') IS DISTINCT FROM 'true'`
    );
    retained = totalResult.rows[0]?.count || 0;
  } catch {
    retained = 0;
  }

  return {
    expired,
    retained,
    summary: {
      expired,
      retained,
      by_policy: byPolicy,
      dry_run: dryRun,
      applied_at: new Date().toISOString(),
    },
  };
}

function getMaxScore(policies, currentPolicy) {
  const sorted = Object.entries(policies)
    .filter(([, p]) => p.minScore !== null)
    .sort((a, b) => a[1].minScore - b[1].minScore);

  const idx = sorted.findIndex(([name]) => name === currentPolicy);
  if (idx >= 0 && idx < sorted.length - 1) {
    return sorted[idx + 1][1].minScore;
  }
  return 101; // Above max
}

/**
 * Get retention status for the knowledge base.
 */
export async function getRetentionStatus(db) {
  try {
    const result = await db.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE (type_metadata->>'archived') = 'true')::int AS archived,
         COUNT(*) FILTER (WHERE (type_metadata->>'archive_reason') = 'retention_policy')::int AS by_retention,
         COUNT(*) FILTER (WHERE quality_score >= 70)::int AS high_quality,
         COUNT(*) FILTER (WHERE quality_score >= 40 AND quality_score < 70)::int AS medium_quality,
         COUNT(*) FILTER (WHERE quality_score < 40)::int AS low_quality
       FROM artifacts`
    );
    return result.rows[0] || {};
  } catch {
    return {};
  }
}

export { DEFAULT_POLICIES };
