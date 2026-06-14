// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  StreamingJsonParser,
  parseJsonStream,
  StreamingExporter,
  DocumentChunker,
} from '../../src/processing/streaming.js';

// ── StreamingJsonParser (#169) ──────────────────────────────────────────

describe('StreamingJsonParser', () => {
  it('parses NDJSON lines', async () => {
    const input = '{"a":1}\n{"a":2}\n{"a":3}\n';
    const results = await parseJsonStream(input, { mode: 'ndjson' });
    assert.equal(results.length, 3);
    assert.equal(results[0].a, 1);
    assert.equal(results[2].a, 3);
  });

  it('parses JSON array', async () => {
    const input = JSON.stringify([{ b: 1 }, { b: 2 }]);
    const results = await parseJsonStream(input, { mode: 'array' });
    assert.equal(results.length, 2);
    assert.equal(results[0].b, 1);
  });

  it('skips oversized objects', async () => {
    const big = '{"x":"' + 'a'.repeat(2000000) + '"}\n';
    const normal = '{"y":1}\n';
    const results = await parseJsonStream(normal + big, { mode: 'ndjson', maxObjectSize: 1048576 });
    assert.equal(results.length, 1);
    assert.equal(results[0].y, 1);
  });

  it('handles empty input', async () => {
    const results = await parseJsonStream('', { mode: 'ndjson' });
    assert.equal(results.length, 0);
  });

  it('handles malformed JSON in NDJSON gracefully', async () => {
    const input = '{"a":1}\nnot json\n{"b":2}\n';
    const results = await parseJsonStream(input, { mode: 'ndjson' });
    assert.equal(results.length, 2);
  });

  it('tracks item and error counts', async () => {
    const parser = new StreamingJsonParser({ mode: 'ndjson' });
    const items = [];
    parser.on('data', (obj) => items.push(obj));
    await new Promise((resolve) => {
      parser.on('end', resolve);
      parser.write('{"a":1}\nbad\n{"b":2}\n');
      parser.end();
    });
    assert.equal(parser.itemCount, 2);
    assert.equal(parser.errorCount, 1);
  });
});

// ── StreamingExporter (#178) ────────────────────────────────────────────

describe('StreamingExporter', () => {
  function mockDb(rows) {
    let callCount = 0;
    return {
      query: async () => {
        if (callCount++ === 0) return { rows };
        return { rows: [] };
      },
    };
  }

  it('exports NDJSON format', async () => {
    const db = mockDb([{ id: '1', name: 'A' }, { id: '2', name: 'B' }]);
    const exporter = new StreamingExporter({ format: 'ndjson', batchSize: 100 });
    const buf = await exporter.exportToBuffer(db);
    const lines = buf.toString().trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).id, '1');
  });

  it('exports JSON array format', async () => {
    const db = mockDb([{ id: '1', name: 'A' }]);
    const exporter = new StreamingExporter({ format: 'json', batchSize: 100 });
    const buf = await exporter.exportToBuffer(db);
    const text = buf.toString();
    assert.ok(text.startsWith('['));
    assert.ok(text.endsWith(']'));
  });

  it('exports CSV format', async () => {
    const db = mockDb([{ id: '1', name: 'Test', artifact_type: 'wf', source: 'gh', quality_score: 80, discovered_at: '2024-01-01' }]);
    const exporter = new StreamingExporter({ format: 'csv', batchSize: 100 });
    const buf = await exporter.exportToBuffer(db);
    const lines = buf.toString().trim().split('\n');
    assert.ok(lines[0].includes('id,name'));
    assert.equal(lines.length, 2);
  });

  it('handles empty result set', async () => {
    const db = mockDb([]);
    const exporter = new StreamingExporter({ format: 'ndjson', batchSize: 100 });
    const buf = await exporter.exportToBuffer(db);
    assert.equal(buf.toString().trim(), '');
  });
});

// ── DocumentChunker (#189) ──────────────────────────────────────────────

describe('DocumentChunker', () => {
  it('returns single chunk for short text', () => {
    const chunker = new DocumentChunker({ maxChunkSize: 100 });
    const chunks = chunker.chunk('Hello world');
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].text, 'Hello world');
    assert.equal(chunks[0].index, 0);
  });

  it('returns empty array for empty text', () => {
    const chunker = new DocumentChunker();
    assert.deepEqual(chunker.chunk(''), []);
    assert.deepEqual(chunker.chunk(null), []);
  });

  it('splits long text into multiple chunks', () => {
    const chunker = new DocumentChunker({ maxChunkSize: 50, overlap: 10 });
    const text = 'a'.repeat(200);
    const chunks = chunker.chunk(text);
    assert.ok(chunks.length > 1);
  });

  it('chunks have correct start/end positions', () => {
    const chunker = new DocumentChunker({ maxChunkSize: 50, overlap: 0 });
    const text = 'a'.repeat(100);
    const chunks = chunker.chunk(text);
    assert.equal(chunks[0].start, 0);
    assert.ok(chunks[0].end <= 50);
  });

  it('prefers splitting at separator boundaries', () => {
    const lines = Array.from({ length: 20 }, (_, i) => 'Line ' + (i + 1)).join('\n');
    const chunker = new DocumentChunker({ maxChunkSize: 50, overlap: 5, separator: '\n' });
    const chunks = chunker.chunk(lines);
    for (const chunk of chunks.slice(0, -1)) {
      assert.ok(chunk.text.endsWith('\n') || chunk.text.length <= 50);
    }
  });

  it('estimateChunkCount is reasonable', () => {
    const chunker = new DocumentChunker({ maxChunkSize: 100, overlap: 20 });
    assert.equal(chunker.estimateChunkCount(50), 1);
    assert.ok(chunker.estimateChunkCount(1000) >= 10);
  });

  it('chunkStream yields chunks from async source', async () => {
    const chunker = new DocumentChunker({ maxChunkSize: 50, overlap: 5 });
    async function* source() {
      yield 'Hello '.repeat(20);
      yield 'World '.repeat(20);
    }
    const chunks = [];
    for await (const chunk of chunker.chunkStream(source())) {
      chunks.push(chunk);
    }
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) {
      assert.ok(chunk.text.length > 0);
      assert.ok(typeof chunk.index === 'number');
    }
  });
});
