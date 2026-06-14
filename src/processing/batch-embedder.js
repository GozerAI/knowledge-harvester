// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Batch embedding generation with GPU batching (item #161).
 *
 * Collects embedding requests into batches and sends them in a single
 * Ollama API call to maximize GPU utilization. Falls back to sequential
 * processing if batching is not supported.
 */

import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Batch embedding generator that groups requests for GPU efficiency.
 */
export class BatchEmbedder {
  /**
   * @param {object} [options]
   * @param {number} [options.batchSize=32] - Max items per batch
   * @param {number} [options.maxConcurrentBatches=2] - Parallel batch limit
   * @param {number} [options.timeoutMs=30000] - Per-batch timeout
   * @param {string} [options.model] - Embedding model name
   * @param {string} [options.host] - Ollama host URL
   */
  constructor({
    batchSize = 32,
    maxConcurrentBatches = 2,
    timeoutMs = 30000,
    model = null,
    host = null,
  } = {}) {
    this._batchSize = batchSize;
    this._maxConcurrentBatches = maxConcurrentBatches;
    this._timeoutMs = timeoutMs;
    this._model = model || config.ollama.embedModel;
    this._host = host || config.ollama.host;
    this._totalEmbedded = 0;
    this._totalFailed = 0;
    this._totalBatches = 0;
  }

  /**
   * Generate embeddings for a batch of texts.
   * Groups into sub-batches of batchSize and processes with concurrency control.
   *
   * @param {Array<{ id: string, text: string }>} items - Items to embed
   * @returns {Promise<Array<{ id: string, embedding: number[]|null, error?: string }>>}
   */
  async embedBatch(items) {
    if (items.length === 0) return [];

    // Split into sub-batches
    const batches = [];
    for (let i = 0; i < items.length; i += this._batchSize) {
      batches.push(items.slice(i, i + this._batchSize));
    }

    const results = [];
    // Process batches with concurrency control
    for (let i = 0; i < batches.length; i += this._maxConcurrentBatches) {
      const concurrentBatches = batches.slice(i, i + this._maxConcurrentBatches);
      const batchResults = await Promise.all(
        concurrentBatches.map(batch => this._processBatch(batch))
      );
      for (const batchResult of batchResults) {
        results.push(...batchResult);
      }
    }

    return results;
  }

  /**
   * Process a single batch of items.
   * @param {Array<{ id: string, text: string }>} batch
   * @returns {Promise<Array<{ id: string, embedding: number[]|null, error?: string }>>}
   * @private
   */
  async _processBatch(batch) {
    this._totalBatches++;
    const results = [];

    // Try batch embedding first (Ollama supports this with /api/embed for newer versions)
    try {
      const response = await this._fetchWithTimeout(`${this._host}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this._model,
          input: batch.map(item => item.text),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const embeddings = data.embeddings || [];

        for (let i = 0; i < batch.length; i++) {
          if (embeddings[i]) {
            results.push({ id: batch[i].id, embedding: embeddings[i] });
            this._totalEmbedded++;
          } else {
            results.push({ id: batch[i].id, embedding: null, error: 'No embedding returned' });
            this._totalFailed++;
          }
        }
        return results;
      }
    } catch {
      // Fall through to sequential
    }

    // Fallback: sequential embedding via /api/embeddings
    for (const item of batch) {
      try {
        const response = await this._fetchWithTimeout(`${this._host}/api/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this._model,
            prompt: item.text,
          }),
        });

        if (!response.ok) {
          results.push({ id: item.id, embedding: null, error: `HTTP ${response.status}` });
          this._totalFailed++;
          continue;
        }

        const data = await response.json();
        if (data.embedding && Array.isArray(data.embedding)) {
          results.push({ id: item.id, embedding: data.embedding });
          this._totalEmbedded++;
        } else {
          results.push({ id: item.id, embedding: null, error: 'Invalid response' });
          this._totalFailed++;
        }
      } catch (err) {
        results.push({ id: item.id, embedding: null, error: err.message });
        this._totalFailed++;
      }
    }

    return results;
  }

  /**
   * @private
   */
  async _fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Build embedding text from an artifact row.
   * @param {object} row
   * @returns {string}
   */
  static buildText(row) {
    const parts = [
      row.name || row.workflow_name || '',
      row.description || row.original_description || '',
      row.artifact_type || row.tool_type || '',
      row.primary_category || '',
      Array.isArray(row.tags) ? row.tags.join(' ') : '',
      row.language || '',
    ];
    return parts.filter(Boolean).join(' ').slice(0, 4000).trim();
  }

  getStats() {
    return {
      totalEmbedded: this._totalEmbedded,
      totalFailed: this._totalFailed,
      totalBatches: this._totalBatches,
      batchSize: this._batchSize,
      maxConcurrentBatches: this._maxConcurrentBatches,
    };
  }
}
