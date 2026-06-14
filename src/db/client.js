// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import pg from 'pg';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

let pool = null;

function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      host: config.db.host,
      port: config.db.port,
      database: config.db.database,
      user: config.db.user,
      password: config.db.password,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      logger.error('Unexpected pool error', { error: err.message });
    });
  }

  return pool;
}

export const db = {
  query: (text, params) => getPool().query(text, params),
  getClient: () => getPool().connect(),
  end: async () => {
    if (!pool) {
      return;
    }

    const activePool = pool;
    pool = null;
    await activePool.end();
  },
};
