// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[process.env.LOG_LEVEL || 'info'];

function log(level, msg, data = {}) {
  if (LEVELS[level] < currentLevel) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...data,
  };
  const fn = level === 'error' ? console.error : console.log;
  fn(JSON.stringify(entry));
}

export const logger = {
  debug: (msg, data) => log('debug', msg, data),
  info:  (msg, data) => log('info', msg, data),
  warn:  (msg, data) => log('warn', msg, data),
  error: (msg, data) => log('error', msg, data),
};
