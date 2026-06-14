// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Http2MultiplexClient, getHttp2Client } from '../../src/api/http2-multiplex.js';

describe('Http2MultiplexClient', () => {
  describe('constructor', () => {
    it('uses default options', () => {
      const client = new Http2MultiplexClient();
      assert.equal(client._maxConcurrentStreams, 100);
      assert.equal(client._requestTimeoutMs, 30000);
      assert.equal(client._sessionIdleTimeoutMs, 60000);
    });

    it('accepts custom options', () => {
      const client = new Http2MultiplexClient({
        maxConcurrentStreams: 50,
        requestTimeoutMs: 5000,
      });
      assert.equal(client._maxConcurrentStreams, 50);
      assert.equal(client._requestTimeoutMs, 5000);
    });

    it('initializes counters to zero', () => {
      const client = new Http2MultiplexClient();
      const stats = client.getStats();
      assert.equal(stats.totalRequests, 0);
      assert.equal(stats.totalErrors, 0);
      assert.equal(stats.totalMultiplexed, 0);
      assert.equal(stats.activeSessions, 0);
    });
  });

  describe('parseUrl', () => {
    it('extracts origin and path from HTTPS URL', () => {
      const { origin, path } = Http2MultiplexClient.parseUrl('https://api.example.com/v1/data?q=test');
      assert.equal(origin, 'https://api.example.com');
      assert.equal(path, '/v1/data?q=test');
    });

    it('extracts origin and path from HTTP URL', () => {
      const { origin, path } = Http2MultiplexClient.parseUrl('http://localhost:8080/health');
      assert.equal(origin, 'http://localhost:8080');
      assert.equal(path, '/health');
    });

    it('handles URL with no path', () => {
      const { origin, path } = Http2MultiplexClient.parseUrl('https://example.com');
      assert.equal(origin, 'https://example.com');
      assert.equal(path, '/');
    });

    it('handles URL with port', () => {
      const { origin, path } = Http2MultiplexClient.parseUrl('https://api.example.com:9443/data');
      assert.equal(origin, 'https://api.example.com:9443');
      assert.equal(path, '/data');
    });
  });

  describe('closeAll', () => {
    it('clears sessions map', () => {
      const client = new Http2MultiplexClient();
      client._sessions.set('https://a.com', { session: { close() {}, destroyed: false }, activeStreams: 0, lastUsed: 0 });
      client.closeAll();
      assert.equal(client.activeSessions, 0);
    });

    it('handles already-destroyed sessions gracefully', () => {
      const client = new Http2MultiplexClient();
      client._sessions.set('https://b.com', {
        session: { close() { throw new Error('already closed'); }, destroyed: true },
        activeStreams: 0, lastUsed: 0,
      });
      assert.doesNotThrow(() => client.closeAll());
      assert.equal(client.activeSessions, 0);
    });
  });

  describe('getStats', () => {
    it('returns session details', () => {
      const client = new Http2MultiplexClient();
      client._sessions.set('https://c.com', {
        session: { destroyed: false },
        activeStreams: 2,
        lastUsed: 12345,
      });
      client._totalRequests = 10;
      const stats = client.getStats();
      assert.equal(stats.activeSessions, 1);
      assert.equal(stats.totalRequests, 10);
      assert.ok(stats.sessions['https://c.com']);
      assert.equal(stats.sessions['https://c.com'].activeStreams, 2);
    });
  });

  describe('requestAll', () => {
    it('returns error entries on connection failure', async () => {
      const client = new Http2MultiplexClient({ requestTimeoutMs: 100 });
      const results = await client.requestAll([
        { url: 'http://127.0.0.1:1/nonexistent' },
      ]);
      assert.equal(results.length, 1);
      assert.ok(results[0].error);
    });
  });
});
