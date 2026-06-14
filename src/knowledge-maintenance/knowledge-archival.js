// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #877 — Autonomous Knowledge Archival
 *
 * Archives expired, low-quality, or superseded artifacts to maintain
 * a clean, high-quality active knowledge base.
 */

const ARCHIVE_POLICIES = {
  expired: { maxAgeDays: 365, minQuality: 0 },
  low_quality: { maxAgeDays: 0, minQuality: 20 },
  superseded: { maxAgeDays: 0 },
  broken_source: { maxAgeDays: 0 },
};

/**
 * Run the archival process.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ archived: number, summary: object }>}
 */
export async function archiveKnowledge(db, options = {}) {
  const dryRun = options.dryRun || false;
  const policies = options.policies || Object.keys(ARCHIVE_POLICIES);

  let totalArchived = 0;
  const byPolicy = {};

  for (const policy of policies) {
    const count = await applyArchivePolicy(db, policy, dryRun);
    byPolicy[policy] = count;
    totalArchived += count;
  }

  return {
    archived: totalArchived,
    summary: {
      total_archived: totalArchived,
      by_policy: byPolicy,
      dry_run: dryRun,
      archived_at: new Date().toISOString(),
    },
  };
}

async function applyArchivePolicy(db, policy, dryRun) {
  let query, params;

  switch (policy) {
    case 'expired': {
      const cutoff = new Date(Date.now() - ARCHIVE_POLICIES.expired.maxAgeDays * 86400000).toISOString();
      query = `UPDATE artifacts SET type_metadata = COALESCE(type_metadata, '{}'::jsonb) || '{"archived": true, "archive_reason": "expired"}'::jsonb WHERE updated_at < $1 AND (type_metadata->>'archived') IS DISTINCT FROM 'true'`;
      params = [cutoff];
      break;
    }
    case 'low_quality': {
      query = `UPDATE artifacts SET type_metadata = COALESCE(type_metadata, '{}'::jsonb) || '{"archived": true, "archive_reason": "low_quality"}'::jsonb WHERE quality_score IS NOT NULL AND quality_score < $1 AND (type_metadata->>'archived') IS DISTINCT FROM 'true'`;
      params = [ARCHIVE_POLICIES.low_quality.minQuality];
      break;
    }
    case 'superseded': {
      query = `UPDATE artifacts SET type_metadata = COALESCE(type_metadata, '{}'::jsonb) || '{"archived": true, "archive_reason": "superseded"}'::jsonb WHERE type_metadata->>'superseded_by' IS NOT NULL AND (type_metadata->>'archived') IS DISTINCT FROM 'true'`;
      params = [];
      break;
    }
    case 'broken_source': {
      query = `UPDATE artifacts SET type_metadata = COALESCE(type_metadata, '{}'::jsonb) || '{"archived": true, "archive_reason": "broken_source"}'::jsonb WHERE type_metadata->>'broken_links' IS NOT NULL AND (type_metadata->>'archived') IS DISTINCT FROM 'true'`;
      params = [];
      break;
    }
    default:
      return 0;
  }

  if (dryRun) {
    const countQuery = query.replace(/^UPDATE artifacts SET.*WHERE/, 'SELECT COUNT(*)::int AS count FROM artifacts WHERE');
    try {
      const result = await db.query(countQuery, params);
      return result.rows[0]?.count || 0;
    } catch {
      return 0;
    }
  }

  try {
    const result = await db.query(query, params);
    return result.rowCount || 0;
  } catch {
    return 0;
  }
}

/**
 * Get archival statistics.
 */
export async function getArchivalStats(db) {
  try {
    const result = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE type_metadata->>'archived' = 'true')::int AS archived,
         COUNT(*) FILTER (WHERE type_metadata->>'archived' IS DISTINCT FROM 'true')::int AS active,
         COUNT(*)::int AS total
       FROM artifacts`
    );
    return result.rows[0] || { archived: 0, active: 0, total: 0 };
  } catch {
    return { archived: 0, active: 0, total: 0 };
  }
}

export { ARCHIVE_POLICIES };
