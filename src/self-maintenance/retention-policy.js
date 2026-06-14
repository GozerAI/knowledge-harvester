// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #887 — Retention Policy Enforcement
 *
 * Enforces retention policies that determine how long artifacts are kept
 * based on quality scores, access patterns, and content freshness.
 */

const DEFAULT_POLICIES = {
  high_quality: { minScore: 70, retentionDays: Infinity },
  medium_quality: { minScore: 40, retentionDays: 365 },
  low_quality: { minScore: 0, retentionDays: 180 },
  unscored: { minScore: null, retentionDays: 90 },
};

/**
 * Classify an artifact into a retention tier.
 * @param {object} artifact
 * @param {object} [policies]
 * @returns {string}
 */
export function classifyRetentionTier(artifact, policies = DEFAULT_POLICIES) {
  const score = artifact.quality_score;
  if (score == null) return 'unscored';
  if (score >= policies.high_quality.minScore) return 'high_quality';
  if (score >= policies.medium_quality.minScore) return 'medium_quality';
  return 'low_quality';
}

/**
 * Check if an artifact has exceeded its retention period.
 * @param {object} artifact
 * @param {object} [policies]
 * @returns {{ expired: boolean, tier: string, retentionDays: number, ageDays: number }}
 */
export function checkRetention(artifact, policies = DEFAULT_POLICIES) {
  const tier = classifyRetentionTier(artifact, policies);
  const retentionDays = policies[tier].retentionDays;
  const ageDays = artifact.updated_at
    ? (Date.now() - new Date(artifact.updated_at).getTime()) / 86400000 : 0;

  return {
    expired: retentionDays !== Infinity && ageDays > retentionDays,
    tier,
    retentionDays,
    ageDays: Math.round(ageDays),
  };
}

/**
 * Enforce retention policies across the knowledge base.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ expired: object[], summary: object }>}
 */
export async function enforceRetention(db, options = {}) {
  const policies = options.policies || DEFAULT_POLICIES;
  const dryRun = options.dryRun !== false;

  const result = await db.query(
    `SELECT id, name, quality_score, updated_at FROM artifacts
     WHERE (archived IS NULL OR archived = false)
     ORDER BY updated_at ASC`
  );

  const expired = [];
  for (const artifact of result.rows) {
    const check = checkRetention(artifact, policies);
    if (check.expired) {
      expired.push({
        id: artifact.id,
        name: artifact.name,
        tier: check.tier,
        age_days: check.ageDays,
        retention_days: check.retentionDays,
      });
    }
  }

  let archived = 0;
  if (!dryRun && expired.length > 0) {
    const ids = expired.map(e => e.id);
    const archiveResult = await db.query(
      `UPDATE artifacts SET archived = true, archived_reason = 'retention_policy'
       WHERE id = ANY($1)`,
      [ids]
    );
    archived = archiveResult.rowCount || 0;
  }

  return {
    expired,
    summary: {
      total_scanned: result.rows.length,
      expired_count: expired.length,
      archived_count: archived,
      dry_run: dryRun,
      enforced_at: new Date().toISOString(),
    },
  };
}

export { DEFAULT_POLICIES };
