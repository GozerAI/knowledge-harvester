// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { randomUUID } from 'node:crypto';
import { generateContentHash } from '../../../utils/hash.js';
import { extractNameFromPath } from '../../../utils/helpers.js';

/**
 * Normalize raw data asset data into the unified artifact schema.
 *
 * Handles: SQL schemas, dbt models, dataset configs, migration files,
 * data pipeline configs.
 */
export function normalizeDataAsset(source, rawData) {
  const { searchResult, content, filename } = rawData;
  const dataType = detectDataType(content, filename);

  let components;
  switch (dataType) {
    case 'sql-schema':   components = extractSqlSchemaComponents(content); break;
    case 'dbt-model':    components = extractDbtComponents(content); break;
    case 'dataset-config': components = extractDatasetConfigComponents(content); break;
    case 'migration':    components = extractMigrationComponents(content); break;
    default:             components = { data_type: dataType }; break;
  }

  const name = searchResult?.repository?.full_name
    ? `${searchResult.repository.full_name}/${filename}`
    : extractNameFromPath(filename);
  const description = searchResult?.repository?.description || '';

  return {
    id: randomUUID(),
    hash: generateContentHash(content, 'data_asset'),
    artifact_type: 'data_asset',
    source,
    source_url: searchResult?.html_url || '',
    source_id: searchResult?.sha || searchResult?.html_url || randomUUID(),
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    content: { source_code: content, filename },
    name,
    description,
    author: {
      username: searchResult?.repository?.owner?.login || null,
      profile_url: searchResult?.repository?.owner?.html_url || null,
    },
    language: dataType === 'sql-schema' || dataType === 'migration' ? 'sql' : 'yaml',
    tool_type: dataType,
    tool_metadata: { data_type: dataType },
    tags: [],
    type_metadata: { data_type: dataType, ...components },
    quality: {
      score: 0,
      has_description: description.length > 0,
      has_documentation: components.hasComments || false,
      is_complete: true,
      validation_status: 'valid',
    },
  };
}

/**
 * Detect the data asset type from content and filename.
 */
export function detectDataType(content, filename) {
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

/**
 * Extract SQL schema components.
 */
export function extractSqlSchemaComponents(content) {
  const tables = [...new Set(
    (content.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)/gi) || [])
      .map(m => m.match(/TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)/i)?.[1])
      .filter(Boolean)
  )];

  const columns = [];
  const colMatches = content.match(/^\s+[`"']?(\w+)[`"']?\s+(VARCHAR|TEXT|INT|INTEGER|BIGINT|BOOLEAN|DECIMAL|FLOAT|DOUBLE|DATE|TIMESTAMP|UUID|JSONB?|SERIAL|BYTEA)/gmi) || [];
  for (const m of colMatches) {
    const col = m.trim().split(/\s+/)[0]?.replace(/[`"']/g, '');
    if (col) columns.push(col);
  }

  const indexes = [...new Set(
    (content.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)/gi) || [])
      .map(m => m.match(/INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)/i)?.[1])
      .filter(Boolean)
  )];

  const foreignKeys = (content.match(/REFERENCES\s+[`"']?(\w+)/gi) || [])
    .map(m => m.match(/REFERENCES\s+[`"']?(\w+)/i)?.[1])
    .filter(Boolean);

  const hasConstraints = /\bCONSTRAINT\b|\bPRIMARY KEY\b|\bUNIQUE\b|\bCHECK\b/i.test(content);
  const hasTriggers = /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|TRIGGER)\b/i.test(content);
  const hasComments = /--\s+\w/.test(content) || /\/\*[\s\S]*?\*\//.test(content);

  return {
    tables,
    table_count: tables.length,
    columns: columns.slice(0, 100),
    column_count: columns.length,
    indexes,
    index_count: indexes.length,
    foreign_keys: [...new Set(foreignKeys)],
    has_constraints: hasConstraints,
    has_triggers: hasTriggers,
    hasComments,
  };
}

/**
 * Extract dbt model components.
 */
export function extractDbtComponents(content) {
  const refs = [...new Set(
    (content.match(/ref\s*\(\s*['"]([^'"]+)['"]\s*\)/g) || [])
      .map(m => m.match(/['"]([^'"]+)['"]/)?.[1])
      .filter(Boolean)
  )];

  const sources = [...new Set(
    (content.match(/source\s*\(\s*['"]([^'"]+)['"]/g) || [])
      .map(m => m.match(/['"]([^'"]+)['"]/)?.[1])
      .filter(Boolean)
  )];

  const hasMaterialization = /materialized\s*[=:]\s*['"]?(table|view|incremental|ephemeral)/i.test(content);
  const materialization = content.match(/materialized\s*[=:]\s*['"]?(\w+)/i)?.[1] || null;
  const hasTests = /tests:|test:/i.test(content);
  const hasComments = /--\s+\w/.test(content) || /\bdescription\b/i.test(content);

  return {
    refs,
    ref_count: refs.length,
    sources,
    source_count: sources.length,
    materialization,
    has_materialization: hasMaterialization,
    has_tests: hasTests,
    hasComments,
  };
}

/**
 * Extract dataset config components.
 */
export function extractDatasetConfigComponents(content) {
  const fields = [];
  const fieldMatches = content.match(/(?:name|field|column):\s*['"]?(\w+)/gi) || [];
  for (const m of fieldMatches) {
    const f = m.match(/:\s*['"]?(\w+)/)?.[1];
    if (f) fields.push(f);
  }

  const hasSchema = /schema|fields|columns/i.test(content);
  const hasConnection = /connection|host|port|database|uri/i.test(content);
  const hasComments = /\#\s+\w/.test(content);

  return {
    fields: fields.slice(0, 50),
    field_count: fields.length,
    has_schema: hasSchema,
    has_connection: hasConnection,
    hasComments,
  };
}

/**
 * Extract migration components.
 */
export function extractMigrationComponents(content) {
  const alterations = (content.match(/\bALTER\s+TABLE/gi) || []).length;
  const creates = (content.match(/\bCREATE\s+TABLE/gi) || []).length;
  const drops = (content.match(/\bDROP\s+TABLE/gi) || []).length;
  const hasRollback = /\bDOWN\b|rollback|revert/i.test(content);
  const hasComments = /--\s+\w/.test(content);

  return {
    alter_count: alterations,
    create_count: creates,
    drop_count: drops,
    has_rollback: hasRollback,
    is_reversible: hasRollback,
    hasComments,
  };
}
