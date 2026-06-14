// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Streaming JSON parsing for large responses (item #169),
 * Streaming artifact export to avoid memory spikes (item #178),
 * Document chunking with memory-bounded windows (item #189).
 */

import { Transform, Readable, PassThrough } from 'node:stream';
import zlib from 'node:zlib';

// ── Streaming JSON Parser (#169) ────────────────────────────────────────────

/**
 * Streaming JSON parser that processes large JSON responses incrementally.
 * Emits individual objects as they are parsed from a JSON array stream.
 *
 * Supports: JSON arrays (streams each element), NDJSON (one object per line).
 */
export class StreamingJsonParser extends Transform {
  /**
   * @param {object} [options]
   * @param {string} [options.mode='array'] - 'array' for JSON arrays, 'ndjson' for newline-delimited
   * @param {number} [options.maxObjectSize=1048576] - Max size of a single object in bytes (1MB)
   */
  constructor({ mode = 'array', maxObjectSize = 1_048_576 } = {}) {
    super({ readableObjectMode: true });
    this._mode = mode;
    this._maxObjectSize = maxObjectSize;
    this._buffer = '';
    this._depth = 0;
    this._inString = false;
    this._escaped = false;
    this._objectStart = -1;
    this._itemCount = 0;
    this._errors = 0;
  }

  _transform(chunk, _encoding, callback) {
    const str = chunk.toString();

    if (this._mode === 'ndjson') {
      this._buffer += str;
      this._processNdjson();
    } else {
      this._buffer += str;
      this._processArray();
    }

    callback();
  }

  _flush(callback) {
    // Try to parse any remaining buffer
    const remaining = this._buffer.trim();
    if (remaining) {
      try {
        const obj = JSON.parse(remaining);
        this._itemCount++;
        this.push(obj);
      } catch {
        // Ignore trailing incomplete data
      }
    }
    callback();
  }

  /** @private Process NDJSON format */
  _processNdjson() {
    let newlineIdx;
    while ((newlineIdx = this._buffer.indexOf('\n')) !== -1) {
      const line = this._buffer.slice(0, newlineIdx).trim();
      this._buffer = this._buffer.slice(newlineIdx + 1);

      if (line.length === 0) continue;
      if (line.length > this._maxObjectSize) {
        this._errors++;
        continue;
      }

      try {
        const obj = JSON.parse(line);
        this._itemCount++;
        this.push(obj);
      } catch {
        this._errors++;
      }
    }
  }

  /** @private Process JSON array format by tracking brace depth */
  _processArray() {
    let i = 0;
    while (i < this._buffer.length) {
      const ch = this._buffer[i];

      if (this._escaped) {
        this._escaped = false;
        i++;
        continue;
      }

      if (ch === '\\' && this._inString) {
        this._escaped = true;
        i++;
        continue;
      }

      if (ch === '"') {
        this._inString = !this._inString;
        i++;
        continue;
      }

      if (this._inString) {
        i++;
        continue;
      }

      if (ch === '{' || ch === '[') {
        if (this._depth === 1 && ch === '{') {
          this._objectStart = i;
        }
        if (this._depth === 0 && ch === '[') {
          // Start of array
        }
        this._depth++;
      } else if (ch === '}' || ch === ']') {
        this._depth--;
        if (this._depth === 1 && ch === '}' && this._objectStart !== -1) {
          const objStr = this._buffer.slice(this._objectStart, i + 1);
          this._objectStart = -1;

          if (objStr.length <= this._maxObjectSize) {
            try {
              const obj = JSON.parse(objStr);
              this._itemCount++;
              this.push(obj);
            } catch {
              this._errors++;
            }
          } else {
            this._errors++;
          }

          // Trim buffer
          this._buffer = this._buffer.slice(i + 1);
          i = 0;
          continue;
        }
      }

      i++;
    }

    // Prevent unbounded buffer growth
    if (this._objectStart === -1 && this._depth <= 1) {
      this._buffer = this._buffer.slice(i);
    }
  }

  get itemCount() { return this._itemCount; }
  get errorCount() { return this._errors; }
}

/**
 * Parse a JSON string or buffer using streaming parser.
 * Returns an array of parsed objects.
 *
 * @param {string|Buffer} input
 * @param {object} [options]
 * @returns {Promise<Array<object>>}
 */
export async function parseJsonStream(input, options = {}) {
  return new Promise((resolve, reject) => {
    const parser = new StreamingJsonParser(options);
    const results = [];

    parser.on('data', obj => results.push(obj));
    parser.on('end', () => resolve(results));
    parser.on('error', reject);

    const stream = Readable.from([typeof input === 'string' ? input : input.toString()]);
    stream.pipe(parser);
  });
}

// ── Streaming Artifact Export (#178) ────────────────────────────────────────

/**
 * Stream artifacts from database to an output stream to avoid loading
 * all artifacts into memory at once.
 */
export class StreamingExporter {
  /**
   * @param {object} [options]
   * @param {number} [options.batchSize=100] - Rows per DB query
   * @param {'json'|'ndjson'|'csv'} [options.format='ndjson']
   * @param {boolean} [options.compress=false] - Gzip compress output
   */
  constructor({ batchSize = 100, format = 'ndjson', compress = false } = {}) {
    this._batchSize = batchSize;
    this._format = format;
    this._compress = compress;
  }

  /**
   * Create a readable stream that exports artifacts matching a query.
   *
   * @param {object} db - Database client
   * @param {object} [filter]
   * @param {string} [filter.artifactType]
   * @param {string} [filter.source]
   * @param {number} [filter.qualityMin]
   * @returns {import('node:stream').Readable}
   */
  createStream(db, filter = {}) {
    const self = this;
    let offset = 0;
    let done = false;
    let isFirst = true;

    const output = new PassThrough();

    // Write header
    if (this._format === 'json') {
      output.write('[\n');
    } else if (this._format === 'csv') {
      output.write('id,name,artifact_type,source,quality_score,discovered_at\n');
    }

    (async () => {
      try {
        while (!done) {
          const conditions = [];
          const values = [];
          let idx = 1;

          if (filter.artifactType) {
            conditions.push(`artifact_type = $${idx++}`);
            values.push(filter.artifactType);
          }
          if (filter.source) {
            conditions.push(`source = $${idx++}`);
            values.push(filter.source);
          }
          if (filter.qualityMin) {
            conditions.push(`quality_score >= $${idx++}`);
            values.push(filter.qualityMin);
          }

          const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

          const result = await db.query(
            `SELECT id, name, artifact_type, source, source_url, quality_score,
                    primary_category, tags, language, tool_type,
                    description, discovered_at, updated_at
             FROM artifacts ${where}
             ORDER BY discovered_at DESC
             LIMIT $${idx} OFFSET $${idx + 1}`,
            [...values, self._batchSize, offset]
          );

          if (result.rows.length === 0) {
            done = true;
            break;
          }

          for (const row of result.rows) {
            if (self._format === 'ndjson') {
              output.write(JSON.stringify(row) + '\n');
            } else if (self._format === 'json') {
              const prefix = isFirst ? '' : ',\n';
              isFirst = false;
              output.write(prefix + JSON.stringify(row, null, 2));
            } else if (self._format === 'csv') {
              const escaped = (s) => `"${String(s || '').replace(/"/g, '""')}"`;
              output.write(
                `${escaped(row.id)},${escaped(row.name)},${escaped(row.artifact_type)},` +
                `${escaped(row.source)},${row.quality_score || 0},${escaped(row.discovered_at)}\n`
              );
            }
          }

          offset += result.rows.length;

          if (result.rows.length < self._batchSize) {
            done = true;
          }
        }

        // Write footer
        if (self._format === 'json') {
          output.write('\n]');
        }

        output.end();
      } catch (err) {
        output.destroy(err);
      }
    })();

    if (this._compress) {
      const gz = zlib.createGzip();
      output.pipe(gz);
      return gz;
    }

    return output;
  }

  /**
   * Export to a buffer (for small exports or testing).
   * @param {object} db
   * @param {object} [filter]
   * @returns {Promise<Buffer>}
   */
  async exportToBuffer(db, filter = {}) {
    return new Promise((resolve, reject) => {
      const stream = this.createStream(db, filter);
      const chunks = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }
}

// ── Document Chunking with Memory-Bounded Windows (#189) ────────────────────

/**
 * Chunk large documents into memory-bounded windows for processing.
 * Ensures no single chunk exceeds memory limits while maintaining
 * context overlap between windows.
 */
export class DocumentChunker {
  /**
   * @param {object} [options]
   * @param {number} [options.maxChunkSize=4096] - Max characters per chunk
   * @param {number} [options.overlap=200] - Overlap between consecutive chunks
   * @param {string} [options.separator='\n'] - Preferred split point
   * @param {number} [options.maxMemoryBytes=50_000_000] - Memory limit (50MB)
   */
  constructor({
    maxChunkSize = 4096,
    overlap = 200,
    separator = '\n',
    maxMemoryBytes = 50_000_000,
  } = {}) {
    this._maxChunkSize = maxChunkSize;
    this._overlap = Math.min(overlap, Math.floor(maxChunkSize / 4));
    this._separator = separator;
    this._maxMemoryBytes = maxMemoryBytes;
  }

  /**
   * Chunk a document string into overlapping windows.
   * @param {string} text
   * @returns {Array<{ text: string, index: number, start: number, end: number }>}
   */
  chunk(text) {
    if (!text || text.length === 0) return [];
    if (text.length <= this._maxChunkSize) {
      return [{ text, index: 0, start: 0, end: text.length }];
    }

    const chunks = [];
    let pos = 0;
    let index = 0;

    while (pos < text.length) {
      let end = Math.min(pos + this._maxChunkSize, text.length);

      // Try to break at a separator boundary
      if (end < text.length) {
        const lastSep = text.lastIndexOf(this._separator, end);
        if (lastSep > pos) {
          end = lastSep + this._separator.length;
        }
      }

      chunks.push({
        text: text.slice(pos, end),
        index,
        start: pos,
        end,
      });

      // Advance with overlap
      pos = end - this._overlap;
      if (pos <= chunks[chunks.length - 1].start) {
        pos = end; // Prevent infinite loop
      }
      index++;
    }

    return chunks;
  }

  /**
   * Chunk a large document as a stream transform.
   * Yields chunks without loading the entire document into memory.
   *
   * @param {AsyncIterable<string|Buffer>} source
   * @returns {AsyncGenerator<{ text: string, index: number }>}
   */
  async *chunkStream(source) {
    let buffer = '';
    let index = 0;
    let memUsage = 0;

    for await (const piece of source) {
      const str = typeof piece === 'string' ? piece : piece.toString();
      buffer += str;
      memUsage += str.length * 2; // UTF-16 char ~2 bytes

      // Yield complete chunks when buffer is large enough
      while (buffer.length >= this._maxChunkSize) {
        let end = this._maxChunkSize;
        const lastSep = buffer.lastIndexOf(this._separator, end);
        if (lastSep > 0) {
          end = lastSep + this._separator.length;
        }

        const chunk = buffer.slice(0, end);
        yield { text: chunk, index };
        index++;

        // Keep overlap for context
        buffer = buffer.slice(Math.max(0, end - this._overlap));
        memUsage = buffer.length * 2;
      }

      // Safety check: flush if approaching memory limit
      if (memUsage > this._maxMemoryBytes) {
        if (buffer.length > 0) {
          yield { text: buffer, index };
          index++;
          buffer = '';
          memUsage = 0;
        }
      }
    }

    // Emit remaining buffer
    if (buffer.length > 0) {
      yield { text: buffer, index };
    }
  }

  /**
   * Estimate number of chunks for a given text length.
   * @param {number} textLength
   * @returns {number}
   */
  estimateChunkCount(textLength) {
    if (textLength <= this._maxChunkSize) return 1;
    const effectiveStep = this._maxChunkSize - this._overlap;
    return Math.ceil((textLength - this._overlap) / effectiveStep);
  }
}
