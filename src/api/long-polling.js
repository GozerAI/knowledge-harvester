// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Harvest status long-polling endpoint (item #94).
 *
 * Provides a long-polling mechanism for clients to wait for harvest
 * completion without constant short-polling. The server holds the
 * connection open until the harvest status changes or a timeout occurs.
 */

import { db } from '../db/client.js';
import { json } from './middleware.js';
import { logger } from '../utils/logger.js';

/** Default long-poll timeout in ms (30 seconds) */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Poll interval to check DB for status changes */
const POLL_INTERVAL_MS = 1_000;

/** Active pollers for cleanup on shutdown */
const _activePollers = new Set();

/**
 * GET /api/harvest/:runId/status
 * Long-polling endpoint that waits for harvest status change.
 *
 * Query params:
 *   - timeout: max wait in ms (default 30000, max 60000)
 *   - last_status: client's last known status (triggers wait if unchanged)
 */
export async function handleHarvestStatusPoll(req, res, params, runId) {
  const timeoutMs = Math.min(
    parseInt(params.get('timeout') || String(DEFAULT_TIMEOUT_MS), 10),
    60_000
  );
  const lastStatus = params.get('last_status') || '';

  // First, get current status
  let currentStatus;
  try {
    currentStatus = await getHarvestStatus(runId);
  } catch (err) {
    return json(res, 500, { error: 'Failed to check harvest status' });
  }

  if (!currentStatus) {
    return json(res, 404, { error: 'Harvest run not found' });
  }

  // If status has changed or is terminal, return immediately
  if (currentStatus.status !== lastStatus || isTerminal(currentStatus.status)) {
    return json(res, 200, currentStatus);
  }

  // Long-poll: wait for status change
  const poller = new HarvestPoller(runId, lastStatus, timeoutMs);
  _activePollers.add(poller);

  // Handle client disconnect
  req.on('close', () => {
    poller.cancel();
    _activePollers.delete(poller);
  });

  try {
    const result = await poller.wait();
    _activePollers.delete(poller);
    return json(res, 200, result);
  } catch (err) {
    _activePollers.delete(poller);
    if (err.message === 'timeout') {
      return json(res, 200, {
        ...currentStatus,
        _poll: { timedOut: true, retryAfter: POLL_INTERVAL_MS },
      });
    }
    return json(res, 500, { error: err.message });
  }
}

/**
 * Check if a harvest status is terminal (no more changes expected).
 * @param {string} status
 * @returns {boolean}
 */
function isTerminal(status) {
  return ['completed', 'failed', 'aborted'].includes(status);
}

/**
 * Get current harvest run status from the database.
 * @param {string} runId
 * @returns {Promise<object|null>}
 */
async function getHarvestStatus(runId) {
  const result = await db.query(
    `SELECT id, source, status, items_discovered, items_new,
            items_duplicate, items_invalid, error_message,
            started_at, completed_at
     FROM harvest_runs WHERE id = $1`,
    [runId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    runId: row.id,
    source: row.source,
    status: row.status,
    stats: {
      discovered: row.items_discovered || 0,
      new: row.items_new || 0,
      duplicate: row.items_duplicate || 0,
      invalid: row.items_invalid || 0,
    },
    error: row.error_message || null,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

/**
 * Internal poller that checks status changes on an interval.
 */
class HarvestPoller {
  constructor(runId, lastStatus, timeoutMs) {
    this._runId = runId;
    this._lastStatus = lastStatus;
    this._timeoutMs = timeoutMs;
    this._cancelled = false;
    this._timer = null;
    this._interval = null;
  }

  /**
   * Wait for a status change or timeout.
   * @returns {Promise<object>}
   */
  wait() {
    return new Promise((resolve, reject) => {
      // Timeout
      this._timer = setTimeout(() => {
        this._cleanup();
        reject(new Error('timeout'));
      }, this._timeoutMs);
      if (this._timer.unref) this._timer.unref();

      // Poll
      this._interval = setInterval(async () => {
        if (this._cancelled) {
          this._cleanup();
          reject(new Error('cancelled'));
          return;
        }

        try {
          const status = await getHarvestStatus(this._runId);
          if (!status) {
            this._cleanup();
            reject(new Error('Harvest run not found'));
            return;
          }

          if (status.status !== this._lastStatus || isTerminal(status.status)) {
            this._cleanup();
            resolve(status);
          }
        } catch (err) {
          this._cleanup();
          reject(err);
        }
      }, POLL_INTERVAL_MS);
      if (this._interval.unref) this._interval.unref();
    });
  }

  cancel() {
    this._cancelled = true;
    this._cleanup();
  }

  /** @private */
  _cleanup() {
    if (this._timer) clearTimeout(this._timer);
    if (this._interval) clearInterval(this._interval);
    this._timer = null;
    this._interval = null;
  }
}

/**
 * Cancel all active pollers. Call on server shutdown.
 */
export function cancelAllPollers() {
  for (const poller of _activePollers) {
    poller.cancel();
  }
  _activePollers.clear();
}

export { getHarvestStatus, isTerminal, HarvestPoller };
