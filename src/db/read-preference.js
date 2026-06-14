// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Collection-level read preference tuning (item #24).
 *
 * Manages read preference policies per collection (table) for PostgreSQL.
 * Supports routing reads to replicas, setting statement timeouts,
 * and configuring work_mem per query class.
 *
 * In a single-node setup these preferences still serve as documented intent
 * and control statement-level session settings.
 */

import { logger } from '../utils/logger.js';

/**
 * @typedef {Object} ReadPreference
 * @property {'primary'|'secondary'|'nearest'} mode
 * @property {number} [statementTimeoutMs] - Per-query timeout
 * @property {string} [workMem] - e.g. '64MB'
 * @property {boolean} [enableSeqscan] - Override enable_seqscan
 * @property {number} [parallelWorkers] - max_parallel_workers_per_gather
 */

/** Default per-collection read preferences */
const DEFAULT_PREFERENCES = {
  artifacts: {
    mode: 'primary',
    statementTimeoutMs: 10000,
    workMem: '32MB',
    enableSeqscan: true,
    parallelWorkers: 2,
  },
  workflows: {
    mode: 'primary',
    statementTimeoutMs: 10000,
    workMem: '32MB',
    enableSeqscan: true,
    parallelWorkers: 2,
  },
  harvest_runs: {
    mode: 'secondary',
    statementTimeoutMs: 5000,
    workMem: '16MB',
    enableSeqscan: true,
    parallelWorkers: 0,
  },
  analytics_events: {
    mode: 'secondary',
    statementTimeoutMs: 15000,
    workMem: '64MB',
    enableSeqscan: true,
    parallelWorkers: 4,
  },
  artifact_duplicates: {
    mode: 'secondary',
    statementTimeoutMs: 30000,
    workMem: '64MB',
    enableSeqscan: false,
    parallelWorkers: 2,
  },
  graph_nodes: {
    mode: 'nearest',
    statementTimeoutMs: 5000,
    workMem: '16MB',
    enableSeqscan: false,
    parallelWorkers: 0,
  },
};

export class ReadPreferenceManager {
  /**
   * @param {object} [overrides] - Per-collection overrides keyed by table name
   */
  constructor(overrides = {}) {
    this._preferences = new Map();

    // Load defaults
    for (const [table, pref] of Object.entries(DEFAULT_PREFERENCES)) {
      this._preferences.set(table, { ...pref });
    }

    // Apply overrides
    for (const [table, pref] of Object.entries(overrides)) {
      const existing = this._preferences.get(table) || {};
      this._preferences.set(table, { ...existing, ...pref });
    }
  }

  /**
   * Get the read preference for a collection.
   * @param {string} collection
   * @returns {ReadPreference}
   */
  getPreference(collection) {
    return this._preferences.get(collection) || {
      mode: 'primary',
      statementTimeoutMs: 10000,
      workMem: '16MB',
      enableSeqscan: true,
      parallelWorkers: 0,
    };
  }

  /**
   * Set or update the read preference for a collection.
   * @param {string} collection
   * @param {Partial<ReadPreference>} pref
   */
  setPreference(collection, pref) {
    const existing = this._preferences.get(collection) || {};
    this._preferences.set(collection, { ...existing, ...pref });
  }

  /**
   * Apply session-level settings for a collection before executing a query.
   * Sets statement_timeout, work_mem, and parallelism hints.
   *
   * @param {object} client - A pg client (from pool.connect())
   * @param {string} collection
   */
  async applySessionSettings(client, collection) {
    const pref = this.getPreference(collection);
    const settings = [];

    if (pref.statementTimeoutMs !== undefined) {
      settings.push(`SET LOCAL statement_timeout = '${pref.statementTimeoutMs}'`);
    }
    if (pref.workMem) {
      settings.push(`SET LOCAL work_mem = '${pref.workMem}'`);
    }
    if (pref.enableSeqscan !== undefined) {
      settings.push(`SET LOCAL enable_seqscan = ${pref.enableSeqscan ? 'on' : 'off'}`);
    }
    if (pref.parallelWorkers !== undefined) {
      settings.push(`SET LOCAL max_parallel_workers_per_gather = ${pref.parallelWorkers}`);
    }

    for (const sql of settings) {
      try {
        await client.query(sql);
      } catch (err) {
        logger.warn('Failed to apply read preference setting', { sql, error: err.message });
      }
    }
  }

  /**
   * Execute a read query with collection-appropriate settings.
   * Acquires a client, applies settings in a transaction, runs the query,
   * then releases.
   *
   * @param {object} db - Pool object with getClient()
   * @param {string} collection
   * @param {string} sql
   * @param {any[]} [params]
   * @returns {Promise<object>} Query result
   */
  async executeRead(db, collection, sql, params = []) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await this.applySessionSettings(client, collection);
      const result = await client.query(sql, params);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Get all configured preferences.
   * @returns {Object<string, ReadPreference>}
   */
  getAllPreferences() {
    const result = {};
    for (const [table, pref] of this._preferences) {
      result[table] = { ...pref };
    }
    return result;
  }

  /**
   * Check if a collection prefers replica reads.
   * @param {string} collection
   * @returns {boolean}
   */
  prefersReplica(collection) {
    const pref = this.getPreference(collection);
    return pref.mode === 'secondary' || pref.mode === 'nearest';
  }
}

let _instance = null;

/**
 * Get the singleton ReadPreferenceManager.
 * @param {object} [overrides]
 * @returns {ReadPreferenceManager}
 */
export function getReadPreferenceManager(overrides) {
  if (!_instance) {
    _instance = new ReadPreferenceManager(overrides);
  }
  return _instance;
}
