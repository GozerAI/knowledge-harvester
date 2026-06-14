// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Reimplemented pure logic from analytics-store.js ─────────────────────────

const WINDOW_INTERVALS = {
  '7d':  '7 days',
  '30d': '30 days',
  '90d': '90 days',
};

function resolveInterval(window) {
  const interval = WINDOW_INTERVALS[window];
  if (!interval) {
    throw new Error(`Invalid window '${window}'. Valid values: ${Object.keys(WINDOW_INTERVALS).join(', ')}`);
  }
  return interval;
}

function resolveEntityType(meta) {
  if (meta && typeof meta.entity_type === 'string' && meta.entity_type.length > 0) {
    return meta.entity_type;
  }
  return 'artifact';
}

function buildEventObject(type, entityId, meta) {
  if (!type) throw new Error('event type is required');
  if (!entityId) throw new Error('entityId is required');

  const entity_type = resolveEntityType(meta);
  const cleanMeta = meta ? { ...meta } : {};
  delete cleanMeta.entity_type;

  return {
    event_type: type,
    entity_type,
    entity_id: entityId,
    metadata: JSON.stringify(cleanMeta),
  };
}

function buildPopularQuery(window, limit) {
  resolveInterval(window); // validates; throws on bad input
  return {
    sql: `SELECT artifact_id, recent_events, artifact_type, primary_category, name
          FROM artifact_popularity
          ORDER BY recent_events DESC
          LIMIT $1`,
    params: [limit],
  };
}

function buildTrendsQuery(window) {
  const interval = resolveInterval(window);
  return {
    sql: `SELECT DATE(created_at) AS date, event_type, COUNT(*) AS count
          FROM analytics_events
          WHERE created_at >= NOW() - $1::interval
          GROUP BY DATE(created_at), event_type
          ORDER BY date ASC, event_type ASC`,
    params: [interval],
  };
}

// Mock aggregation: simulate daily trend counts from raw events
function aggregateTrends(events) {
  const map = new Map();
  for (const ev of events) {
    const key = `${ev.date}|${ev.event_type}`;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map.entries()).map(([key, count]) => {
    const [date, event_type] = key.split('|');
    return { date, event_type, count };
  });
}

// ── Event object construction ─────────────────────────────────────────────────

describe('buildEventObject — basic construction', () => {
  it('builds correct event object shape', () => {
    const ev = buildEventObject('view', 'artifact-123', null);
    assert.equal(ev.event_type, 'view');
    assert.equal(ev.entity_id, 'artifact-123');
    assert.equal(ev.entity_type, 'artifact');
    assert.equal(ev.metadata, '{}');
  });

  it('preserves arbitrary metadata fields', () => {
    const ev = buildEventObject('download', 'id-1', { source: 'search', referrer: 'homepage' });
    const meta = JSON.parse(ev.metadata);
    assert.equal(meta.source, 'search');
    assert.equal(meta.referrer, 'homepage');
  });

  it('strips entity_type from metadata before storing', () => {
    const ev = buildEventObject('view', 'id-1', { entity_type: 'bundle', extra: 'x' });
    const meta = JSON.parse(ev.metadata);
    assert.ok(!('entity_type' in meta));
    assert.equal(meta.extra, 'x');
  });

  it('uses entity_type from meta when provided', () => {
    const ev = buildEventObject('purchase', 'bundle-99', { entity_type: 'bundle' });
    assert.equal(ev.entity_type, 'bundle');
  });

  it('defaults entity_type to artifact when meta is null', () => {
    const ev = buildEventObject('view', 'id-1', null);
    assert.equal(ev.entity_type, 'artifact');
  });

  it('throws when type is missing', () => {
    assert.throws(() => buildEventObject('', 'id-1', null), /event type is required/);
  });

  it('throws when entityId is missing', () => {
    assert.throws(() => buildEventObject('view', '', null), /entityId is required/);
  });

  it('throws when entityId is null', () => {
    assert.throws(() => buildEventObject('view', null, null), /entityId is required/);
  });
});

// ── Popular query parameter building ─────────────────────────────────────────

describe('buildPopularQuery — window to interval conversion', () => {
  it('7d window produces valid query with correct limit', () => {
    const { params } = buildPopularQuery('7d', 10);
    assert.equal(params[0], 10);
  });

  it('30d window is accepted', () => {
    assert.doesNotThrow(() => buildPopularQuery('30d', 20));
  });

  it('90d window is accepted', () => {
    assert.doesNotThrow(() => buildPopularQuery('90d', 5));
  });

  it('invalid window throws descriptive error', () => {
    assert.throws(
      () => buildPopularQuery('14d', 20),
      /Invalid window/,
    );
  });

  it('query selects from artifact_popularity', () => {
    const { sql } = buildPopularQuery('7d', 10);
    assert.ok(sql.includes('artifact_popularity'));
  });

  it('query orders by recent_events DESC', () => {
    const { sql } = buildPopularQuery('7d', 10);
    assert.ok(sql.includes('recent_events DESC'));
  });
});

// ── Trends aggregation logic ──────────────────────────────────────────────────

describe('buildTrendsQuery — SQL construction', () => {
  it('7d resolves to 7 days interval', () => {
    const { params } = buildTrendsQuery('7d');
    assert.equal(params[0], '7 days');
  });

  it('30d resolves to 30 days interval', () => {
    const { params } = buildTrendsQuery('30d');
    assert.equal(params[0], '30 days');
  });

  it('90d resolves to 90 days interval', () => {
    const { params } = buildTrendsQuery('90d');
    assert.equal(params[0], '90 days');
  });

  it('query groups by date and event_type', () => {
    const { sql } = buildTrendsQuery('7d');
    assert.ok(sql.includes('GROUP BY'));
    assert.ok(sql.includes('event_type'));
  });

  it('invalid window throws', () => {
    assert.throws(() => buildTrendsQuery('invalid'), /Invalid window/);
  });
});

describe('aggregateTrends — daily count logic', () => {
  it('aggregates single event type on single day', () => {
    const events = [
      { date: '2026-03-01', event_type: 'view' },
      { date: '2026-03-01', event_type: 'view' },
    ];
    const result = aggregateTrends(events);
    assert.equal(result.length, 1);
    assert.equal(result[0].count, 2);
  });

  it('separates different event types on same day', () => {
    const events = [
      { date: '2026-03-01', event_type: 'view' },
      { date: '2026-03-01', event_type: 'download' },
    ];
    const result = aggregateTrends(events);
    assert.equal(result.length, 2);
  });

  it('returns empty array for no events', () => {
    const result = aggregateTrends([]);
    assert.equal(result.length, 0);
  });
});

// ── resolveInterval edge cases ────────────────────────────────────────────────

describe('resolveInterval — edge cases', () => {
  it('empty string throws', () => {
    assert.throws(() => resolveInterval(''), /Invalid window/);
  });

  it('null throws', () => {
    assert.throws(() => resolveInterval(null), /Invalid window/);
  });

  it('1d is not a valid window', () => {
    assert.throws(() => resolveInterval('1d'), /Invalid window/);
  });
});
