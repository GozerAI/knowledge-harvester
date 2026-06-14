// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #871 — Citation Verifier (dedicated)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isUrl, classifyUrlPlatform } from '../../src/self-maintenance/citation-verifier.js';

describe('Citation Verifier (source import)', () => {
  describe('isUrl', () => {
    it('should validate https URL', () => { assert.ok(isUrl('https://github.com')); });
    it('should validate http URL', () => { assert.ok(isUrl('http://example.com')); });
    it('should reject ftp URL', () => { assert.ok(!isUrl('ftp://files.com/data')); });
    it('should reject non-URL', () => { assert.ok(!isUrl('not-a-url')); });
    it('should reject empty string', () => { assert.ok(!isUrl('')); });
    it('should validate URL with path', () => { assert.ok(isUrl('https://github.com/org/repo')); });
    it('should validate URL with query', () => { assert.ok(isUrl('https://example.com?q=test')); });
    it('should validate URL with port', () => { assert.ok(isUrl('http://localhost:3000')); });
  });

  describe('classifyUrlPlatform', () => {
    it('should detect github', () => { assert.equal(classifyUrlPlatform('https://github.com/org/repo'), 'github'); });
    it('should detect gitlab', () => { assert.equal(classifyUrlPlatform('https://gitlab.com/group/proj'), 'gitlab'); });
    it('should detect bitbucket', () => { assert.equal(classifyUrlPlatform('https://bitbucket.org/team/repo'), 'bitbucket'); });
    it('should detect npm', () => { assert.equal(classifyUrlPlatform('https://www.npmjs.com/package/x'), 'npm'); });
    it('should detect pypi', () => { assert.equal(classifyUrlPlatform('https://pypi.org/project/x/'), 'pypi'); });
    it('should detect docker', () => { assert.equal(classifyUrlPlatform('https://hub.docker.com/r/lib/img'), 'docker'); });
    it('should return other for unknown', () => { assert.equal(classifyUrlPlatform('https://example.com'), 'other'); });
    it('should return null for null', () => { assert.equal(classifyUrlPlatform(null), null); });
  });
});
