// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { db } from '../db/client.js';
import { logOperationSafely } from '../db/operation-log-store.js';
import { logger } from '../utils/logger.js';
import { randomUUID } from 'node:crypto';

/**
 * Base harvester class for artifact-type harvesters.
 * Same contract as BaseHarvester but stores to the artifacts table.
 *
 * Subclasses override _harvest(signal) and call storeArtifact()
 * instead of storeWorkflow().
 */
export class ArtifactBaseHarvester {
  /**
   * @param {string} source - Source identifier
   * @param {string} artifactType - One of ARTIFACT_TYPES
   * @param {import('../utils/rate-limiter.js').RateLimiter} rateLimiter
   */
  constructor(source, artifactType, rateLimiter) {
    this.source = source;
    this.artifactType = artifactType;
    this.rateLimiter = rateLimiter;
    this.abortController = new AbortController();
    this.stats = {
      discovered: 0,
      new: 0,
      duplicate: 0,
      invalid: 0,
      errors: 0,
    };
    this.runId = null;
    this.maxConsecutiveErrors = 10;
    this.consecutiveErrors = 0;
  }

  async run() {
    this.runId ||= randomUUID();
    await db.query(
      `INSERT INTO harvest_runs (id, source, status, metadata)
       VALUES ($1, $2, 'running', $3)`,
      [this.runId, this.source, JSON.stringify({ artifact_type: this.artifactType })]
    );
    logger.info('Artifact harvest run started', {
      source: this.source,
      artifactType: this.artifactType,
      runId: this.runId,
    });

    try {
      await this._harvest(this.abortController.signal);
      await this._completeRun('completed');
      logger.info('Artifact harvest run completed', { source: this.source, ...this.stats });
    } catch (err) {
      if (err.name === 'AbortError') {
        await this._completeRun('aborted');
        logger.warn('Artifact harvest run aborted', { source: this.source, ...this.stats });
        await logOperationSafely({
          level: 'warn',
          category: 'harvest',
          eventType: 'harvest.run.aborted',
          message: `Artifact harvest run aborted for ${this.source}`,
          source: this.source,
          runId: this.runId,
          error: err,
          metadata: {
            artifact_type: this.artifactType,
            stats: this.stats,
          },
        });
      } else {
        await this._completeRun('failed', err.message);
        logger.error('Artifact harvest run failed', { source: this.source, error: err.message });
        await logOperationSafely({
          level: 'error',
          category: 'harvest',
          eventType: 'harvest.run.failed',
          message: `Artifact harvest run failed for ${this.source}`,
          source: this.source,
          runId: this.runId,
          error: err,
          metadata: {
            artifact_type: this.artifactType,
            stats: this.stats,
          },
        });
        throw err;
      }
    }

    return this.stats;
  }

  abort() {
    this.abortController.abort();
  }

  recordError(err) {
    this.stats.errors++;
    this.consecutiveErrors++;
    logger.warn('Artifact harvest item error', {
      source: this.source,
      error: err.message,
      consecutiveErrors: this.consecutiveErrors,
    });
    logOperationSafely({
      level: 'warn',
      category: 'harvest',
      eventType: 'harvest.item.error',
      message: `Artifact harvest item error for ${this.source}`,
      source: this.source,
      runId: this.runId,
      error: err,
      metadata: {
        artifact_type: this.artifactType,
        consecutive_errors: this.consecutiveErrors,
        stats: this.stats,
      },
    });
    if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
      logger.error('Too many consecutive errors, aborting', {
        count: this.consecutiveErrors,
      });
      logOperationSafely({
        level: 'error',
        category: 'harvest',
        eventType: 'harvest.abort.threshold_exceeded',
        message: `Artifact harvest aborted after too many consecutive errors for ${this.source}`,
        source: this.source,
        runId: this.runId,
        metadata: {
          artifact_type: this.artifactType,
          consecutive_errors: this.consecutiveErrors,
          max_consecutive_errors: this.maxConsecutiveErrors,
        },
      });
      this.abort();
    }
  }

  resetConsecutiveErrors() {
    this.consecutiveErrors = 0;
  }

  async _completeRun(status, errorMessage = null) {
    try {
      await db.query(
        `UPDATE harvest_runs SET
          completed_at = NOW(), status = $1,
          items_discovered = $2, items_new = $3,
          items_duplicate = $4, items_invalid = $5,
          error_message = $6
        WHERE id = $7`,
        [
          status,
          this.stats.discovered,
          this.stats.new,
          this.stats.duplicate,
          this.stats.invalid,
          errorMessage,
          this.runId,
        ]
      );
    } catch (dbErr) {
      logger.error('Failed to update harvest run', { error: dbErr.message });
    }
  }

  async _harvest(signal) {
    throw new Error('Subclasses must implement _harvest()');
  }
}
