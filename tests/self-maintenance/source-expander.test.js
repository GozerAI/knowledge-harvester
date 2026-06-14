// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #873 — Source Discovery Expansion (dedicated)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractOrgUrl, extractOrgName, extractDomain } from '../../src/self-maintenance/source-expander.js';

describe('Source Expander (source import)', () => {
  describe('extractOrgUrl', () => {
    it('should extract org URL from GitHub repo URL', () => {
      assert.equal(extractOrgUrl('https://github.com/langchain-ai/langchain'), 'https://github.com/langchain-ai');
    });
    it('should extract org URL from GitHub user URL', () => {
      assert.equal(extractOrgUrl('https://github.com/facebook/react'), 'https://github.com/facebook');
    });
    it('should return null for non-GitHub URL', () => {
      assert.equal(extractOrgUrl('https://gitlab.com/group/project'), null);
    });
    it('should return null for null', () => {
      assert.equal(extractOrgUrl(null), null);
    });
    it('should handle http URLs', () => {
      assert.equal(extractOrgUrl('http://github.com/org/repo'), 'https://github.com/org');
    });
  });

  describe('extractOrgName', () => {
    it('should extract org name from GitHub URL', () => {
      assert.equal(extractOrgName('https://github.com/facebook/react'), 'facebook');
    });
    it('should return null for non-GitHub URL', () => {
      assert.equal(extractOrgName('https://gitlab.com/group/project'), null);
    });
    it('should return null for null', () => {
      assert.equal(extractOrgName(null), null);
    });
  });

  describe('extractDomain', () => {
    it('should extract domain from https URL', () => {
      assert.equal(extractDomain('https://github.com/org/repo'), 'github.com');
    });
    it('should extract domain from http URL', () => {
      assert.equal(extractDomain('http://example.com/path'), 'example.com');
    });
    it('should return null for invalid URL', () => {
      assert.equal(extractDomain('not-a-url'), null);
    });
    it('should return null for null', () => {
      assert.equal(extractDomain(null), null);
    });
    it('should extract domain with subdomain', () => {
      assert.equal(extractDomain('https://docs.github.com/en'), 'docs.github.com');
    });
  });
});
