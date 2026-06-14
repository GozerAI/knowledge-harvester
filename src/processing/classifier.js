// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { db } from '../db/client.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const CATEGORIES = [
  // Original n8n categories
  'lead-gen-crm',
  'content-marketing',
  'data-processing',
  'devops-monitoring',
  'general-productivity',
  // Multi-tool categories
  'ai-agent',
  'multi-step-automation',
  'integration-pipeline',
  // Orchestration & pipeline categories
  'orchestration',
  'data-pipeline',
  // Expanded categories
  'ai-image-generation',
  'security-automation',
  'ecommerce',
  'customer-support',
  'finance-accounting',
  'ml-data-ops',
  // New expanded categories
  'ci-cd-pipeline',
  'iot-home-automation',
  'business-process',
  'streaming-realtime',
  'infrastructure-as-code',
];

const N8N_PROMPT = `Analyze this n8n workflow and classify it into ONE primary category and up to 2 secondary categories.

CATEGORIES:
- lead-gen-crm: Lead capture, CRM sync, contact management, sales pipelines
- content-marketing: Content creation, social media, email campaigns, publishing
- data-processing: ETL, data transformation, reporting, analytics
- devops-monitoring: CI/CD, alerts, logging, infrastructure automation
- general-productivity: Calendar, tasks, notifications, personal automation
- ai-agent: AI-powered agents, LLM chains, autonomous decision-making
- multi-step-automation: Complex multi-step workflows spanning multiple services
- integration-pipeline: Service-to-service data sync, API orchestration
- orchestration: Durable workflow orchestration, task scheduling, multi-service coordination
- data-pipeline: Data ingestion, batch/stream processing, ML pipelines, DAG-based data flows
- ai-image-generation: Image generation, ComfyUI, Stable Diffusion, DALL-E, image processing pipelines
- security-automation: Security scanning, vulnerability management, SIEM, incident response automation
- ecommerce: Product catalog, inventory, order processing, Shopify/WooCommerce integrations
- customer-support: Helpdesk, ticketing, chatbots, customer communication, support workflows
- finance-accounting: Invoicing, expense tracking, bookkeeping, payment processing, financial reporting
- ml-data-ops: ML model training, experiment tracking, feature pipelines, MLOps, model deployment
- ci-cd-pipeline: Build, test, deploy pipelines; GitHub Actions, GitLab CI, Tekton, Jenkins
- iot-home-automation: Smart home, IoT device control, sensor automation, Home Assistant
- business-process: BPM, approval workflows, human tasks, BPMN, document routing
- streaming-realtime: Event streaming, CDC, real-time data pipelines, Kafka, message queues
- infrastructure-as-code: Terraform, Ansible, Pulumi, cloud provisioning, GitOps

WORKFLOW:
Name: {name}
Description: {description}
Node Types: {nodeTypes}
Trigger: {triggerType}

Respond in JSON format ONLY (no markdown, no explanation):
{
  "primary_category": "category-slug",
  "secondary_categories": ["category-slug"],
  "tags": ["relevant", "specific", "tags"],
  "use_cases": ["Brief use case 1", "Brief use case 2"]
}`;

const AGENT_PROMPT = `Analyze this automation/workflow and classify it into ONE primary category and up to 2 secondary categories.

CATEGORIES:
- ai-agent: AI-powered agents, LLM chains, autonomous decision-making, RAG
- data-processing: ETL, data transformation, reporting, analytics
- devops-monitoring: CI/CD, alerts, logging, infrastructure automation
- general-productivity: Calendar, tasks, notifications, personal automation
- lead-gen-crm: Lead capture, CRM sync, contact management, sales
- content-marketing: Content creation, social media, email campaigns
- multi-step-automation: Complex multi-step workflows spanning multiple services
- integration-pipeline: Service-to-service data sync, API orchestration
- orchestration: Durable workflow orchestration, task scheduling, multi-service coordination (Temporal, Airflow, Windmill)
- data-pipeline: Data ingestion, batch/stream processing, ML pipelines, DAG-based data flows
- ai-image-generation: Image generation, ComfyUI, Stable Diffusion, DALL-E, image processing pipelines
- security-automation: Security scanning, vulnerability management, SIEM, incident response automation
- ecommerce: Product catalog, inventory, order processing, Shopify/WooCommerce integrations
- customer-support: Helpdesk, ticketing, chatbots, customer communication, support workflows
- finance-accounting: Invoicing, expense tracking, bookkeeping, payment processing, financial reporting
- ml-data-ops: ML model training, experiment tracking, feature pipelines, MLOps, model deployment
- ci-cd-pipeline: Build, test, deploy pipelines; GitHub Actions, GitLab CI, Tekton, Jenkins
- iot-home-automation: Smart home, IoT device control, sensor automation, Home Assistant
- business-process: BPM, approval workflows, human tasks, BPMN, document routing
- streaming-realtime: Event streaming, CDC, real-time data pipelines, Kafka, message queues
- infrastructure-as-code: Terraform, Ansible, Pulumi, cloud provisioning, GitOps

TOOL/FRAMEWORK: {toolType}
Name: {name}
Description: {description}
Components: {nodeTypes}
Language: {language}

Respond in JSON format ONLY (no markdown, no explanation):
{
  "primary_category": "category-slug",
  "secondary_categories": ["category-slug"],
  "tags": ["relevant", "specific", "tags"],
  "use_cases": ["Brief use case 1", "Brief use case 2"]
}`;

/**
 * Classify unclassified workflows using Ollama.
 * Queries DB for workflows without a primary_category, sends each to Ollama,
 * and updates the record with classification results.
 *
 * @param {number} limit - Max number of workflows to classify in this run
 * @returns {{ success: number, failed: number }}
 */
export async function classifyWorkflows(limit = 50) {
  const result = await db.query(
    `SELECT id, workflow_name, original_description, node_types, trigger_type,
            tool_type, language
     FROM workflows
     WHERE primary_category IS NULL AND publishing_status = 'raw'
     ORDER BY discovered_at DESC
     LIMIT $1`,
    [limit]
  );

  if (result.rows.length === 0) {
    logger.info('No workflows to classify');
    return { success: 0, failed: 0 };
  }

  const usesClaude = !!config.anthropic.apiKey;
  logger.info(`Classifying ${result.rows.length} workflows`, {
    model: usesClaude ? config.anthropic.model : config.ollama.model,
    provider: usesClaude ? 'anthropic' : 'ollama',
  });

  let success = 0;
  let failed = 0;

  for (const row of result.rows) {
    try {
      const classification = await classifySingle(row);
      if (classification) {
        await db.query(
          `UPDATE workflows SET
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
        logger.debug('Classified workflow', {
          id: row.id,
          category: classification.primary_category,
        });
      } else {
        failed++;
      }
    } catch (err) {
      logger.error('Classification failed', { id: row.id, error: err.message });
      failed++;
    }

    // Pace LLM calls
    await new Promise(r => setTimeout(r, usesClaude ? 200 : 1000));
  }

  logger.info('Classification complete', { success, failed });
  return { success, failed };
}

/**
 * Build the appropriate prompt based on tool_type.
 */
function buildPrompt(row) {
  const toolType = row.tool_type || 'n8n';
  const isN8n = toolType === 'n8n';
  const template = isN8n ? N8N_PROMPT : AGENT_PROMPT;

  return template
    .replace('{name}', row.workflow_name || 'Untitled')
    .replace('{description}', (row.original_description || '').slice(0, 500))
    .replace('{nodeTypes}', (row.node_types || []).join(', '))
    .replace('{triggerType}', row.trigger_type || 'unknown')
    .replace('{toolType}', toolType)
    .replace('{language}', row.language || 'unknown');
}

async function classifyViaClaude(prompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.anthropic.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.anthropic.model,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt + '\n\nRespond with ONLY valid JSON, no other text.' }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  return (data.content?.[0]?.text || '').trim();
}

async function classifyViaOllama(prompt) {
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
  return data.response || '';
}

/**
 * Classify a single workflow via Claude API (preferred) or Ollama fallback.
 */
async function classifySingle(row) {
  const prompt = buildPrompt(row);
  let text;

  if (config.anthropic.apiKey) {
    text = await classifyViaClaude(prompt);
  } else {
    text = await classifyViaOllama(prompt);
  }


  try {
    // Strip markdown fences (```json ... ```) that LLMs sometimes wrap responses in
    let cleanText = text.trim();
    if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }
    const parsed = JSON.parse(cleanText);

    // Validate primary_category is a known category
    if (!CATEGORIES.includes(parsed.primary_category)) {
      logger.warn('Unknown category returned, defaulting', {
        returned: parsed.primary_category,
        id: row.id,
      });
      // Default based on tool_type
      const toolType = row.tool_type || 'n8n';
      if (['langchain', 'crewai', 'autogen', 'langgraph'].includes(toolType)) {
        parsed.primary_category = 'ai-agent';
      } else if (['temporal', 'windmill'].includes(toolType)) {
        parsed.primary_category = 'orchestration';
      } else if (['airflow', 'prefect', 'dagster'].includes(toolType)) {
        parsed.primary_category = 'data-pipeline';
      } else if (toolType === 'node-red') {
        parsed.primary_category = 'integration-pipeline';
      } else if (toolType === 'comfyui') {
        parsed.primary_category = 'ai-image-generation';
      } else if (toolType === 'dify' || toolType === 'flowise') {
        parsed.primary_category = 'ai-agent';
      } else if (toolType === 'pipedream') {
        parsed.primary_category = 'multi-step-automation';
      } else if (toolType === 'argo') {
        parsed.primary_category = 'orchestration';
      } else if (toolType === 'luigi') {
        parsed.primary_category = 'data-pipeline';
      } else if (toolType === 'tekton' || toolType === 'github-actions') {
        parsed.primary_category = 'ci-cd-pipeline';
      } else if (toolType === 'home-assistant') {
        parsed.primary_category = 'iot-home-automation';
      } else if (toolType === 'mlflow') {
        parsed.primary_category = 'ml-data-ops';
      } else if (toolType === 'dbt') {
        parsed.primary_category = 'data-pipeline';
      } else if (toolType === 'camunda') {
        parsed.primary_category = 'business-process';
      } else if (toolType === 'kafka-connect') {
        parsed.primary_category = 'streaming-realtime';
      } else if (toolType === 'camel') {
        parsed.primary_category = 'integration-pipeline';
      } else {
        parsed.primary_category = 'general-productivity';
      }
    }

    // Validate secondary_categories
    if (Array.isArray(parsed.secondary_categories)) {
      parsed.secondary_categories = parsed.secondary_categories.filter(c =>
        CATEGORIES.includes(c)
      );
    } else {
      parsed.secondary_categories = [];
    }

    // Ensure tags is an array of strings
    if (!Array.isArray(parsed.tags)) {
      parsed.tags = [];
    }

    return parsed;
  } catch {
    logger.warn('Failed to parse LLM JSON response', {
      text: text.slice(0, 200),
      id: row.id,
    });
    return null;
  }
}
