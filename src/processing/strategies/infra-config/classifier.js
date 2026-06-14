// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Infrastructure Config Classifier — Classifies infra artifacts into
 * subcategories via Ollama.
 */

import { db } from '../../../db/client.js';
import { config } from '../../../config.js';
import { logger } from '../../../utils/logger.js';

const INFRA_CATEGORIES = [
  'infrastructure-as-code',
  'ci-cd-pipeline',
  'devops-monitoring',
  'orchestration',
  'streaming-realtime',
  'data-pipeline',
  'security-automation',
  'general-productivity',
];

const PROMPT_TEMPLATE = `Classify this infrastructure configuration into ONE primary category and up to 2 secondary categories.

CATEGORIES:
- infrastructure-as-code: Cloud provisioning, Terraform, Ansible, Pulumi, GitOps
- ci-cd-pipeline: Build/test/deploy pipelines, container registries
- devops-monitoring: Logging, metrics, alerting, observability stacks
- orchestration: Container orchestration, service mesh, scheduling
- streaming-realtime: Message queues, event streaming, CDC
- data-pipeline: Database configs, data warehouse setup, ETL infrastructure
- security-automation: Network policies, secrets management, TLS, firewalls
- general-productivity: Development environments, local tooling

TOOL: {toolType}
Name: {name}
Description: {description}
Components: {components}

Respond in JSON format ONLY:
{
  "primary_category": "category-slug",
  "secondary_categories": ["category-slug"],
  "tags": ["relevant", "specific", "tags"]
}`;

/**
 * Classify unclassified infra_config artifacts.
 */
export async function classifyInfraConfigs(limit = 50) {
  const result = await db.query(
    `SELECT id, name, description, tool_type, type_metadata
     FROM artifacts
     WHERE artifact_type = 'infra_config' AND primary_category IS NULL
       AND publishing_status = 'raw'
     ORDER BY discovered_at DESC
     LIMIT $1`,
    [limit]
  );

  if (result.rows.length === 0) {
    logger.info('No infra configs to classify');
    return { success: 0, failed: 0 };
  }

  logger.info(`Classifying ${result.rows.length} infra configs`);
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
      logger.error('Infra classification failed', { id: row.id, error: err.message });
      failed++;
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  logger.info('Infra classification complete', { success, failed });
  return { success, failed };
}

async function classifySingle(row) {
  const meta = typeof row.type_metadata === 'string'
    ? JSON.parse(row.type_metadata) : (row.type_metadata || {});

  const components = extractComponentSummary(meta);
  const prompt = PROMPT_TEMPLATE
    .replace('{toolType}', row.tool_type || 'unknown')
    .replace('{name}', row.name || 'Untitled')
    .replace('{description}', (row.description || '').slice(0, 500))
    .replace('{components}', components);

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

    if (!INFRA_CATEGORIES.includes(parsed.primary_category)) {
      parsed.primary_category = getDefaultCategory(row.tool_type);
    }

    if (Array.isArray(parsed.secondary_categories)) {
      parsed.secondary_categories = parsed.secondary_categories
        .filter(c => INFRA_CATEGORIES.includes(c));
    } else {
      parsed.secondary_categories = [];
    }

    if (!Array.isArray(parsed.tags)) parsed.tags = [];

    return parsed;
  } catch {
    logger.warn('Failed to parse infra classification', { id: row.id });
    return null;
  }
}

function extractComponentSummary(meta) {
  const parts = [];
  if (meta.providers?.length) parts.push(`Providers: ${meta.providers.join(', ')}`);
  if (meta.resources?.length) parts.push(`Resources: ${meta.resources.join(', ')}`);
  if (meta.services?.length) parts.push(`Services: ${meta.services.join(', ')}`);
  if (meta.images?.length) parts.push(`Images: ${meta.images.join(', ')}`);
  if (meta.containers?.length) parts.push(`Containers: ${meta.containers.join(', ')}`);
  if (meta.modules_used?.length) parts.push(`Modules: ${meta.modules_used.join(', ')}`);
  if (meta.kind) parts.push(`Kind: ${meta.kind}`);
  if (meta.chart_name) parts.push(`Chart: ${meta.chart_name}`);
  return parts.join('; ') || 'No components extracted';
}

export function getDefaultCategory(toolType) {
  const defaults = {
    terraform: 'infrastructure-as-code',
    helm: 'orchestration',
    'docker-compose': 'devops-monitoring',
    kubernetes: 'orchestration',
    ansible: 'infrastructure-as-code',
  };
  return defaults[toolType] || 'infrastructure-as-code';
}
