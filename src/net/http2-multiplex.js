// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * HTTP/2 multiplexing for parallel requests (item #199).
 *
 * Provides an HTTP/2 client that multiplexes multiple requests over a
 * single TCP connection per origin. Falls back to HTTP/1.1 when HTTP/2
 * is unavailable. Manages session lifecycle, reconnection, and backpressure.
 */

import http2 from 'node:http2';
import http from 'node:http';
import https from 'node:https';
import { logger } from '../utils/logger.js';

/**
 * HTTP/2 session wrapper with auto-reconnect and request multiplexing.
 */
export class Http2Session {
  /**
   * @param {string} origin - e.g. "https://api.github.com"
   * @param {object} [options]
   * @param {number} [options.maxConcurrentStreams=100]
   * @param {number} [options.connectTimeoutMs=10000]
   * @param {number} [options.requestTimeoutMs=30000]
   * @param {number} [options.idleTimeoutMs=60000]
   * @param {boolean} [options.rejectUnauthorized=true]
   */
  constructor(origin, {
    maxConcurrentStreams = 100,
    connectTimeoutMs = 10_000,
    requestTimeoutMs = 30_000,
    idleTimeoutMs = 60_000,
    rejectUnauthorized = true,
  } = {}) {
    this._origin = origin;
    this._maxConcurrentStreams = maxConcurrentStreams;
    this._connectTimeoutMs = connectTimeoutMs;
    this._requestTimeoutMs = requestTimeoutMs;
    this._idleTimeoutMs = idleTimeoutMs;
    this._rejectUnauthorized = rejectUnauthorized;
    this._session = null;
    this._activeStreams = 0;
    this._totalRequests = 0;
    this._totalErrors = 0;
    this._connected = false;
    this._connecting = false;
    this._connectPromise = null;
    this._lastUsed = 0;
    this._idleTimer = null;
  }

  /**
   * Connect (or reconnect) the HTTP/2 session.
   * @returns {Promise<void>}
   */
  async connect() {
    if (this._connected && this._session && !this._session.destroyed) {
      return;
    }

    if (this._connecting && this._connectPromise) {
      return this._connectPromise;
    }

    this._connecting = true;
    this._connectPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`HTTP/2 connect timeout to ${this._origin}`));
      }, this._connectTimeoutMs);

      try {
        this._session = http2.connect(this._origin, {
          rejectUnauthorized: this._rejectUnauthorized,
          settings: {
            maxConcurrentStreams: this._maxConcurrentStreams,
          },
        });

        this._session.on('connect', () => {
          clearTimeout(timer);
          this._connected = true;
          this._connecting = false;
          this._resetIdleTimer();
          resolve();
        });

        this._session.on('error', (err) => {
          clearTimeout(timer);
          this._connected = false;
          this._connecting = false;
          this._totalErrors++;
          reject(err);
        });

        this._session.on('close', () => {
          this._connected = false;
          this._clearIdleTimer();
        });

        this._session.on('goaway', () => {
          this._connected = false;
          this._session = null;
          this._clearIdleTimer();
        });
      } catch (err) {
        clearTimeout(timer);
        this._connecting = false;
        reject(err);
      }
    });

    return this._connectPromise;
  }

  /**
   * Send an HTTP/2 request.
   * @param {string} path - Request path (e.g. "/repos/user/repo")
   * @param {object} [options]
   * @param {string} [options.method='GET']
   * @param {object} [options.headers={}]
   * @param {string|Buffer|null} [options.body=null]
   * @returns {Promise<{ status: number, headers: object, body: string }>}
   */
  async request(path, { method = 'GET', headers = {}, body = null } = {}) {
    await this.connect();

    if (!this._session || this._session.destroyed) {
      throw new Error('HTTP/2 session is not available');
    }

    this._activeStreams++;
    this._totalRequests++;
    this._resetIdleTimer();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        stream.close(http2.constants.NGHTTP2_CANCEL);
        reject(new Error(`HTTP/2 request timeout: ${method} ${path}`));
      }, this._requestTimeoutMs);

      const reqHeaders = {
        [http2.constants.HTTP2_HEADER_PATH]: path,
        [http2.constants.HTTP2_HEADER_METHOD]: method,
        ...headers,
      };

      const stream = this._session.request(reqHeaders);

      const chunks = [];
      let responseHeaders = {};
      let status = 0;

      stream.on('response', (hdrs) => {
        responseHeaders = hdrs;
        status = hdrs[http2.constants.HTTP2_HEADER_STATUS];
      });

      stream.on('data', (chunk) => {
        chunks.push(chunk);
      });

      stream.on('end', () => {
        clearTimeout(timer);
        this._activeStreams--;
        this._resetIdleTimer();
        resolve({
          status,
          headers: responseHeaders,
          body: Buffer.concat(chunks).toString('utf-8'),
        });
      });

      stream.on('error', (err) => {
        clearTimeout(timer);
        this._activeStreams--;
        this._totalErrors++;
        reject(err);
      });

      if (body) {
        stream.write(body);
      }
      stream.end();
    });
  }

  /**
   * Send multiple requests in parallel over the same connection.
   * @param {Array<{ path: string, method?: string, headers?: object, body?: string }>} requests
   * @returns {Promise<Array<{ status: number, headers: object, body: string }|{ error: string }>>}
   */
  async requestAll(requests) {
    return Promise.all(
      requests.map(req =>
        this.request(req.path, {
          method: req.method,
          headers: req.headers,
          body: req.body,
        }).catch(err => ({ error: err.message, status: 0, headers: {}, body: '' }))
      )
    );
  }

  /** Close the session */
  close() {
    this._clearIdleTimer();
    if (this._session && !this._session.destroyed) {
      this._session.close();
    }
    this._session = null;
    this._connected = false;
  }

  /** @private */
  _resetIdleTimer() {
    this._clearIdleTimer();
    this._lastUsed = Date.now();
    if (this._activeStreams === 0 && this._idleTimeoutMs > 0) {
      this._idleTimer = setTimeout(() => {
        if (this._activeStreams === 0) {
          this.close();
        }
      }, this._idleTimeoutMs);
      if (this._idleTimer.unref) this._idleTimer.unref();
    }
  }

  /** @private */
  _clearIdleTimer() {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
  }

  get isConnected() { return this._connected; }
  get activeStreams() { return this._activeStreams; }

  getStats() {
    return {
      origin: this._origin,
      connected: this._connected,
      activeStreams: this._activeStreams,
      totalRequests: this._totalRequests,
      totalErrors: this._totalErrors,
      lastUsed: this._lastUsed,
    };
  }
}

/**
 * HTTP/2 connection pool that manages sessions per origin.
 * Automatically reuses sessions and creates new ones as needed.
 */
export class Http2Pool {
  /**
   * @param {object} [options]
   * @param {object} [options.sessionOptions] - Default session options
   * @param {number} [options.maxOrigins=50] - Max tracked origins
   */
  constructor({ sessionOptions = {}, maxOrigins = 50 } = {}) {
    this._sessionOptions = sessionOptions;
    this._maxOrigins = maxOrigins;
    /** @type {Map<string, Http2Session>} */
    this._sessions = new Map();
  }

  /**
   * Get or create a session for an origin.
   * @param {string} origin
   * @returns {Http2Session}
   */
  getSession(origin) {
    let session = this._sessions.get(origin);
    if (session && session.isConnected) {
      return session;
    }

    // Evict oldest if at capacity
    if (this._sessions.size >= this._maxOrigins) {
      this._evictLeastUsed();
    }

    session = new Http2Session(origin, this._sessionOptions);
    this._sessions.set(origin, session);
    return session;
  }

  /**
   * Make a request to any URL, routing through the correct session.
   * @param {string} url - Full URL
   * @param {object} [options]
   * @returns {Promise<{ status: number, headers: object, body: string }>}
   */
  async request(url, options = {}) {
    const parsed = new URL(url);
    const origin = parsed.origin;
    const path = parsed.pathname + parsed.search;
    const session = this.getSession(origin);
    return session.request(path, options);
  }

  /**
   * Close all sessions.
   */
  closeAll() {
    for (const session of this._sessions.values()) {
      session.close();
    }
    this._sessions.clear();
  }

  /** @private */
  _evictLeastUsed() {
    let oldest = null;
    let oldestOrigin = null;
    for (const [origin, session] of this._sessions) {
      const stats = session.getStats();
      if (session.activeStreams === 0 && (!oldest || stats.lastUsed < oldest)) {
        oldest = stats.lastUsed;
        oldestOrigin = origin;
      }
    }
    if (oldestOrigin) {
      const session = this._sessions.get(oldestOrigin);
      session.close();
      this._sessions.delete(oldestOrigin);
    }
  }

  getStats() {
    const sessions = {};
    for (const [origin, session] of this._sessions) {
      sessions[origin] = session.getStats();
    }
    return {
      totalSessions: this._sessions.size,
      maxOrigins: this._maxOrigins,
      sessions,
    };
  }
}

/**
 * HTTP/1.1 fallback client (for when HTTP/2 is not available).
 * Provides the same interface as Http2Session.request().
 */
export class Http1Fallback {
  /**
   * @param {object} [options]
   * @param {number} [options.timeoutMs=30000]
   */
  constructor({ timeoutMs = 30_000 } = {}) {
    this._timeoutMs = timeoutMs;
  }

  /**
   * @param {string} url - Full URL
   * @param {object} [options]
   * @returns {Promise<{ status: number, headers: object, body: string }>}
   */
  async request(url, { method = 'GET', headers = {}, body = null } = {}) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const transport = parsed.protocol === 'http:' ? http : https;
      const requestOptions = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
        path: parsed.pathname + parsed.search,
        method,
        headers,
        timeout: this._timeoutMs,
      };

      const req = transport.request(requestOptions, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf-8'),
          });
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error('HTTP/1.1 request timeout'));
      });

      if (body) req.write(body);
      req.end();
    });
  }
}
