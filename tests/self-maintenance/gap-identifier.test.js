// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #869 — Gap Identifier (dedicated)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EXPECTED_DOMAINS } from '../../src/self-maintenance/gap-identifier.js';

describe('Gap Identifier (source import)', () => {
  it('should have at least 5 expected domains', () => {
    assert.ok(EXPECTED_DOMAINS.length >= 5);
  });

  it('should include automation domain', () => {
    assert.ok(EXPECTED_DOMAINS.some(d => d.domain === 'automation'));
  });

  it('should include infrastructure domain', () => {
    assert.ok(EXPECTED_DOMAINS.some(d => d.domain === 'infrastructure'));
  });

  it('should include ai-agents domain', () => {
    assert.ok(EXPECTED_DOMAINS.some(d => d.domain === 'ai-agents'));
  });

  it('should have minArtifacts for each domain', () => {
    for (const d of EXPECTED_DOMAINS) {
      assert.ok(d.minArtifacts > 0, `${d.domain} should have minArtifacts > 0`);
    }
  });

  it('should have types for each domain', () => {
    for (const d of EXPECTED_DOMAINS) {
      assert.ok(d.types.length > 0, `${d.domain} should have types`);
    }
  });

  it('should have unique domain names', () => {
    const names = EXPECTED_DOMAINS.map(d => d.domain);
    assert.equal(new Set(names).size, names.length);
  });
});
