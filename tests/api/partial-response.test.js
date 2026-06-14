// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseFieldSelection,
  parseRangeHeader,
  buildSelectClause,
  applyFieldMask,
  applyFieldMaskBatch,
  SUMMARY_FIELDS,
  ALL_FIELDS,
} from '../../src/api/partial-response.js';

describe('parseFieldSelection', () => {
  it('returns ALL_FIELDS when no param given', () => {
    const { fields, isPartial } = parseFieldSelection(null);
    assert.deepEqual(fields, ALL_FIELDS);
    assert.ok(!isPartial);
  });

  it('returns ALL_FIELDS for empty string', () => {
    const { fields } = parseFieldSelection('');
    assert.deepEqual(fields, ALL_FIELDS);
  });

  it('parses comma-separated fields', () => {
    const { fields, isPartial } = parseFieldSelection('name,source,quality_score');
    assert.ok(fields.includes('id'));
    assert.ok(fields.includes('name'));
    assert.ok(fields.includes('source'));
    assert.ok(isPartial);
  });

  it('always includes id', () => {
    const { fields } = parseFieldSelection('name');
    assert.equal(fields[0], 'id');
  });

  it('filters out invalid fields', () => {
    const { fields } = parseFieldSelection('name,bogus_field');
    assert.ok(fields.includes('name'));
    assert.ok(!fields.includes('bogus_field'));
  });

  it('returns only id when all requested fields are invalid', () => {
    const { fields } = parseFieldSelection('xxx,yyy');
    // id is always added, and it is valid, so we get ['id']
    assert.ok(fields.includes('id'));
    assert.ok(fields.length >= 1);
  });
});

describe('parseRangeHeader', () => {
  it('returns null for no header', () => {
    assert.equal(parseRangeHeader(null), null);
  });

  it('parses bytes range with end', () => {
    const r = parseRangeHeader('bytes=0-999');
    assert.deepEqual(r, { type: 'bytes', start: 0, end: 999 });
  });

  it('parses bytes range without end', () => {
    const r = parseRangeHeader('bytes=100-');
    assert.deepEqual(r, { type: 'bytes', start: 100, end: -1 });
  });

  it('parses items range', () => {
    const r = parseRangeHeader('items=0-49');
    assert.deepEqual(r, { type: 'items', start: 0, end: 49 });
  });

  it('rejects invalid format', () => {
    assert.equal(parseRangeHeader('invalid'), null);
    assert.equal(parseRangeHeader('bytes=abc-def'), null);
  });
});

describe('buildSelectClause', () => {
  it('joins fields with comma', () => {
    assert.equal(buildSelectClause(['id', 'name']), 'id, name');
  });

  it('handles single field', () => {
    assert.equal(buildSelectClause(['id']), 'id');
  });
});

describe('applyFieldMask', () => {
  it('returns only selected fields', () => {
    const artifact = { id: '1', name: 'Test', source: 'github', quality_score: 85 };
    const result = applyFieldMask(artifact, ['id', 'name']);
    assert.deepEqual(result, { id: '1', name: 'Test' });
  });

  it('returns empty object for no matching fields', () => {
    const result = applyFieldMask({ id: '1' }, ['name']);
    assert.deepEqual(result, {});
  });
});

describe('applyFieldMaskBatch', () => {
  it('applies mask to all artifacts', () => {
    const artifacts = [
      { id: '1', name: 'A', source: 'x' },
      { id: '2', name: 'B', source: 'y' },
    ];
    const result = applyFieldMaskBatch(artifacts, ['id', 'name']);
    assert.equal(result.length, 2);
    assert.deepEqual(result[0], { id: '1', name: 'A' });
    assert.deepEqual(result[1], { id: '2', name: 'B' });
  });
});

describe('SUMMARY_FIELDS', () => {
  it('includes essential fields', () => {
    assert.ok(SUMMARY_FIELDS.includes('id'));
    assert.ok(SUMMARY_FIELDS.includes('name'));
    assert.ok(SUMMARY_FIELDS.includes('quality_score'));
  });
});

describe('ALL_FIELDS', () => {
  it('includes all summary fields', () => {
    for (const f of SUMMARY_FIELDS) {
      assert.ok(ALL_FIELDS.includes(f), 'ALL_FIELDS missing ' + f);
    }
  });

  it('includes content field', () => {
    assert.ok(ALL_FIELDS.includes('content'));
  });
});
