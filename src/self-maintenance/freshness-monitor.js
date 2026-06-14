// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #867 — Knowledge Freshness Monitoring
 *
 * Monitors content age across the knowledge base, classifies artifacts
 * into freshness buckets, and generates staleness alerts when thresholds
 * are exceeded.
 */

const AGE_BUCKETS = { fresh: 30, recent: 90, aging: 180, stale: 365 };

/**
 * Classify an artifact's age into a freshness bucket.
 * @param {number} ageDays
 * @returns {string}
 */
export function classifyAge(ageDays) {
  for (const [key, max] of Object.entries(AGE_BUCKETS)) {
    if (ageDays <= max) return key;
  }
  return 'expired';
}

/**
 * Generate staleness alerts from bucket distribution.
 * @param {object} buckets - { fresh: { count }, stale: { count }, ... }
 * @returns {object[]}
 */
export function generateAlerts(buckets) {
  const alerts = [];
  const total = Object.values(buckets).reduce((s, b) => s + (b.count || 0), 0);
  if (total === 0) return alerts;

  const stalePct = ((buckets.stale?.count || 0) + (buckets.expired?.count || 0)) / total;
  if (stalePct > 0.5) {
    alerts.push({ level: 'critical', message: `${Math.round(stalePct * 100)}% stale` });
  } else if (stalePct > 0.3) {
    alerts.push({ level: 'warning', message: `${Math.round(stalePct * 100)}% stale` });
  }

  const expiredPct = (buckets.expired?.count || 0) / total;
  if (expiredPct > 0.2) {
    alerts.push({ level: 'warning', message: `${Math.round(expiredPct * 100)}% expired` });
  }

  return alerts;
}

/**
 * Run freshness monitoring scan on the knowledge base.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ buckets: object, alerts: object[], summary: object }>}
 */
export async function monitorFreshness(db, options = {}) {
  const result = await db.query(
    `SELECT id, name, primary_category, artifact_type, updated_at,
            EXTRACT(EPOCH FROM (NOW() - updated_at)) / 86400 AS age_days
     FROM artifacts ORDER BY updated_at ASC`
  );

  const buckets = { fresh: { count: 0, items: [] }, recent: { count: 0, items: [] },
    aging: { count: 0, items: [] }, stale: { count: 0, items: [] }, expired: { count: 0, items: [] } };

  for (const row of result.rows) {
    const age = Math.round(row.age_days || 0);
    const bucket = classifyAge(age);
    buckets[bucket].count++;
    if (buckets[bucket].items.length < 10) {
      buckets[bucket].items.push({ id: row.id, name: row.name, age_days: age });
    }
  }

  const alerts = generateAlerts(buckets);

  return {
    buckets,
    alerts,
    summary: {
      total: result.rows.length,
      distribution: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.count])),
      alert_count: alerts.length,
      monitored_at: new Date().toISOString(),
    },
  };
}

/**
 * Get per-category freshness breakdown.
 * @param {object} db
 * @returns {Promise<object[]>}
 */
export async function getCategoryFreshness(db) {
  const result = await db.query(
    `SELECT primary_category,
            COUNT(*)::int AS total,
            ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - updated_at)) / 86400)::numeric, 1)::float AS avg_age_days,
            MAX(updated_at) AS newest,
            MIN(updated_at) AS oldest
     FROM artifacts WHERE primary_category IS NOT NULL
     GROUP BY primary_category ORDER BY avg_age_days DESC`
  );
  return result.rows.map(r => ({
    ...r,
    freshness_status: classifyAge(Math.round(r.avg_age_days)),
  }));
}

export { AGE_BUCKETS };
