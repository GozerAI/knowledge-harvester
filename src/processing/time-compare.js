// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Time-Window Comparisons — compare artifact metrics across time periods.
 *
 * Supports arbitrary windows, this-vs-last convenience, and velocity reports.
 */

/**
 * Compare artifacts created/updated in two time windows.
 * @param {object} db
 * @param {{ start: string, end: string }} windowA
 * @param {{ start: string, end: string }} windowB
 * @returns {Promise<object>}
 */
export async function compareWindows(db, windowA, windowB) {
  const queryWindow = async (w) => {
    const result = await db.query(
      `SELECT primary_category,
              COUNT(*)::int AS count,
              ROUND(AVG(quality_score)::numeric, 2)::float AS avg_quality
       FROM artifacts
       WHERE (created_at >= $1 AND created_at < $2)
          OR (updated_at >= $1 AND updated_at < $2)
       GROUP BY primary_category
       ORDER BY primary_category`,
      [w.start, w.end]
    );
    return result.rows;
  };

  const dataA = await queryWindow(windowA);
  const dataB = await queryWindow(windowB);

  const mapA = new Map(dataA.map(r => [r.primary_category, r]));
  const mapB = new Map(dataB.map(r => [r.primary_category, r]));

  const allCategories = new Set([...mapA.keys(), ...mapB.keys()]);
  const comparison = [];

  for (const cat of allCategories) {
    const a = mapA.get(cat) || { count: 0, avg_quality: 0 };
    const b = mapB.get(cat) || { count: 0, avg_quality: 0 };
    comparison.push({
      primary_category: cat,
      window_a: { count: a.count, avg_quality: a.avg_quality },
      window_b: { count: b.count, avg_quality: b.avg_quality },
      count_delta: b.count - a.count,
      quality_delta: Math.round((b.avg_quality - a.avg_quality) * 100) / 100,
    });
  }

  return {
    window_a: windowA,
    window_b: windowB,
    comparison,
    total_a: dataA.reduce((s, r) => s + r.count, 0),
    total_b: dataB.reduce((s, r) => s + r.count, 0),
  };
}

/**
 * Convenience: compare current period vs previous period.
 * @param {object} db
 * @param {'day'|'week'|'month'} [period='week']
 * @returns {Promise<object>}
 */
export async function thisVsLast(db, period = 'week') {
  const now = new Date();
  let currentStart, previousStart, previousEnd;

  if (period === 'day') {
    currentStart = new Date(now);
    currentStart.setHours(0, 0, 0, 0);
    previousEnd = new Date(currentStart);
    previousStart = new Date(previousEnd);
    previousStart.setDate(previousStart.getDate() - 1);
  } else if (period === 'month') {
    currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
    previousEnd = new Date(currentStart);
    previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  } else {
    // week
    const dayOfWeek = now.getDay();
    currentStart = new Date(now);
    currentStart.setDate(now.getDate() - dayOfWeek);
    currentStart.setHours(0, 0, 0, 0);
    previousEnd = new Date(currentStart);
    previousStart = new Date(currentStart);
    previousStart.setDate(previousStart.getDate() - 7);
  }

  if (!previousEnd) previousEnd = new Date(currentStart);

  return compareWindows(
    db,
    { start: previousStart.toISOString(), end: previousEnd.toISOString() },
    { start: currentStart.toISOString(), end: now.toISOString() }
  );
}

/**
 * Growth velocity report per category for a given period.
 * @param {object} db
 * @param {'day'|'week'|'month'} [period='week']
 * @returns {Promise<object>}
 */
export async function velocityReport(db, period = 'week') {
  const comparison = await thisVsLast(db, period);
  const velocities = comparison.comparison.map(c => {
    const previous = c.window_a.count;
    const current = c.window_b.count;
    const rate = previous > 0 ? (current - previous) / previous : (current > 0 ? 1 : 0);

    return {
      primary_category: c.primary_category,
      previous_count: previous,
      current_count: current,
      growth_rate: Math.round(rate * 10000) / 10000,
    };
  });

  velocities.sort((a, b) => b.growth_rate - a.growth_rate);

  return {
    period,
    velocities,
  };
}
