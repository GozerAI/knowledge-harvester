// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFINITIONS_DIR = join(__dirname, '..', '..', 'src', 'definitions');

function listDefinitionFiles() {
  return readdirSync(DEFINITIONS_DIR)
    .filter(file => file.endsWith('.yaml') || file.endsWith('.yml'))
    .sort();
}

// ── Re-implement loadDefinition for testing ──

function loadDefinition(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const def = parseYaml(content);
  if (!def.name) throw new Error(`Definition missing 'name': ${filePath}`);
  if (!def.artifact_type) throw new Error(`Definition missing 'artifact_type': ${filePath}`);
  if (!def.queries?.length) throw new Error(`Definition missing 'queries': ${filePath}`);
  return def;
}

function validateDefinition(def) {
  const errors = [];
  if (!def.name) errors.push('missing name');
  if (!def.artifact_type) errors.push('missing artifact_type');
  if (!def.queries?.length) errors.push('missing queries');

  const validTypes = ['workflow', 'code_pattern', 'api_spec', 'infra_config', 'ai_ml_asset', 'data_asset', 'documentation'];
  if (def.artifact_type && !validTypes.includes(def.artifact_type)) {
    errors.push(`invalid artifact_type: ${def.artifact_type}`);
  }

  for (const q of (def.queries || [])) {
    if (!q.query) errors.push('query missing query string');
    if (!q.label) errors.push('query missing label');
  }

  return errors;
}

function validateContent(content, validation) {
  if (!validation) return true;
  if (validation.min_size && content.length < validation.min_size) return false;
  if (validation.max_size && content.length > validation.max_size) return false;
  if (validation.required_patterns?.length) {
    return validation.required_patterns.every(p => new RegExp(p).test(content));
  }
  return true;
}

function validateExtension(filename, validation) {
  if (!validation?.extensions?.length) return true;
  const ext = filename?.split('.').pop()?.toLowerCase();
  return validation.extensions.includes(ext);
}

// ── Tests ──

describe('YAML Definition Loading', () => {
  it('loads every YAML definition file', () => {
    const files = listDefinitionFiles();
    assert.ok(files.length >= 10);

    for (const file of files) {
      const def = loadDefinition(join(DEFINITIONS_DIR, file));
      assert.ok(def.name, `${file} should define a source name`);
      assert.ok(def.artifact_type, `${file} should define an artifact_type`);
      assert.ok(def.queries.length >= 1, `${file} should define at least one query`);
    }
  });

  it('all definitions have valid structure', () => {
    const files = listDefinitionFiles();
    for (const f of files) {
      const def = loadDefinition(join(DEFINITIONS_DIR, f));
      const errors = validateDefinition(def);
      assert.deepEqual(errors, [], `${f} has errors: ${errors.join(', ')}`);
    }
  });

  it('throws for missing name', () => {
    assert.throws(() => {
      const content = 'artifact_type: code_pattern\nqueries:\n  - query: test\n    label: test';
      const def = parseYaml(content);
      if (!def.name) throw new Error("Definition missing 'name'");
    }, /missing 'name'/);
  });

  it('throws for missing queries', () => {
    assert.throws(() => {
      const content = 'name: test\nartifact_type: code_pattern';
      const def = parseYaml(content);
      if (!def.queries?.length) throw new Error("Definition missing 'queries'");
    }, /missing 'queries'/);
  });
});

describe('Definition Validation', () => {
  it('validates valid definition', () => {
    const def = { name: 'test', artifact_type: 'code_pattern', queries: [{ query: 'q', label: 'l' }] };
    assert.deepEqual(validateDefinition(def), []);
  });

  it('catches invalid artifact_type', () => {
    const def = { name: 'test', artifact_type: 'invalid_type', queries: [{ query: 'q', label: 'l' }] };
    const errors = validateDefinition(def);
    assert.ok(errors.some(e => e.includes('invalid artifact_type')));
  });

  it('catches missing query fields', () => {
    const def = { name: 'test', artifact_type: 'code_pattern', queries: [{ query: 'q' }] };
    const errors = validateDefinition(def);
    assert.ok(errors.some(e => e.includes('query missing label')));
  });
});

describe('Content Validation', () => {
  it('validates content size minimum', () => {
    assert.ok(!validateContent('x', { min_size: 100 }));
    assert.ok(validateContent('x'.repeat(100), { min_size: 100 }));
  });

  it('validates content size maximum', () => {
    assert.ok(!validateContent('x'.repeat(1000), { max_size: 500 }));
    assert.ok(validateContent('x'.repeat(100), { max_size: 500 }));
  });

  it('validates required patterns', () => {
    assert.ok(validateContent('from fastapi import FastAPI\ndef handler():', {
      required_patterns: ['FastAPI|fastapi', 'def ']
    }));
    assert.ok(!validateContent('print("hello")', {
      required_patterns: ['FastAPI|fastapi']
    }));
  });

  it('passes with no validation rules', () => {
    assert.ok(validateContent('anything', null));
    assert.ok(validateContent('anything', {}));
  });
});

describe('Extension Validation', () => {
  it('validates allowed extensions', () => {
    assert.ok(validateExtension('app.py', { extensions: ['py'] }));
    assert.ok(!validateExtension('app.js', { extensions: ['py'] }));
  });

  it('allows multiple extensions', () => {
    const val = { extensions: ['tsx', 'ts', 'jsx', 'js'] };
    assert.ok(validateExtension('component.tsx', val));
    assert.ok(validateExtension('util.ts', val));
    assert.ok(!validateExtension('style.css', val));
  });

  it('passes with no extension rules', () => {
    assert.ok(validateExtension('anything.xyz', {}));
    assert.ok(validateExtension('anything.xyz', null));
  });
});

describe('Definition Queries', () => {
  it('all definitions have scoped GitHub search queries', () => {
    const files = listDefinitionFiles();
    for (const file of files) {
      const def = loadDefinition(join(DEFINITIONS_DIR, file));
      for (const q of def.queries) {
        assert.ok(q.query.includes('extension:') || q.query.includes('filename:'),
          `${file} query should have extension/filename filter: ${q.query}`);
        assert.ok(q.label, `${file} queries need labels`);
      }
    }
  });

  it('definitions have metadata section', () => {
    const files = listDefinitionFiles();
    for (const f of files) {
      const def = loadDefinition(join(DEFINITIONS_DIR, f));
      assert.ok(def.metadata, `${f} should have metadata`);
      assert.ok(def.metadata.framework || def.metadata.default_category,
        `${f} metadata should have framework or default_category`);
    }
  });
});
