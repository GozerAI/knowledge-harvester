// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Parallel artifact processing with worker pools (item #134),
 * Incremental processing with checkpointing (item #140),
 * Artifact enrichment pipeline with fan-out/fan-in (item #148),
 * Priority queue for high-value artifact processing (item #154).
 */

import { logger } from '../utils/logger.js';

// ── Worker Pool (#134) ──────────────────────────────────────────────────────

/**
 * Concurrent worker pool for parallel artifact processing.
 * Controls concurrency, tracks completion, supports abort.
 */
export class WorkerPool {
  /**
   * @param {object} [options]
   * @param {number} [options.concurrency=4] - Max parallel workers
   * @param {string} [options.name='default'] - Pool name for logging
   * @param {Function} [options.onTaskComplete] - Callback per completed task
   * @param {Function} [options.onTaskError] - Callback per failed task
   */
  constructor({
    concurrency = 4,
    name = 'default',
    onTaskComplete = null,
    onTaskError = null,
  } = {}) {
    this._concurrency = concurrency;
    this._name = name;
    this._onTaskComplete = onTaskComplete;
    this._onTaskError = onTaskError;
    this._active = 0;
    this._completed = 0;
    this._failed = 0;
    this._queue = [];
    this._aborted = false;
    this._drainResolvers = [];
  }

  /**
   * Submit a task to the pool. Returns a promise that resolves when the task finishes.
   * @param {Function} taskFn - Async function to execute
   * @param {*} [context] - Optional context passed to callbacks
   * @returns {Promise<*>} Task result
   */
  submit(taskFn, context = null) {
    if (this._aborted) {
      return Promise.reject(new Error('Worker pool has been aborted'));
    }

    return new Promise((resolve, reject) => {
      const task = { fn: taskFn, context, resolve, reject };

      if (this._active < this._concurrency) {
        this._runTask(task);
      } else {
        this._queue.push(task);
      }
    });
  }

  /**
   * Process an array of items through a worker function.
   * @param {Array} items
   * @param {Function} workerFn - Async function(item) => result
   * @returns {Promise<Array<{ item: *, result?: *, error?: string }>>}
   */
  async map(items, workerFn) {
    const results = [];
    const promises = items.map((item, idx) =>
      this.submit(() => workerFn(item))
        .then(result => { results[idx] = { item, result }; })
        .catch(err => { results[idx] = { item, error: err.message }; })
    );

    await Promise.all(promises);
    return results;
  }

  /** @private */
  async _runTask(task) {
    this._active++;
    try {
      const result = await task.fn();
      this._completed++;
      if (this._onTaskComplete) {
        try { this._onTaskComplete(result, task.context); } catch {}
      }
      task.resolve(result);
    } catch (err) {
      this._failed++;
      if (this._onTaskError) {
        try { this._onTaskError(err, task.context); } catch {}
      }
      task.reject(err);
    } finally {
      this._active--;
      this._processNext();
    }
  }

  /** @private */
  _processNext() {
    if (this._aborted) return;

    if (this._queue.length > 0 && this._active < this._concurrency) {
      const next = this._queue.shift();
      this._runTask(next);
    }

    if (this._active === 0 && this._queue.length === 0) {
      for (const resolve of this._drainResolvers) {
        resolve();
      }
      this._drainResolvers = [];
    }
  }

  /**
   * Wait until all submitted tasks have completed.
   * @returns {Promise<void>}
   */
  drain() {
    if (this._active === 0 && this._queue.length === 0) {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      this._drainResolvers.push(resolve);
    });
  }

  /**
   * Abort all pending tasks. In-flight tasks will still complete.
   */
  abort() {
    this._aborted = true;
    for (const task of this._queue) {
      task.reject(new Error('Worker pool aborted'));
    }
    this._queue = [];
  }

  getStats() {
    return {
      name: this._name,
      concurrency: this._concurrency,
      active: this._active,
      queued: this._queue.length,
      completed: this._completed,
      failed: this._failed,
    };
  }

  get active() { return this._active; }
  get queued() { return this._queue.length; }
}

// ── Checkpoint Manager (#140) ───────────────────────────────────────────────

/**
 * Incremental processing with checkpoints.
 * Tracks last-processed position so processing can resume after interruption.
 */
export class CheckpointManager {
  /**
   * @param {object} [options]
   * @param {object} [options.db] - Database client for persistent checkpoints
   * @param {string} [options.namespace='default'] - Checkpoint namespace
   */
  constructor({ db = null, namespace = 'default' } = {}) {
    this._db = db;
    this._namespace = namespace;
    /** @type {Map<string, object>} In-memory checkpoints */
    this._checkpoints = new Map();
  }

  /**
   * Save a checkpoint for a given processing job.
   * @param {string} jobId
   * @param {object} state - Checkpoint state (offset, cursor, etc.)
   */
  async save(jobId, state) {
    const checkpoint = {
      jobId,
      namespace: this._namespace,
      state,
      savedAt: new Date().toISOString(),
    };

    this._checkpoints.set(jobId, checkpoint);

    if (this._db) {
      try {
        await this._db.query(
          `INSERT INTO processing_checkpoints (job_id, namespace, state, saved_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (job_id, namespace) DO UPDATE
           SET state = $3, saved_at = NOW()`,
          [jobId, this._namespace, JSON.stringify(state)]
        );
      } catch {
        // In-memory fallback
      }
    }
  }

  /**
   * Load the last checkpoint for a job.
   * @param {string} jobId
   * @returns {Promise<object|null>}
   */
  async load(jobId) {
    // Try DB first
    if (this._db) {
      try {
        const result = await this._db.query(
          `SELECT state FROM processing_checkpoints
           WHERE job_id = $1 AND namespace = $2`,
          [jobId, this._namespace]
        );
        if (result.rows.length > 0) {
          const state = typeof result.rows[0].state === 'string'
            ? JSON.parse(result.rows[0].state)
            : result.rows[0].state;
          return state;
        }
      } catch {
        // Fall through to in-memory
      }
    }

    const cp = this._checkpoints.get(jobId);
    return cp ? cp.state : null;
  }

  /**
   * Clear a checkpoint after successful completion.
   * @param {string} jobId
   */
  async clear(jobId) {
    this._checkpoints.delete(jobId);

    if (this._db) {
      try {
        await this._db.query(
          `DELETE FROM processing_checkpoints WHERE job_id = $1 AND namespace = $2`,
          [jobId, this._namespace]
        );
      } catch {
        // best-effort
      }
    }
  }

  /**
   * List all active checkpoints.
   * @returns {Promise<Array<{ jobId: string, state: object, savedAt: string }>>}
   */
  async listActive() {
    if (this._db) {
      try {
        const result = await this._db.query(
          `SELECT job_id, state, saved_at FROM processing_checkpoints
           WHERE namespace = $1 ORDER BY saved_at DESC`,
          [this._namespace]
        );
        return result.rows.map(r => ({
          jobId: r.job_id,
          state: typeof r.state === 'string' ? JSON.parse(r.state) : r.state,
          savedAt: r.saved_at,
        }));
      } catch {
        // fall through
      }
    }

    return Array.from(this._checkpoints.values()).map(cp => ({
      jobId: cp.jobId,
      state: cp.state,
      savedAt: cp.savedAt,
    }));
  }

  /**
   * Run a processing job with automatic checkpointing.
   * @param {string} jobId
   * @param {Array} items - Items to process
   * @param {Function} processFn - async (item, index) => result
   * @param {object} [options]
   * @param {number} [options.checkpointInterval=100] - Save checkpoint every N items
   * @returns {Promise<{ processed: number, skipped: number, results: Array }>}
   */
  async runWithCheckpoints(jobId, items, processFn, { checkpointInterval = 100 } = {}) {
    const checkpoint = await this.load(jobId);
    const startIdx = checkpoint?.lastIndex ?? 0;
    const results = checkpoint?.results ?? [];
    let processed = 0;
    const skipped = startIdx;

    for (let i = startIdx; i < items.length; i++) {
      try {
        const result = await processFn(items[i], i);
        results.push(result);
        processed++;

        if (processed % checkpointInterval === 0) {
          await this.save(jobId, { lastIndex: i + 1, results });
        }
      } catch (err) {
        // Save checkpoint on error so we can resume
        await this.save(jobId, { lastIndex: i, results, lastError: err.message });
        throw err;
      }
    }

    // Clear checkpoint on success
    await this.clear(jobId);
    return { processed, skipped, results };
  }
}

// ── Enrichment Pipeline with Fan-out/Fan-in (#148) ─────────────────────────

/**
 * Fan-out/fan-in enrichment pipeline for artifacts.
 * Fans out to multiple enrichment stages in parallel, fans in to merge results.
 */
export class EnrichmentPipeline {
  /**
   * @param {object} [options]
   * @param {number} [options.concurrency=3] - Max parallel enrichment stages
   * @param {number} [options.timeoutMs=30000] - Per-stage timeout
   */
  constructor({ concurrency = 3, timeoutMs = 30000 } = {}) {
    this._concurrency = concurrency;
    this._timeoutMs = timeoutMs;
    /** @type {Array<{ name: string, fn: Function, priority: number }>} */
    this._stages = [];
  }

  /**
   * Register an enrichment stage.
   * @param {string} name
   * @param {Function} fn - async (artifact) => enrichment data
   * @param {object} [options]
   * @param {number} [options.priority=0] - Higher = runs first
   */
  addStage(name, fn, { priority = 0 } = {}) {
    this._stages.push({ name, fn, priority });
    this._stages.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Run all enrichment stages for an artifact (fan-out).
   * Returns merged enrichment results (fan-in).
   *
   * @param {object} artifact
   * @returns {Promise<{ enrichments: object, timing: object, errors: string[] }>}
   */
  async enrich(artifact) {
    const enrichments = {};
    const timing = {};
    const errors = [];

    // Fan-out: run stages in parallel with concurrency limit
    const batches = [];
    for (let i = 0; i < this._stages.length; i += this._concurrency) {
      batches.push(this._stages.slice(i, i + this._concurrency));
    }

    for (const batch of batches) {
      const promises = batch.map(async (stage) => {
        const start = Date.now();
        try {
          const result = await Promise.race([
            stage.fn(artifact),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`Stage ${stage.name} timed out`)), this._timeoutMs)
            ),
          ]);
          timing[stage.name] = Date.now() - start;
          return { name: stage.name, result };
        } catch (err) {
          timing[stage.name] = Date.now() - start;
          errors.push(`${stage.name}: ${err.message}`);
          return { name: stage.name, result: null };
        }
      });

      const results = await Promise.all(promises);

      // Fan-in: merge results
      for (const { name, result } of results) {
        if (result !== null) {
          enrichments[name] = result;
        }
      }
    }

    return { enrichments, timing, errors };
  }

  /**
   * Enrich a batch of artifacts.
   * @param {Array<object>} artifacts
   * @returns {Promise<Array<{ artifact: object, enrichments: object, errors: string[] }>>}
   */
  async enrichBatch(artifacts) {
    const results = [];
    for (const artifact of artifacts) {
      const { enrichments, timing, errors } = await this.enrich(artifact);
      results.push({ artifact, enrichments, timing, errors });
    }
    return results;
  }

  get stageCount() {
    return this._stages.length;
  }

  getStageNames() {
    return this._stages.map(s => s.name);
  }
}

// ── Priority Queue (#154) ───────────────────────────────────────────────────

/**
 * Priority queue for high-value artifact processing.
 * Higher priority items are dequeued first. Uses a binary heap.
 */
export class PriorityQueue {
  /**
   * @param {object} [options]
   * @param {Function} [options.comparator] - Custom comparator(a, b). Default: higher priority first.
   */
  constructor({ comparator = null } = {}) {
    this._heap = [];
    this._comparator = comparator || ((a, b) => a.priority - b.priority);
  }

  /**
   * Add an item with a priority.
   * @param {*} item
   * @param {number} [priority=0]
   */
  enqueue(item, priority = 0) {
    const entry = { item, priority, insertedAt: Date.now() };
    this._heap.push(entry);
    this._bubbleUp(this._heap.length - 1);
  }

  /**
   * Remove and return the highest-priority item.
   * @returns {{ item: *, priority: number }|null}
   */
  dequeue() {
    if (this._heap.length === 0) return null;

    const top = this._heap[0];
    const last = this._heap.pop();

    if (this._heap.length > 0) {
      this._heap[0] = last;
      this._sinkDown(0);
    }

    return { item: top.item, priority: top.priority };
  }

  /**
   * Peek at the highest-priority item without removing it.
   * @returns {{ item: *, priority: number }|null}
   */
  peek() {
    if (this._heap.length === 0) return null;
    return { item: this._heap[0].item, priority: this._heap[0].priority };
  }

  /**
   * Drain the queue, processing items in priority order.
   * @param {Function} processFn - async (item, priority) => void
   * @returns {Promise<number>} Number of items processed
   */
  async drain(processFn) {
    let count = 0;
    let entry;
    while ((entry = this.dequeue()) !== null) {
      await processFn(entry.item, entry.priority);
      count++;
    }
    return count;
  }

  get size() { return this._heap.length; }

  isEmpty() { return this._heap.length === 0; }

  /** @private */
  _bubbleUp(idx) {
    while (idx > 0) {
      const parentIdx = (idx - 1) >> 1;
      if (this._comparator(this._heap[idx], this._heap[parentIdx]) > 0) {
        [this._heap[idx], this._heap[parentIdx]] = [this._heap[parentIdx], this._heap[idx]];
        idx = parentIdx;
      } else {
        break;
      }
    }
  }

  /** @private */
  _sinkDown(idx) {
    const length = this._heap.length;
    while (true) {
      let largest = idx;
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;

      if (left < length && this._comparator(this._heap[left], this._heap[largest]) > 0) {
        largest = left;
      }
      if (right < length && this._comparator(this._heap[right], this._heap[largest]) > 0) {
        largest = right;
      }

      if (largest !== idx) {
        [this._heap[idx], this._heap[largest]] = [this._heap[largest], this._heap[idx]];
        idx = largest;
      } else {
        break;
      }
    }
  }

  /**
   * Get items above a priority threshold without removing them.
   * @param {number} minPriority
   * @returns {Array<{ item: *, priority: number }>}
   */
  peekAbove(minPriority) {
    return this._heap
      .filter(e => e.priority >= minPriority)
      .map(e => ({ item: e.item, priority: e.priority }));
  }

  /** Clear the queue */
  clear() {
    this._heap = [];
  }
}
