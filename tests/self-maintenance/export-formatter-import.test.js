// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #880 — Export Formatter (source import)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { csvEscape, yamlEscape, formatJson, formatCsv, formatMarkdown, formatYaml, SUPPORTED_FORMATS } from '../../src/self-maintenance/export-formatter.js';

describe('Export Formatter (source import)', () => {
  describe('SUPPORTED_FORMATS', () => {
    it('should include json', () => { assert.ok(SUPPORTED_FORMATS.includes('json')); });
    it('should include csv', () => { assert.ok(SUPPORTED_FORMATS.includes('csv')); });
    it('should include markdown', () => { assert.ok(SUPPORTED_FORMATS.includes('markdown')); });
    it('should include yaml', () => { assert.ok(SUPPORTED_FORMATS.includes('yaml')); });
  });

  describe('csvEscape', () => {
    it('should return empty for null', () => { assert.equal(csvEscape(null), ''); });
    it('should pass simple strings', () => { assert.equal(csvEscape('hello'), 'hello'); });
    it('should quote strings with commas', () => { assert.equal(csvEscape('a,b'), '"a,b"'); });
    it('should escape double quotes', () => { assert.equal(csvEscape('say "hi"'), '"say ""hi"""'); });
  });

  describe('yamlEscape', () => {
    it('should return quoted empty for null', () => { assert.equal(yamlEscape(null), '""'); });
    it('should pass simple strings', () => { assert.equal(yamlEscape('hello'), 'hello'); });
    it('should quote strings with colons', () => { assert.ok(yamlEscape('key: value').startsWith('"')); });
  });

  describe('formatJson', () => {
    it('should produce valid JSON', () => {
      const parsed = JSON.parse(formatJson([{ id: '1', name: 'Test' }]));
      assert.equal(parsed.count, 1);
    });
    it('should include exported_at', () => {
      const parsed = JSON.parse(formatJson([]));
      assert.ok(parsed.exported_at);
    });
  });

  describe('formatCsv', () => {
    it('should return empty for no artifacts', () => { assert.equal(formatCsv([]), ''); });
    it('should include header row', () => {
      const csv = formatCsv([{ id: '1', name: 'Test' }]);
      assert.ok(csv.startsWith('id,name,'));
    });
  });

  describe('formatMarkdown', () => {
    it('should include heading', () => {
      assert.ok(formatMarkdown([]).includes('# Knowledge Export'));
    });
    it('should include artifact names', () => {
      assert.ok(formatMarkdown([{ name: 'MyArt' }]).includes('## MyArt'));
    });
  });

  describe('formatYaml', () => {
    it('should include count', () => {
      const yaml = formatYaml([{ id: '1', name: 'Test', artifact_type: 'workflow' }]);
      assert.ok(yaml.includes('count: 1'));
    });
    it('should include artifact entries', () => {
      const yaml = formatYaml([{ id: '1', name: 'Test', artifact_type: 'wf' }]);
      assert.ok(yaml.includes('name: Test'));
    });
    it('should handle empty array', () => {
      const yaml = formatYaml([]);
      assert.ok(yaml.includes('count: 0'));
    });
  });
});
