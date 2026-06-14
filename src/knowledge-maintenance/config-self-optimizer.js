// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #943 — Harvester Configuration Self-Optimization
 *
 * Analyzes harvester performance metrics and automatically tunes
 * configuration parameters for optimal throughput and quality.
 */

const DEFAULT_CONFIG = {
  harvest_concurrency: 3,
  batch_size: 50,
  retry_count: 3,
  retry_delay_ms: 1000,
  timeout_ms: 30000,
  quality_threshold: 40,
  freshness_window_days: 90,
  dedup_threshold: 0.85,
};

const CONFIG_BOUNDS = {
  harvest_concurrency: { min: 1, max: 10 },
  batch_size: { min: 10, max: 500 },
  retry_count: { min: 1, max: 5 },
  retry_delay_ms: { min: 500, max: 10000 },
  timeout_ms: { min: 5000, max: 120000 },
  quality_threshold: { min: 20, max: 80 },
  freshness_window_days: { min: 30, max: 365 },
  dedup_threshold: { min: 0.7, max: 0.98 },
};

/**
 * Analyze performance and generate optimized config.
 * @param {object} db
 * @param {object} [currentConfig]
 * @returns {Promise<{ optimized: object, changes: object[], summary: object }>}
 */
export async function optimizeConfig(db, currentConfig = {}) {
  const config = { ...DEFAULT_CONFIG, ...currentConfig };
  const metrics = await gatherPerformanceMetrics(db);
  const changes = [];
  const optimized = { ...config };

  // Optimize concurrency based on error rate
  if (metrics.error_rate > 0.3) {
    const newVal = Math.max(CONFIG_BOUNDS.harvest_concurrency.min, config.harvest_concurrency - 1);
    if (newVal !== config.harvest_concurrency) {
      changes.push({ param: 'harvest_concurrency', from: config.harvest_concurrency, to: newVal, reason: 'High error rate suggests reducing concurrency' });
      optimized.harvest_concurrency = newVal;
    }
  } else if (metrics.error_rate < 0.05 && metrics.avg_duration_ms < config.timeout_ms * 0.5) {
    const newVal = Math.min(CONFIG_BOUNDS.harvest_concurrency.max, config.harvest_concurrency + 1);
    if (newVal !== config.harvest_concurrency) {
      changes.push({ param: 'harvest_concurrency', from: config.harvest_concurrency, to: newVal, reason: 'Low error rate and fast runs allow more concurrency' });
      optimized.harvest_concurrency = newVal;
    }
  }

  // Optimize batch size based on throughput
  if (metrics.avg_items_per_run > config.batch_size * 0.9) {
    const newVal = Math.min(CONFIG_BOUNDS.batch_size.max, Math.round(config.batch_size * 1.5));
    changes.push({ param: 'batch_size', from: config.batch_size, to: newVal, reason: 'Consistently hitting batch limit' });
    optimized.batch_size = newVal;
  } else if (metrics.avg_items_per_run < config.batch_size * 0.3 && config.batch_size > 20) {
    const newVal = Math.max(CONFIG_BOUNDS.batch_size.min, Math.round(config.batch_size * 0.7));
    changes.push({ param: 'batch_size', from: config.batch_size, to: newVal, reason: 'Under-utilizing batch capacity' });
    optimized.batch_size = newVal;
  }

  // Optimize timeout based on actual durations
  if (metrics.p95_duration_ms > config.timeout_ms * 0.8) {
    const newVal = Math.min(CONFIG_BOUNDS.timeout_ms.max, Math.round(config.timeout_ms * 1.3));
    changes.push({ param: 'timeout_ms', from: config.timeout_ms, to: newVal, reason: 'P95 duration approaching timeout limit' });
    optimized.timeout_ms = newVal;
  }

  // Optimize quality threshold based on distribution
  if (metrics.avg_quality > 70 && config.quality_threshold < 50) {
    const newVal = Math.min(CONFIG_BOUNDS.quality_threshold.max, config.quality_threshold + 10);
    changes.push({ param: 'quality_threshold', from: config.quality_threshold, to: newVal, reason: 'Average quality is high, raising threshold' });
    optimized.quality_threshold = newVal;
  }

  // Optimize retry based on success rate
  if (metrics.retry_success_rate < 0.1 && config.retry_count > 1) {
    const newVal = Math.max(CONFIG_BOUNDS.retry_count.min, config.retry_count - 1);
    changes.push({ param: 'retry_count', from: config.retry_count, to: newVal, reason: 'Retries rarely succeed — reducing to save time' });
    optimized.retry_count = newVal;
  }

  // Optimize freshness window based on content age
  if (metrics.stale_pct > 0.5 && config.freshness_window_days > 60) {
    const newVal = Math.max(CONFIG_BOUNDS.freshness_window_days.min, config.freshness_window_days - 15);
    changes.push({ param: 'freshness_window_days', from: config.freshness_window_days, to: newVal, reason: 'Many stale artifacts — tightening freshness window' });
    optimized.freshness_window_days = newVal;
  }

  return {
    optimized,
    changes,
    summary: {
      metrics,
      changes_proposed: changes.length,
      optimized_at: new Date().toISOString(),
    },
  };
}

/**
 * Gather performance metrics from harvest runs.
 */
async function gatherPerformanceMetrics(db) {
  try {
    const runsResult = await db.query(
      `SELECT
         COUNT(*)::int AS total_runs,
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_runs,
         COALESCE(AVG(items_new), 0)::float AS avg_items_per_run,
         COALESCE(AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000), 30000)::float AS avg_duration_ms,
         COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000), 30000)::float AS p95_duration_ms
       FROM harvest_runs
       WHERE started_at > NOW() - INTERVAL '7 days'`
    );

    const qualityResult = await db.query(
      `SELECT COALESCE(AVG(quality_score), 50)::float AS avg_quality FROM artifacts WHERE quality_score IS NOT NULL`
    );

    const stalenessResult = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE updated_at < NOW() - INTERVAL '90 days')::float /
         NULLIF(COUNT(*), 0)::float AS stale_pct
       FROM artifacts`
    );

    const runs = runsResult.rows[0] || {};
    return {
      total_runs: runs.total_runs || 0,
      error_rate: runs.total_runs > 0 ? (runs.failed_runs || 0) / runs.total_runs : 0,
      avg_items_per_run: runs.avg_items_per_run || 0,
      avg_duration_ms: runs.avg_duration_ms || 30000,
      p95_duration_ms: runs.p95_duration_ms || 30000,
      avg_quality: qualityResult.rows[0]?.avg_quality || 50,
      stale_pct: stalenessResult.rows[0]?.stale_pct || 0,
      retry_success_rate: 0.5, // Would need a retry log to compute this properly
    };
  } catch {
    return {
      total_runs: 0, error_rate: 0, avg_items_per_run: 0,
      avg_duration_ms: 30000, p95_duration_ms: 30000,
      avg_quality: 50, stale_pct: 0, retry_success_rate: 0.5,
    };
  }
}

/**
 * Persist optimized config.
 */
export async function persistOptimizedConfig(db, config) {
  try {
    await db.query(
      `INSERT INTO harvester_config (key, value, updated_at)
       VALUES ('optimized_config', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(config)]
    );
    return true;
  } catch {
    return false;
  }
}

export { DEFAULT_CONFIG, CONFIG_BOUNDS, gatherPerformanceMetrics };
