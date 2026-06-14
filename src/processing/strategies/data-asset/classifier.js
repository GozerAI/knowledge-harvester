// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Data Asset Classifier — Classifies data artifacts into subcategories via Ollama.
 */

import { db } from '../../../db/client.js';
import { config } from '../../../config.js';
import { logger } from '../../../utils/logger.js';

const DATA_CATEGORIES = [
  'relational-schema',
  'data-warehouse',
  'data-pipeline-config',
  'data-transformation',
  'migration-script',
  'dataset-definition',
  'analytics-config',
  'caching-config',
  'search-index',
  'general-data',
];

const PROMPT_TEMPLATE = `Classify this data asset into ONE primary category and up to 2 secondary categories.

CATEGORIES:
- relational-schema: Table definitions, foreign keys, normalized schemas
- data-warehouse: Star/snowflake schemas, OLAP cubes, dimensional models
- data-pipeline-config: ETL/ELT configs, data flow definitions
- data-transformation: dbt models, SQL transforms, view definitions
- migration-script: Schema migrations, ALTER TABLE, version-controlled changes
- dataset-definition: Dataset configs, field mappings, data source specs
- analytics-config: Reporting tables, materialized views, aggregation configs
- caching-config: Redis/Memcached configs, cache layer definitions
- search-index: Elasticsearch/Solr mappings, search configurations
- general-data: Other data-related configurations

DATA TYPE: {dataType}
Name: {name}
Description: {description}
Tables: {tables}

Respond in JSON format ONLY:
{
  "primary_category": "category-slug",
  "secondary_categories": ["category-slug"],
  "tags": ["relevant", "specific", "tags"]
}`;

export async function classifyDataAssets(limit = 50) {
  const result = await db.query(
    `SELECT id, name, description, tool_type, type_metadata
     FROM artifacts
     WHERE artifact_type = 'data_asset' AND primary_category IS NULL
       AND publishing_status = 'raw'
     ORDER BY discovered_at DESC LIMIT $1`,
    [limit]
  );

  if (result.rows.length === 0) {
    logger.info('No data assets to classify');
    return { success: 0, failed: 0 };
  }

  logger.info(`Classifying ${result.rows.length} data assets`);
  let success = 0, failed = 0;

  for (const row of result.rows) {
    try {
      const classification = await classifySingle(row);
      if (classification) {
        await db.query(
          `UPDATE artifacts SET primary_category = $1, secondary_categories = $2,
            tags = $3, publishing_status = 'enriched', enriched_at = NOW()
          WHERE id = $4`,
          [classification.primary_category, classification.secondary_categories || [],
           classification.tags || [], row.id]
        );
        success++;
      } else { failed++; }
    } catch (err) {
      logger.error('Data asset classification failed', { id: row.id, error: err.message });
      failed++;
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  logger.info('Data asset classification complete', { success, failed });
  return { success, failed };
}

async function classifySingle(row) {
  const meta = typeof row.type_metadata === 'string'
    ? JSON.parse(row.type_metadata) : (row.type_metadata || {});

  const tables = (meta.tables || meta.refs || []).slice(0, 10).join(', ');
  const prompt = PROMPT_TEMPLATE
    .replace('{dataType}', meta.data_type || row.tool_type || 'unknown')
    .replace('{name}', row.name || 'Untitled')
    .replace('{description}', (row.description || '').slice(0, 500))
    .replace('{tables}', tables || 'none');

  const response = await fetch(`${config.ollama.host}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollama.model, prompt, stream: false,
      options: { temperature: 0.1 }, format: 'json',
    }),
  });

  if (!response.ok) throw new Error(`Ollama ${response.status}`);
  const data = await response.json();
  try {
    const parsed = JSON.parse(data.response || '');
    if (!DATA_CATEGORIES.includes(parsed.primary_category)) {
      parsed.primary_category = getDefaultDataCategory(meta);
    }
    if (Array.isArray(parsed.secondary_categories)) {
      parsed.secondary_categories = parsed.secondary_categories
        .filter(c => DATA_CATEGORIES.includes(c));
    } else { parsed.secondary_categories = []; }
    if (!Array.isArray(parsed.tags)) parsed.tags = [];
    return parsed;
  } catch {
    return null;
  }
}

export function getDefaultDataCategory(meta) {
  const typeDefaults = {
    'sql-schema': 'relational-schema',
    'dbt-model': 'data-transformation',
    'migration': 'migration-script',
    'dataset-config': 'dataset-definition',
  };
  return typeDefaults[meta?.data_type] || 'general-data';
}
