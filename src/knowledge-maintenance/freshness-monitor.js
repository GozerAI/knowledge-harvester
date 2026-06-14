// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #867 — Autonomous Knowledge Freshness Monitoring
 *
 * Continuous monitoring of artifact freshness with alerts for content
 * that is becoming stale, trend detection, and automatic refresh scheduling.
 */

const FRESHNESS_BUCKETS = {
  fresh: { maxDays: 30, label: 'Fresh' },
  recent: { maxDays: 90, label: 'Recent' },
  aging: { maxDays: 180, label: 'Aging' },
  stale: { maxDays: 365, label: 'Stale' },
  expired: { maxDays: Infinity, label: 'Expired' },
};

/**
 * Monitor freshness across the knowledge base.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function monitorFreshness(db, options = {}) {
  const buckets = await getBucketDistribution(db);
  const alerts = generateAlerts(buckets);
  const categoryFreshness = await getCategoryFreshness(db);
  const trends = await getFreshnessTrends(db, options.trendDays || 30);

  return {
    buckets,
    alerts,
    category_freshness: categoryFreshness,
    trends,
    summary: {
      total_monitored: Object.values(buckets).reduce((s, b) => s + b.count, 0),
      alert_count: alerts.length,
      critical_alerts: alerts.filter(a => a.level === 'critical').length,
      freshest_category: categoryFreshness[0]?.category || null,
      stalest_category: categoryFreshness[categoryFreshness.length - 1]?.category || null,
      monitored_at: new Date().toISOString(),
    },
  };
}

async function getBucketDistribution(db) {
  const now = new Date();
  const result = {};

  for (const [key, bucket] of Object.entries(FRESHNESS_BUCKETS)) {
    const minDate = bucket.maxDays === Infinity
      ? null
      : new Date(now - bucket.maxDays * 86400000);
    const prevBucket = getPreviousBucket(key);
    const maxDate = prevBucket
      ? new Date(now - FRESHNESS_BUCKETS[prevBucket].maxDays * 86400000)
      : null;

    let query, params;
    if (!minDate) {
      query = `SELECT COUNT(*)::int AS count FROM artifacts WHERE updated_at < $1`;
      params = [maxDate.toISOString()];
    } else if (!maxDate) {
      query = `SELECT COUNT(*)::int AS count FROM artifacts WHERE updated_at >= $1`;
      params = [minDate.toISOString()];
    } else {
      query = `SELECT COUNT(*)::int AS count FROM artifacts WHERE updated_at < $1 AND updated_at >= $2`;
      params = [maxDate.toISOString(), minDate.toISOString()];
    }

    const r = await db.query(query, params);
    result[key] = { count: r.rows[0]?.count || 0, label: bucket.label };
  }

  return result;
}

function getPreviousBucket(key) {
  const keys = Object.keys(FRESHNESS_BUCKETS);
  const idx = keys.indexOf(key);
  return idx > 0 ? keys[idx - 1] : null;
}

function generateAlerts(buckets) {
  const alerts = [];
  const total = Object.values(buckets).reduce((s, b) => s + b.count, 0);
  if (total === 0) return alerts;

  const stalePct = ((buckets.stale?.count || 0) + (buckets.expired?.count || 0)) / total;
  if (stalePct > 0.5) {
    alerts.push({ level: 'critical', message: `${Math.round(stalePct * 100)}% of content is stale or expired` });
  } else if (stalePct > 0.3) {
    alerts.push({ level: 'warning', message: `${Math.round(stalePct * 100)}% of content is stale or expired` });
  }

  if ((buckets.expired?.count || 0) > 100) {
    alerts.push({ level: 'critical', message: `${buckets.expired.count} artifacts are expired (>1 year old)` });
  }

  const freshPct = (buckets.fresh?.count || 0) / total;
  if (freshPct < 0.1) {
    alerts.push({ level: 'warning', message: 'Less than 10% of content is fresh (updated in last 30 days)' });
  }

  return alerts;
}

async function getCategoryFreshness(db) {
  const result = await db.query(
    `SELECT primary_category AS category,
            COUNT(*)::int AS total,
            ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - updated_at)) / 86400)::numeric, 1)::float AS avg_age_days,
            MIN(updated_at) AS oldest,
            MAX(updated_at) AS newest
     FROM artifacts
     WHERE primary_category IS NOT NULL
     GROUP BY primary_category
     ORDER BY avg_age_days ASC`
  );
  return result.rows;
}

async function getFreshnessTrends(db, days) {
  const result = await db.query(
    `SELECT DATE(updated_at) AS date, COUNT(*)::int AS updates
     FROM artifacts
     WHERE updated_at > NOW() - $1 * INTERVAL '1 day'
     GROUP BY DATE(updated_at)
     ORDER BY date`,
    [days]
  );
  return result.rows;
}

export { FRESHNESS_BUCKETS, generateAlerts, classifyAge };

/**
 * Classify an age in days into a freshness bucket.
 */
function classifyAge(ageDays) {
  for (const [key, bucket] of Object.entries(FRESHNESS_BUCKETS)) {
    if (ageDays <= bucket.maxDays) return key;
  }
  return 'expired';
}
