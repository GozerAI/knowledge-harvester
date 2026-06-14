// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #880 — Autonomous Knowledge Export Formatting
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const SUPPORTED_FORMATS = ['json', 'csv', 'markdown', 'yaml'];

function csvEscape(val) {
  if (val == null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function yamlEscape(val) {
  if (val == null) return '""';
  const str = String(val);
  if (str.includes(':') || str.includes('#') || str.includes('\n') || str.includes('"')) return `"${str.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
  return str;
}

function formatJson(artifacts) {
  return JSON.stringify({ exported_at: new Date().toISOString(), count: artifacts.length, artifacts }, null, 2);
}

function formatCsv(artifacts) {
  if (artifacts.length === 0) return '';
  const headers = ['id', 'name', 'description', 'primary_category', 'artifact_type', 'source_url', 'quality_score', 'created_at', 'updated_at'];
  const rows = [headers.join(',')];
  for (const a of artifacts) rows.push(headers.map(h => csvEscape(a[h])).join(','));
  return rows.join('\n');
}

function formatMarkdown(artifacts) {
  const lines = [`# Knowledge Export`, ``, `> ${artifacts.length} artifacts exported on ${new Date().toISOString()}`, ``];
  for (const a of artifacts) {
    lines.push(`## ${a.name || 'Untitled'}`);
    lines.push(``);
    if (a.description) lines.push(a.description);
    lines.push(``);
    lines.push(`- **Type:** ${a.artifact_type || 'unknown'}`);
    lines.push(`- **Category:** ${a.primary_category || 'uncategorized'}`);
    if (a.source_url) lines.push(`- **Source:** ${a.source_url}`);
    if (a.quality_score != null) lines.push(`- **Quality:** ${a.quality_score}`);
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
  }
  return lines.join('\n');
}

describe('Export Formatter', () => {
  describe('csvEscape', () => {
    it('should return empty for null', () => { assert.equal(csvEscape(null), ''); });
    it('should pass simple strings', () => { assert.equal(csvEscape('hello'), 'hello'); });
    it('should quote strings with commas', () => { assert.equal(csvEscape('a,b'), '"a,b"'); });
    it('should escape double quotes', () => { assert.equal(csvEscape('say "hi"'), '"say ""hi"""'); });
    it('should quote strings with newlines', () => { assert.ok(csvEscape('line1\nline2').startsWith('"')); });
    it('should handle numbers', () => { assert.equal(csvEscape(42), '42'); });
  });

  describe('yamlEscape', () => {
    it('should return quoted empty for null', () => { assert.equal(yamlEscape(null), '""'); });
    it('should pass simple strings', () => { assert.equal(yamlEscape('hello'), 'hello'); });
    it('should quote strings with colons', () => { assert.ok(yamlEscape('key: value').startsWith('"')); });
    it('should quote strings with hash', () => { assert.ok(yamlEscape('text # comment').startsWith('"')); });
    it('should escape newlines', () => { assert.ok(yamlEscape('line1\nline2').includes('\\n')); });
  });

  describe('SUPPORTED_FORMATS', () => {
    it('should include json', () => { assert.ok(SUPPORTED_FORMATS.includes('json')); });
    it('should include csv', () => { assert.ok(SUPPORTED_FORMATS.includes('csv')); });
    it('should include markdown', () => { assert.ok(SUPPORTED_FORMATS.includes('markdown')); });
    it('should include yaml', () => { assert.ok(SUPPORTED_FORMATS.includes('yaml')); });
    it('should have exactly 4 formats', () => { assert.equal(SUPPORTED_FORMATS.length, 4); });
  });

  describe('formatJson', () => {
    it('should produce valid JSON', () => {
      const json = formatJson([{ id: '1', name: 'Test' }]);
      const parsed = JSON.parse(json);
      assert.equal(parsed.count, 1);
      assert.equal(parsed.artifacts[0].id, '1');
    });
    it('should handle empty array', () => {
      const parsed = JSON.parse(formatJson([]));
      assert.equal(parsed.count, 0);
    });
    it('should include exported_at', () => {
      const parsed = JSON.parse(formatJson([]));
      assert.ok(parsed.exported_at);
    });
  });

  describe('formatCsv', () => {
    it('should return empty for no artifacts', () => {
      assert.equal(formatCsv([]), '');
    });
    it('should include header row', () => {
      const csv = formatCsv([{ id: '1', name: 'Test' }]);
      assert.ok(csv.startsWith('id,name,'));
    });
    it('should include data row', () => {
      const csv = formatCsv([{ id: '1', name: 'Test', artifact_type: 'workflow' }]);
      const lines = csv.split('\n');
      assert.equal(lines.length, 2);
    });
  });

  describe('formatMarkdown', () => {
    it('should include heading', () => {
      const md = formatMarkdown([]);
      assert.ok(md.includes('# Knowledge Export'));
    });
    it('should include artifact names as h2', () => {
      const md = formatMarkdown([{ name: 'My Artifact', artifact_type: 'workflow' }]);
      assert.ok(md.includes('## My Artifact'));
    });
    it('should handle null name', () => {
      const md = formatMarkdown([{ name: null, artifact_type: 'workflow' }]);
      assert.ok(md.includes('## Untitled'));
    });
    it('should include type', () => {
      const md = formatMarkdown([{ name: 'X', artifact_type: 'code_pattern' }]);
      assert.ok(md.includes('code_pattern'));
    });
  });
});
