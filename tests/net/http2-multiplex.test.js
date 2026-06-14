// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for HTTP/2 multiplexing logic (#199).
 */

import http from 'node:http';
import { once } from 'node:events';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Http2Session, Http2Pool, Http1Fallback } from '../../src/net/http2-multiplex.js';

describe('Http2Session (#199)', () => {
  it('should initialize disconnected', () => {
    const session = new Http2Session('https://api.example.com');
    assert.equal(session.isConnected, false);
    assert.equal(session.activeStreams, 0);
  });

  it('should track origin in stats', () => {
    const session = new Http2Session('https://api.github.com');
    const stats = session.getStats();
    assert.equal(stats.origin, 'https://api.github.com');
    assert.equal(stats.connected, false);
    assert.equal(stats.totalRequests, 0);
  });

  it('should close cleanly', () => {
    const session = new Http2Session('https://example.com');
    session._connected = true;
    session.close();
    assert.equal(session.isConnected, false);
  });

  it('should accept custom options', () => {
    const session = new Http2Session('https://x.com', {
      maxConcurrentStreams: 200,
      requestTimeoutMs: 5000,
    });
    assert.equal(session._maxConcurrentStreams, 200);
    assert.equal(session._requestTimeoutMs, 5000);
  });

  it('should track errors', () => {
    const session = new Http2Session('https://x.com');
    session._totalErrors = 5;
    assert.equal(session.getStats().totalErrors, 5);
  });
});

describe('Http2Pool (#199)', () => {
  let pool;

  beforeEach(() => {
    pool = new Http2Pool({ maxOrigins: 3 });
  });

  it('should create sessions for different origins', () => {
    const s1 = pool.getSession('https://api.github.com');
    const s2 = pool.getSession('https://api.gitlab.com');
    assert.ok(s1 !== s2);
    assert.equal(pool.getStats().totalSessions, 2);
  });

  it('should reuse sessions for same origin', () => {
    const s1 = pool.getSession('https://api.github.com');
    s1._connected = true;
    const s2 = pool.getSession('https://api.github.com');
    assert.equal(s1, s2);
  });

  it('should evict when at max origins', () => {
    pool.getSession('https://a.com');
    pool.getSession('https://b.com');
    pool.getSession('https://c.com');
    pool.getSession('https://d.com');
    assert.ok(pool.getStats().totalSessions <= 3);
  });

  it('should close all sessions', () => {
    pool.getSession('https://a.com');
    pool.getSession('https://b.com');
    pool.closeAll();
    assert.equal(pool.getStats().totalSessions, 0);
  });

  it('should report stats', () => {
    pool.getSession('https://x.com');
    const stats = pool.getStats();
    assert.equal(stats.maxOrigins, 3);
    assert.ok('sessions' in stats);
  });
});

describe('Http1Fallback (#199)', () => {
  let server;

  afterEach(async () => {
    if (!server) {
      return;
    }

    server.close();
    await once(server, 'close');
    server = null;
  });

  it('should accept timeout option', () => {
    const fallback = new Http1Fallback({ timeoutMs: 5000 });
    assert.equal(fallback._timeoutMs, 5000);
  });

  it('should use default timeout', () => {
    const fallback = new Http1Fallback();
    assert.equal(fallback._timeoutMs, 30_000);
  });

  it('should handle plain HTTP URLs', async () => {
    server = http.createServer((req, res) => {
      assert.equal(req.method, 'GET');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    const { port } = server.address();
    const fallback = new Http1Fallback({ timeoutMs: 5000 });
    const response = await fallback.request(`http://127.0.0.1:${port}/health`);

    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { ok: true });
  });
});
