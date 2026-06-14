// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Code Pattern Classifier — Classifies code pattern artifacts into
 * subcategories via Ollama.
 */

import { db } from '../../../db/client.js';
import { config } from '../../../config.js';
import { logger } from '../../../utils/logger.js';

const CODE_CATEGORIES = [
  'api-pattern',
  'design-pattern',
  'authentication',
  'data-access',
  'messaging-events',
  'testing-pattern',
  'error-handling',
  'caching-performance',
  'middleware-plugin',
  'cli-tooling',
  'devops-scripting',
  'general-utility',
];

const PROMPT_TEMPLATE = `Classify this code pattern into ONE primary category and up to 2 secondary categories.

CATEGORIES:
- api-pattern: REST/GraphQL endpoints, request handling, routing, serialization
- design-pattern: Singleton, Factory, Observer, Strategy, Decorator, etc.
- authentication: Auth flows, JWT, OAuth, session management, RBAC
- data-access: ORM usage, database queries, repository pattern, migrations
- messaging-events: Event-driven, pub/sub, message queues, WebSocket handlers
- testing-pattern: Test utilities, fixtures, mocks, test helpers, benchmarks
- error-handling: Custom exceptions, retry logic, circuit breakers, fallbacks
- caching-performance: Cache layers, memoization, connection pools, optimization
- middleware-plugin: Request/response middleware, plugin systems, interceptors
- cli-tooling: CLI frameworks, argument parsing, terminal utilities
- devops-scripting: Build scripts, deployment helpers, infrastructure automation
- general-utility: Generic helpers, data transforms, string manipulation

LANGUAGE: {language}
FRAMEWORK: {framework}
Name: {name}
Description: {description}
Functions: {functions}
Classes: {classes}

Respond in JSON format ONLY:
{
  "primary_category": "category-slug",
  "secondary_categories": ["category-slug"],
  "tags": ["relevant", "specific", "tags"]
}`;

/**
 * Classify unclassified code_pattern artifacts.
 */
export async function classifyCodePatterns(limit = 50) {
  const result = await db.query(
    `SELECT id, name, description, tool_type, type_metadata
     FROM artifacts
     WHERE artifact_type = 'code_pattern' AND primary_category IS NULL
       AND publishing_status = 'raw'
     ORDER BY discovered_at DESC
     LIMIT $1`,
    [limit]
  );

  if (result.rows.length === 0) {
    logger.info('No code patterns to classify');
    return { success: 0, failed: 0 };
  }

  logger.info(`Classifying ${result.rows.length} code patterns`);
  let success = 0;
  let failed = 0;

  for (const row of result.rows) {
    try {
      const classification = await classifySingle(row);
      if (classification) {
        await db.query(
          `UPDATE artifacts SET
            primary_category = $1,
            secondary_categories = $2,
            tags = $3,
            publishing_status = 'enriched',
            enriched_at = NOW()
          WHERE id = $4`,
          [
            classification.primary_category,
            classification.secondary_categories || [],
            classification.tags || [],
            row.id,
          ]
        );
        success++;
      } else {
        failed++;
      }
    } catch (err) {
      logger.error('Code pattern classification failed', { id: row.id, error: err.message });
      failed++;
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  logger.info('Code pattern classification complete', { success, failed });
  return { success, failed };
}

async function classifySingle(row) {
  const meta = typeof row.type_metadata === 'string'
    ? JSON.parse(row.type_metadata) : (row.type_metadata || {});

  const prompt = PROMPT_TEMPLATE
    .replace('{language}', meta.language || row.tool_type || 'unknown')
    .replace('{framework}', meta.framework || 'none')
    .replace('{name}', row.name || 'Untitled')
    .replace('{description}', (row.description || '').slice(0, 500))
    .replace('{functions}', (meta.functions || []).slice(0, 15).join(', ') || 'none')
    .replace('{classes}', (meta.classes || []).slice(0, 10).join(', ') || 'none');

  const response = await fetch(`${config.ollama.host}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollama.model,
      prompt,
      stream: false,
      options: { temperature: 0.1 },
      format: 'json',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  try {
    const parsed = JSON.parse(data.response || '');

    if (!CODE_CATEGORIES.includes(parsed.primary_category)) {
      parsed.primary_category = getDefaultCodeCategory(row.tool_type, meta);
    }

    if (Array.isArray(parsed.secondary_categories)) {
      parsed.secondary_categories = parsed.secondary_categories
        .filter(c => CODE_CATEGORIES.includes(c));
    } else {
      parsed.secondary_categories = [];
    }

    if (!Array.isArray(parsed.tags)) parsed.tags = [];

    return parsed;
  } catch {
    logger.warn('Failed to parse code pattern classification', { id: row.id });
    return null;
  }
}

export function getDefaultCodeCategory(toolType, meta) {
  if (meta?.has_tests) return 'testing-pattern';
  if (meta?.framework) {
    const frameworkCategories = {
      fastapi: 'api-pattern',
      express: 'api-pattern',
      flask: 'api-pattern',
      django: 'api-pattern',
      gin: 'api-pattern',
      nestjs: 'api-pattern',
      pytest: 'testing-pattern',
      jest: 'testing-pattern',
    };
    if (frameworkCategories[meta.framework]) return frameworkCategories[meta.framework];
  }
  return 'general-utility';
}
