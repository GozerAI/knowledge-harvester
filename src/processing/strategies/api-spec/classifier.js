// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * API Spec Classifier — Classifies API spec artifacts into subcategories via Ollama.
 */

import { db } from '../../../db/client.js';
import { config } from '../../../config.js';
import { logger } from '../../../utils/logger.js';

const API_CATEGORIES = [
  'rest-api',
  'graphql-api',
  'grpc-api',
  'event-driven-api',
  'crud-api',
  'auth-api',
  'payment-api',
  'data-api',
  'integration-api',
  'realtime-api',
  'general-api',
];

const PROMPT_TEMPLATE = `Classify this API specification into ONE primary category and up to 2 secondary categories.

CATEGORIES:
- rest-api: RESTful endpoints, resource-based, HTTP methods
- graphql-api: GraphQL schemas, queries, mutations, subscriptions
- grpc-api: Protocol buffers, gRPC services, streaming RPCs
- event-driven-api: AsyncAPI, WebSocket, message channels, pub/sub
- crud-api: Basic create/read/update/delete operations
- auth-api: Authentication, authorization, OAuth, JWT endpoints
- payment-api: Payment processing, billing, subscriptions
- data-api: Data access, analytics, reporting endpoints
- integration-api: Third-party integrations, webhooks, connectors
- realtime-api: WebSocket, SSE, streaming, live updates
- general-api: General-purpose API specifications

SPEC TYPE: {specType}
Name: {name}
Description: {description}
Endpoints: {endpoints}

Respond in JSON format ONLY:
{
  "primary_category": "category-slug",
  "secondary_categories": ["category-slug"],
  "tags": ["relevant", "specific", "tags"]
}`;

/**
 * Classify unclassified api_spec artifacts.
 */
export async function classifyApiSpecs(limit = 50) {
  const result = await db.query(
    `SELECT id, name, description, tool_type, type_metadata
     FROM artifacts
     WHERE artifact_type = 'api_spec' AND primary_category IS NULL
       AND publishing_status = 'raw'
     ORDER BY discovered_at DESC
     LIMIT $1`,
    [limit]
  );

  if (result.rows.length === 0) {
    logger.info('No API specs to classify');
    return { success: 0, failed: 0 };
  }

  logger.info(`Classifying ${result.rows.length} API specs`);
  let success = 0;
  let failed = 0;

  for (const row of result.rows) {
    try {
      const classification = await classifySingle(row);
      if (classification) {
        await db.query(
          `UPDATE artifacts SET
            primary_category = $1, secondary_categories = $2,
            tags = $3, publishing_status = 'enriched', enriched_at = NOW()
          WHERE id = $4`,
          [classification.primary_category, classification.secondary_categories || [],
           classification.tags || [], row.id]
        );
        success++;
      } else { failed++; }
    } catch (err) {
      logger.error('API spec classification failed', { id: row.id, error: err.message });
      failed++;
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  logger.info('API spec classification complete', { success, failed });
  return { success, failed };
}

async function classifySingle(row) {
  const meta = typeof row.type_metadata === 'string'
    ? JSON.parse(row.type_metadata) : (row.type_metadata || {});

  const endpoints = (meta.endpoints || meta.queries || meta.rpcs || meta.channels || [])
    .slice(0, 10).join(', ');

  const prompt = PROMPT_TEMPLATE
    .replace('{specType}', meta.spec_type || row.tool_type || 'unknown')
    .replace('{name}', row.name || 'Untitled')
    .replace('{description}', (row.description || '').slice(0, 500))
    .replace('{endpoints}', endpoints || 'none');

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
    if (!API_CATEGORIES.includes(parsed.primary_category)) {
      parsed.primary_category = getDefaultApiCategory(meta);
    }
    if (Array.isArray(parsed.secondary_categories)) {
      parsed.secondary_categories = parsed.secondary_categories
        .filter(c => API_CATEGORIES.includes(c));
    } else { parsed.secondary_categories = []; }
    if (!Array.isArray(parsed.tags)) parsed.tags = [];
    return parsed;
  } catch {
    logger.warn('Failed to parse API spec classification', { id: row.id });
    return null;
  }
}

export function getDefaultApiCategory(meta) {
  const specDefaults = {
    openapi: 'rest-api',
    graphql: 'graphql-api',
    grpc: 'grpc-api',
    asyncapi: 'event-driven-api',
  };
  return specDefaults[meta?.spec_type] || 'general-api';
}
