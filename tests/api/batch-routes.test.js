// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for batch import/export route handler logic.
 *
 * Re-implements validation and result building as pure functions.
 * No HTTP server or real DB required.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// ── Re-implemented constants and helpers ─────────────────────────────────────

const BATCH_SIZE_LIMIT = 100;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUUID(id) {
  if (typeof id !== 'string') return false;
  return UUID_REGEX.test(id);
}

function validateBatchItem(item) {
  const errors = [];
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return { valid: false, errors: ['Item must be a JSON object'] };
  }
  for (const field of ['artifact_type', 'name', 'content']) {
    if (item[field] === undefined || item[field] === null || item[field] === '') {
      errors.push(`Missing required field: ${field}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Mirrors handleBatchImport validation logic (pre-DB phase).
 */
function processBatchImport(body) {
  if (!body || !Array.isArray(body.artifacts)) {
    return { httpStatus: 400, response: { error: 'Request body must include an artifacts array' } };
  }

  if (body.artifacts.length === 0) {
    return { httpStatus: 200, response: { imported: 0, errors: [] } };
  }

  if (body.artifacts.length > BATCH_SIZE_LIMIT) {
    return {
      httpStatus: 400,
      response: {
        error: `Batch size exceeds limit of ${BATCH_SIZE_LIMIT}`,
        provided: body.artifacts.length,
      },
    };
  }

  const itemErrors = [];
  const validItems = [];

  for (let i = 0; i < body.artifacts.length; i++) {
    const { valid, errors } = validateBatchItem(body.artifacts[i]);
    if (!valid) {
      itemErrors.push({ index: i, errors });
    } else {
      validItems.push(i);
    }
  }

  return { httpStatus: 200, itemErrors, validItemCount: validItems.length };
}

/**
 * Mirrors handleBatchExport validation logic (pre-DB phase).
 */
function processBatchExport(body) {
  if (!body || !Array.isArray(body.ids)) {
    return { httpStatus: 400, response: { error: 'Request body must include an ids array' } };
  }

  if (body.ids.length === 0) {
    return { httpStatus: 200, response: { artifacts: [] } };
  }

  if (body.ids.length > BATCH_SIZE_LIMIT) {
    return {
      httpStatus: 400,
      response: {
        error: `Batch size exceeds limit of ${BATCH_SIZE_LIMIT}`,
        provided: body.ids.length,
      },
    };
  }

  const validIds = body.ids.filter(id => validateUUID(id));
  return { httpStatus: 200, validIds };
}

function makeValidItem(overrides = {}) {
  return {
    artifact_type: 'workflow',
    name: 'Test Workflow',
    content: { nodes: [] },
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Batch Routes', () => {

  describe('Import — basic validation', () => {
    it('rejects missing artifacts array', () => {
      const { httpStatus } = processBatchImport({});
      assert.equal(httpStatus, 400);
    });

    it('rejects non-array artifacts field', () => {
      const { httpStatus } = processBatchImport({ artifacts: 'not an array' });
      assert.equal(httpStatus, 400);
    });

    it('returns 200 with zero imported for empty array', () => {
      const { httpStatus, response } = processBatchImport({ artifacts: [] });
      assert.equal(httpStatus, 200);
      assert.equal(response.imported, 0);
      assert.deepEqual(response.errors, []);
    });

    it('rejects batch exceeding size limit', () => {
      const oversized = Array.from({ length: 101 }, () => makeValidItem());
      const { httpStatus, response } = processBatchImport({ artifacts: oversized });
      assert.equal(httpStatus, 400);
      assert.ok(response.error.includes('limit'));
      assert.equal(response.provided, 101);
    });

    it('accepts batch at exactly the limit', () => {
      const exactly = Array.from({ length: 100 }, () => makeValidItem());
      const { validItemCount } = processBatchImport({ artifacts: exactly });
      assert.equal(validItemCount, 100);
    });
  });

  describe('Import — per-item validation', () => {
    it('reports error for item missing name', () => {
      const { itemErrors } = processBatchImport({ artifacts: [makeValidItem({ name: undefined })] });
      assert.equal(itemErrors.length, 1);
      assert.equal(itemErrors[0].index, 0);
      assert.ok(itemErrors[0].errors.some(e => e.includes('name')));
    });

    it('reports error for item missing artifact_type', () => {
      const { itemErrors } = processBatchImport({ artifacts: [makeValidItem({ artifact_type: undefined })] });
      assert.equal(itemErrors.length, 1);
      assert.ok(itemErrors[0].errors.some(e => e.includes('artifact_type')));
    });

    it('reports error for item missing content', () => {
      const { itemErrors } = processBatchImport({ artifacts: [makeValidItem({ content: undefined })] });
      assert.equal(itemErrors.length, 1);
      assert.ok(itemErrors[0].errors.some(e => e.includes('content')));
    });

    it('handles partial failures — valid items counted separately', () => {
      const artifacts = [
        makeValidItem(),
        makeValidItem({ name: undefined }),
        makeValidItem(),
      ];
      const { itemErrors, validItemCount } = processBatchImport({ artifacts });
      assert.equal(itemErrors.length, 1);
      assert.equal(itemErrors[0].index, 1);
      assert.equal(validItemCount, 2);
    });

    it('reports correct index for failing items', () => {
      const artifacts = [
        makeValidItem(),
        makeValidItem({ artifact_type: undefined }),
        makeValidItem({ content: undefined }),
      ];
      const { itemErrors } = processBatchImport({ artifacts });
      const indices = itemErrors.map(e => e.index);
      assert.deepEqual(indices, [1, 2]);
    });

    it('accepts all valid items with no errors', () => {
      const artifacts = [makeValidItem(), makeValidItem(), makeValidItem()];
      const { itemErrors, validItemCount } = processBatchImport({ artifacts });
      assert.equal(itemErrors.length, 0);
      assert.equal(validItemCount, 3);
    });
  });

  describe('Export — basic validation', () => {
    it('rejects missing ids array', () => {
      const { httpStatus } = processBatchExport({});
      assert.equal(httpStatus, 400);
    });

    it('returns empty artifacts for empty ids array', () => {
      const { httpStatus, response } = processBatchExport({ ids: [] });
      assert.equal(httpStatus, 200);
      assert.deepEqual(response.artifacts, []);
    });

    it('rejects batch exceeding size limit', () => {
      const ids = Array.from({ length: 101 }, () => randomUUID());
      const { httpStatus, response } = processBatchExport({ ids });
      assert.equal(httpStatus, 400);
      assert.equal(response.provided, 101);
    });
  });

  describe('Export — ID validation', () => {
    it('filters out invalid UUIDs', () => {
      const validId = randomUUID();
      const { validIds } = processBatchExport({ ids: [validId, 'not-a-uuid', '12345'] });
      assert.deepEqual(validIds, [validId]);
    });

    it('returns all IDs when all are valid', () => {
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      const { validIds } = processBatchExport({ ids });
      assert.equal(validIds.length, 3);
    });

    it('returns empty validIds when all are invalid', () => {
      const { validIds } = processBatchExport({ ids: ['bad', 'invalid', ''] });
      assert.equal(validIds.length, 0);
    });
  });

  describe('Batch item validation — edge cases', () => {
    it('rejects null item', () => {
      const { valid } = validateBatchItem(null);
      assert.equal(valid, false);
    });

    it('rejects array item', () => {
      const { valid } = validateBatchItem([]);
      assert.equal(valid, false);
    });

    it('rejects item with empty string name', () => {
      const { valid } = validateBatchItem(makeValidItem({ name: '' }));
      assert.equal(valid, false);
    });

    it('accepts item with all required fields', () => {
      const { valid } = validateBatchItem(makeValidItem());
      assert.equal(valid, true);
    });
  });
});
