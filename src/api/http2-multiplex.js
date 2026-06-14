// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * HTTP/2 multiplexing for parallel requests (item #199).
 *
 * Provides an HTTP/2-aware client that multiplexes multiple requests over
 * a single TCP connection. Falls back to HTTP/1.1 when HTTP/2 is unavailable.
 */

import http2 from 'node:http2';
import https from 'node:https';
import http from 'node:http';
import { logger } from '../utils/logger.js';

export class Http2MultiplexClient {
  constructor({
    maxConcurrentStreams = 100,
    sessionIdleTimeoutMs = 60000,
    requestTimeoutMs = 30000,
    rejectUnauthorized = true,
  } = {}) {
    this._maxConcurrentStreams = maxConcurrentStreams;
    this._sessionIdleTimeoutMs = sessionIdleTimeoutMs;
    this._requestTimeoutMs = requestTimeoutMs;
    this._rejectUnauthorized = rejectUnauthorized;
    this._sessions = new Map();
    this._totalRequests = 0;
    this._totalErrors = 0;
    this._totalMultiplexed = 0;
  }

  static parseUrl(url) {
    const parsed = new URL(url);
    return {
      origin: parsed.protocol + '//' + parsed.host,
      path: parsed.pathname + parsed.search,
    };
  }

  async getSession(origin) {
    const existing = this._sessions.get(origin);
    if (existing && !existing.session.destroyed && !existing.session.closed) {
      existing.lastUsed = Date.now();
      return existing.session;
    }
    if (existing) {
      this._sessions.delete(origin);
      try { existing.session.close(); } catch {}
    }
    return new Promise((resolve, reject) => {
      const session = http2.connect(origin, {
        rejectUnauthorized: this._rejectUnauthorized,
        settings: { maxConcurrentStreams: this._maxConcurrentStreams },
      });
      const onErr = (err) => { this._sessions.delete(origin); reject(err); };
      session.on('error', (err) => {
        logger.warn('HTTP/2 session error', { origin, error: err.message });
        this._sessions.delete(origin);
      });
      session.on('close', () => this._sessions.delete(origin));
      session.once('connect', () => {
        session.removeListener('error', onErr);
        this._sessions.set(origin, { session, activeStreams: 0, lastUsed: Date.now() });
        this._scheduleIdleClose(origin);
        resolve(session);
      });
      session.once('error', onErr);
    });
  }

  async request(url, { method = 'GET', headers = {}, body = null } = {}) {
    this._totalRequests++;
    const { origin, path } = Http2MultiplexClient.parseUrl(url);
    let session;
    try { session = await this.getSession(origin); }
    catch { return this._http1Fallback(url, { method, headers, body }); }

    const entry = this._sessions.get(origin);
    if (entry) {
      entry.activeStreams++;
      if (entry.activeStreams > 1) this._totalMultiplexed++;
    }

    return new Promise((resolve, reject) => {
      const reqHeaders = {
        [http2.constants.HTTP2_HEADER_PATH]: path,
        [http2.constants.HTTP2_HEADER_METHOD]: method,
        ...headers,
      };
      const req = session.request(reqHeaders);
      const timer = setTimeout(() => {
        req.close(http2.constants.NGHTTP2_CANCEL);
        reject(new Error('Request timeout after ' + this._requestTimeoutMs + 'ms'));
      }, this._requestTimeoutMs);
      const chunks = [];
      let status = 0;
      let responseHeaders = {};
      req.on('response', (hdrs) => {
        status = hdrs[http2.constants.HTTP2_HEADER_STATUS];
        responseHeaders = { ...hdrs };
      });
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        clearTimeout(timer);
        if (entry) entry.activeStreams--;
        resolve({ status, headers: responseHeaders, body: Buffer.concat(chunks).toString() });
      });
      req.on('error', (err) => {
        clearTimeout(timer);
        if (entry) entry.activeStreams--;
        this._totalErrors++;
        reject(err);
      });
      if (body) req.write(typeof body === 'string' ? body : body);
      req.end();
    });
  }

  async requestAll(requests) {
    return Promise.all(requests.map(async (r) => {
      try {
        const result = await this.request(r.url, {
          method: r.method || 'GET', headers: r.headers || {}, body: r.body || null,
        });
        return { url: r.url, status: result.status, body: result.body };
      } catch (err) { return { url: r.url, error: err.message }; }
    }));
  }

  _http1Fallback(url, { method, headers, body }) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const proto = parsed.protocol === 'https:' ? https : http;
      const opts = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method, headers, rejectUnauthorized: this._rejectUnauthorized,
        timeout: this._requestTimeoutMs,
      };
      const req = proto.request(opts, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({
          status: res.statusCode, headers: res.headers,
          body: Buffer.concat(chunks).toString(),
        }));
      });
      req.on('error', (err) => { this._totalErrors++; reject(err); });
      req.on('timeout', () => req.destroy(new Error('HTTP/1.1 request timeout')));
      if (body) req.write(body);
      req.end();
    });
  }

  _scheduleIdleClose(origin) {
    const check = () => {
      const entry = this._sessions.get(origin);
      if (!entry) return;
      if (entry.activeStreams === 0 && Date.now() - entry.lastUsed > this._sessionIdleTimeoutMs) {
        try { entry.session.close(); } catch {}
        this._sessions.delete(origin);
        return;
      }
      const t = setTimeout(check, this._sessionIdleTimeoutMs);
      if (t.unref) t.unref();
    };
    const t = setTimeout(check, this._sessionIdleTimeoutMs);
    if (t.unref) t.unref();
  }

  closeAll() {
    for (const [, e] of this._sessions) { try { e.session.close(); } catch {} }
    this._sessions.clear();
  }

  getStats() {
    const sessions = {};
    for (const [o, e] of this._sessions) {
      sessions[o] = { activeStreams: e.activeStreams, lastUsed: e.lastUsed, destroyed: e.session.destroyed };
    }
    return {
      activeSessions: this._sessions.size, totalRequests: this._totalRequests,
      totalErrors: this._totalErrors, totalMultiplexed: this._totalMultiplexed, sessions,
    };
  }

  get activeSessions() { return this._sessions.size; }
}

let _instance = null;
export function getHttp2Client(options) {
  if (!_instance) _instance = new Http2MultiplexClient(options);
  return _instance;
}
