// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #890 — Provenance Tracker (dedicated)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isValidEvent, createProvenanceRecord, PROVENANCE_EVENTS } from '../../src/self-maintenance/provenance-tracker.js';

describe('Provenance Tracker (source import)', () => {
  describe('PROVENANCE_EVENTS', () => {
    it('should define at least 10 event types', () => {
      assert.ok(PROVENANCE_EVENTS.length >= 10);
    });
    it('should include harvested', () => { assert.ok(PROVENANCE_EVENTS.includes('harvested')); });
    it('should include classified', () => { assert.ok(PROVENANCE_EVENTS.includes('classified')); });
    it('should include scored', () => { assert.ok(PROVENANCE_EVENTS.includes('scored')); });
    it('should include enriched', () => { assert.ok(PROVENANCE_EVENTS.includes('enriched')); });
    it('should include validated', () => { assert.ok(PROVENANCE_EVENTS.includes('validated')); });
    it('should include merged', () => { assert.ok(PROVENANCE_EVENTS.includes('merged')); });
    it('should include archived', () => { assert.ok(PROVENANCE_EVENTS.includes('archived')); });
    it('should include restored', () => { assert.ok(PROVENANCE_EVENTS.includes('restored')); });
    it('should include exported', () => { assert.ok(PROVENANCE_EVENTS.includes('exported')); });
    it('should include transformed', () => { assert.ok(PROVENANCE_EVENTS.includes('transformed')); });
  });

  describe('isValidEvent', () => {
    it('should accept valid event types', () => {
      for (const e of PROVENANCE_EVENTS) {
        assert.ok(isValidEvent(e), `${e} should be valid`);
      }
    });
    it('should reject invalid event type', () => {
      assert.ok(!isValidEvent('invalid_event'));
    });
    it('should reject empty string', () => {
      assert.ok(!isValidEvent(''));
    });
  });

  describe('createProvenanceRecord', () => {
    it('should create a record with required fields', () => {
      const r = createProvenanceRecord('art-1', 'harvested', { source: 'github' });
      assert.equal(r.artifact_id, 'art-1');
      assert.equal(r.event_type, 'harvested');
      assert.deepEqual(r.details, { source: 'github' });
      assert.ok(r.timestamp);
    });
    it('should default details to empty object', () => {
      const r = createProvenanceRecord('art-1', 'scored');
      assert.deepEqual(r.details, {});
    });
    it('should include ISO timestamp', () => {
      const r = createProvenanceRecord('art-1', 'classified');
      assert.ok(r.timestamp.includes('T'));
    });
  });
});
