// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Re-implement pure extractors ──

function detectDataType(content, filename) {
  const name = (filename || '').toLowerCase();
  if (name.endsWith('.sql')) {
    if (/\balter\b.*\badd\b|\balter\b.*\bcolumn\b/i.test(content)) return 'migration';
    if (/\bref\s*\(|{{.*config.*}}/i.test(content)) return 'dbt-model';
    return 'sql-schema';
  }
  if (/\.yml$|\.yaml$/.test(name)) {
    if (/\bmodel\b.*\bsql\b|\bref\s*\(/i.test(content)) return 'dbt-model';
    if (/dataset|data_source|connection/i.test(content)) return 'dataset-config';
  }
  if (name.endsWith('.json') && /dataset|schema|fields/i.test(content)) return 'dataset-config';
  if (/\bcreate\s+table\b/i.test(content)) return 'sql-schema';
  if (/\bref\s*\(|{{.*config.*}}/i.test(content)) return 'dbt-model';
  return 'generic-data';
}

function extractSqlSchemaComponents(content) {
  const tables = [...new Set(
    (content.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)/gi) || [])
      .map(m => m.match(/TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)/i)?.[1])
      .filter(Boolean)
  )];
  const indexes = [...new Set(
    (content.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)/gi) || [])
      .map(m => m.match(/INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)/i)?.[1])
      .filter(Boolean)
  )];
  const foreignKeys = (content.match(/REFERENCES\s+[`"']?(\w+)/gi) || [])
    .map(m => m.match(/REFERENCES\s+[`"']?(\w+)/i)?.[1]).filter(Boolean);
  const hasConstraints = /\bCONSTRAINT\b|\bPRIMARY KEY\b|\bUNIQUE\b/i.test(content);
  const hasTriggers = /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|TRIGGER)\b/i.test(content);
  const hasComments = /--\s+\w/.test(content);
  return {
    tables, table_count: tables.length, indexes, index_count: indexes.length,
    foreign_keys: [...new Set(foreignKeys)], has_constraints: hasConstraints,
    has_triggers: hasTriggers, hasComments,
  };
}

function extractDbtComponents(content) {
  const refs = [...new Set(
    (content.match(/ref\s*\(\s*['"]([^'"]+)['"]\s*\)/g) || [])
      .map(m => m.match(/['"]([^'"]+)['"]/)?.[1]).filter(Boolean)
  )];
  const sources = [...new Set(
    (content.match(/source\s*\(\s*['"]([^'"]+)['"]/g) || [])
      .map(m => m.match(/['"]([^'"]+)['"]/)?.[1]).filter(Boolean)
  )];
  const materialization = content.match(/materialized\s*[=:]\s*['"]?(\w+)/i)?.[1] || null;
  const hasTests = /tests:|test:/i.test(content);
  const hasComments = /--\s+\w/.test(content) || /\bdescription\b/i.test(content);
  return {
    refs, ref_count: refs.length, sources, source_count: sources.length,
    materialization, has_materialization: !!materialization, has_tests: hasTests,
    hasComments,
  };
}

function extractMigrationComponents(content) {
  return {
    alter_count: (content.match(/\bALTER\s+TABLE/gi) || []).length,
    create_count: (content.match(/\bCREATE\s+TABLE/gi) || []).length,
    drop_count: (content.match(/\bDROP\s+TABLE/gi) || []).length,
    has_rollback: /\bDOWN\b|rollback|revert/i.test(content),
    hasComments: /--\s+\w/.test(content),
  };
}

function calculateDataAssetScore(row, meta) {
  let score = 0;
  if (row.name && !row.name.includes('Untitled')) score += 8;
  if (row.description?.length > 20) score += 8;
  if (meta.hasComments) score += 9;
  const tc = meta.table_count || meta.ref_count || 0;
  if (tc >= 1) score += 5;
  if (tc >= 3) score += 5;
  if (tc >= 5) score += 5;
  const cc = meta.column_count || meta.field_count || 0;
  if (cc >= 5) score += 5;
  if (cc >= 15) score += 5;
  if ((meta.index_count || 0) > 0) score += 5;
  if (meta.has_constraints) score += 7;
  if ((meta.foreign_keys || []).length > 0) score += 5;
  if (meta.has_tests) score += 5;
  if (meta.is_reversible || meta.has_rollback) score += 4;
  if (meta.has_materialization) score += 4;
  if (meta.has_schema) score += 5;
  if (meta.has_connection) score += 5;
  if ((meta.sources || []).length > 0) score += 5;
  if ((meta.refs || []).length > 0) score += 5;
  return Math.min(score, 100);
}

// ── Tests ──

describe('detectDataType', () => {
  it('detects SQL schema from extension', () => {
    assert.equal(detectDataType('CREATE TABLE users (id INT);', 'schema.sql'), 'sql-schema');
  });

  it('detects migration from ALTER TABLE', () => {
    assert.equal(detectDataType('ALTER TABLE users ADD COLUMN email VARCHAR;', 'migration.sql'), 'migration');
  });

  it('detects dbt model from content', () => {
    assert.equal(detectDataType("SELECT * FROM {{ ref('users') }}", 'model.sql'), 'dbt-model');
  });

  it('detects dbt model from YAML', () => {
    assert.equal(detectDataType("model:\n  sql: SELECT ref('x')", 'schema.yml'), 'dbt-model');
  });

  it('detects dataset config from YAML', () => {
    assert.equal(detectDataType('dataset:\n  connection: pg', 'config.yaml'), 'dataset-config');
  });

  it('detects dataset config from JSON', () => {
    assert.equal(detectDataType('{"dataset": "users", "fields": []}', 'data.json'), 'dataset-config');
  });

  it('returns generic-data for unknown', () => {
    assert.equal(detectDataType('just text', 'notes.txt'), 'generic-data');
  });
});

describe('extractSqlSchemaComponents', () => {
  it('extracts tables, indexes, and foreign keys', () => {
    const sql = `
CREATE TABLE users (
  id UUID PRIMARY KEY,
  name VARCHAR NOT NULL,
  CONSTRAINT uq_name UNIQUE(name)
);
CREATE TABLE posts (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id)
);
CREATE INDEX idx_posts_user ON posts(user_id);`;
    const result = extractSqlSchemaComponents(sql);
    assert.ok(result.tables.includes('users'));
    assert.ok(result.tables.includes('posts'));
    assert.equal(result.table_count, 2);
    assert.equal(result.index_count, 1);
    assert.ok(result.foreign_keys.includes('users'));
    assert.ok(result.has_constraints);
  });

  it('handles IF NOT EXISTS', () => {
    const sql = 'CREATE TABLE IF NOT EXISTS items (id INT);';
    const result = extractSqlSchemaComponents(sql);
    assert.ok(result.tables.includes('items'));
  });

  it('detects triggers', () => {
    const sql = 'CREATE TABLE t (id INT);\nCREATE FUNCTION update_ts() RETURNS trigger AS $$ BEGIN END; $$;';
    const result = extractSqlSchemaComponents(sql);
    assert.ok(result.has_triggers);
  });

  it('detects comments', () => {
    const sql = '-- User table\nCREATE TABLE users (id INT);';
    const result = extractSqlSchemaComponents(sql);
    assert.ok(result.hasComments);
  });
});

describe('extractDbtComponents', () => {
  it('extracts refs and sources', () => {
    const dbt = `SELECT * FROM {{ ref('users') }} JOIN {{ ref('orders') }} ON 1=1
    WHERE source = {{ source('raw', 'events') }}`;
    const result = extractDbtComponents(dbt);
    assert.ok(result.refs.includes('users'));
    assert.ok(result.refs.includes('orders'));
    assert.equal(result.ref_count, 2);
    assert.ok(result.sources.includes('raw'));
  });

  it('extracts materialization', () => {
    const dbt = "{{ config(materialized='incremental') }}\nSELECT *";
    const result = extractDbtComponents(dbt);
    assert.equal(result.materialization, 'incremental');
    assert.ok(result.has_materialization);
  });

  it('detects tests', () => {
    const dbt = 'models:\n  - name: users\n    tests:\n      - unique';
    const result = extractDbtComponents(dbt);
    assert.ok(result.has_tests);
  });
});

describe('extractMigrationComponents', () => {
  it('counts ALTER/CREATE/DROP statements', () => {
    const sql = `
ALTER TABLE users ADD COLUMN email VARCHAR;
ALTER TABLE users ADD COLUMN phone VARCHAR;
CREATE TABLE audit_log (id INT);
DROP TABLE old_data;
-- DOWN
ALTER TABLE users DROP COLUMN email;`;
    const result = extractMigrationComponents(sql);
    assert.equal(result.alter_count, 3);
    assert.equal(result.create_count, 1);
    assert.equal(result.drop_count, 1);
    assert.ok(result.has_rollback);
  });
});

describe('calculateDataAssetScore', () => {
  it('scores high for complete schema', () => {
    const row = { name: 'app-schema', description: 'Complete application database schema with indexes' };
    const meta = {
      table_count: 8, column_count: 40, index_count: 5,
      has_constraints: true, foreign_keys: ['users', 'orders'],
      hasComments: true,
    };
    const score = calculateDataAssetScore(row, meta);
    assert.ok(score >= 60, `Expected >= 60, got ${score}`);
  });

  it('scores low for minimal', () => {
    const row = { name: 'Untitled', description: '' };
    const score = calculateDataAssetScore(row, {});
    assert.ok(score < 10, `Expected < 10, got ${score}`);
  });
});
