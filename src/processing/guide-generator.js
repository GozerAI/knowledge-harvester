// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { db } from '../db/client.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Generate setup guides for packaged workflows using Ollama.
 * Reads workflows that have packages but no guides yet, generates
 * substantive Markdown documentation via LLM, validates quality,
 * and stores the result.
 *
 * @param {number} limit - Max workflows to generate guides for
 * @returns {{ generated: number, failed: number, skipped: number }}
 */
export async function generateGuides(limit = 20) {
  const result = await db.query(
    `SELECT p.id AS package_id, p.workflow_id, p.bundle,
            w.workflow_name, w.tool_type, w.primary_category,
            w.original_description, w.estimated_complexity
     FROM workflow_packages p
     JOIN workflows w ON w.id = p.workflow_id
     LEFT JOIN workflow_guides g ON g.workflow_id = p.workflow_id
     WHERE g.id IS NULL
     ORDER BY w.quality_score DESC
     LIMIT $1`,
    [limit]
  );

  if (result.rows.length === 0) {
    logger.info('No workflows need guide generation');
    return { generated: 0, failed: 0, skipped: 0 };
  }

  logger.info(`Generating guides for ${result.rows.length} workflows`);
  let generated = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of result.rows) {
    try {
      const bundle = typeof row.bundle === 'string' ? JSON.parse(row.bundle) : row.bundle;
      const guide = await generateSingleGuide(row, bundle);

      if (!guide) {
        skipped++;
        continue;
      }

      const validation = validateGuide(guide, row.tool_type);
      if (!validation.valid) {
        logger.warn('Guide failed quality validation', {
          id: row.workflow_id,
          reason: validation.reason,
        });
        skipped++;
        continue;
      }

      const wordCount = countWords(guide);
      const sectionCount = countSections(guide);

      await db.query(
        `INSERT INTO workflow_guides
           (workflow_id, package_id, guide_markdown, word_count, section_count,
            quality_score, generation_model)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (workflow_id) DO UPDATE SET
           guide_markdown = $3, word_count = $4, section_count = $5,
           quality_score = $6, generation_model = $7,
           guide_version = workflow_guides.guide_version + 1,
           generated_at = NOW()`,
        [
          row.workflow_id, row.package_id, guide, wordCount, sectionCount,
          validation.score, config.ollama.model || 'qwen2.5:7b',
        ]
      );

      generated++;
      logger.debug('Generated guide', {
        id: row.workflow_id,
        words: wordCount,
        sections: sectionCount,
        quality: validation.score,
      });
    } catch (err) {
      logger.error('Guide generation failed', { id: row.workflow_id, error: err.message });
      failed++;
    }

    // Pace Ollama calls — generation is heavy
    await new Promise(r => setTimeout(r, 2000));
  }

  logger.info('Guide generation complete', { generated, failed, skipped });
  return { generated, failed, skipped };
}

/**
 * Generate a single guide via Ollama.
 */
async function generateSingleGuide(row, bundle) {
  const prompt = buildGuidePrompt(row, bundle);

  const response = await fetch(`${config.ollama.host}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollama.model || 'qwen2.5:7b',
      prompt,
      stream: false,
      options: {
        temperature: 0.3,
        num_predict: 4096,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.response || null;
}

/**
 * Build the prompt for guide generation.
 */
function buildGuidePrompt(row, bundle) {
  const pkg = bundle.package || {};
  const deps = pkg.dependencies || [];
  const creds = pkg.credentials || [];
  const envVars = pkg.environment_variables || [];
  const services = pkg.services || [];
  const minReqs = pkg.minimum_requirements || {};

  return `You are a technical writer creating a comprehensive setup guide for an automation workflow.

WORKFLOW DETAILS:
- Name: ${row.workflow_name}
- Tool: ${row.tool_type}
- Category: ${row.primary_category || 'general'}
- Complexity: ${row.estimated_complexity || 'moderate'}
- Description: ${row.original_description || 'No description available'}

DEPENDENCIES: ${deps.length > 0 ? deps.join(', ') : 'None'}
CREDENTIALS NEEDED: ${creds.length > 0 ? creds.map(c => `${c.name} (${c.type}, service: ${c.service})`).join(', ') : 'None'}
ENVIRONMENT VARIABLES: ${envVars.length > 0 ? envVars.map(e => `${e.name}: ${e.description}`).join(', ') : 'None'}
SERVICES REQUIRED: ${services.length > 0 ? services.map(s => `${s.name} ${s.version}`).join(', ') : 'None'}
RUNTIME: ${minReqs.runtime || 'Unknown'} | TOOL VERSION: ${minReqs.tool_version || 'Unknown'}

Write a detailed Markdown setup guide with ALL of the following sections. Each section must contain specific, actionable content relevant to this exact workflow and tool. Do NOT use generic placeholder text.

Required sections:
1. ## Overview — What this workflow does, when to use it, key benefits (minimum 50 words)
2. ## Prerequisites — System requirements, accounts needed, software to install
3. ## Install Dependencies — Exact commands to install each dependency
4. ## Configure Credentials — For EACH credential: where to get it, how to configure it
5. ## Import the Workflow — Step-by-step import instructions specific to ${row.tool_type}
6. ## Configure Settings — Key configuration options and what to customize
7. ## Test the Workflow — Specific steps to verify the workflow runs correctly
8. ## Troubleshooting — Common issues specific to this workflow's tools and patterns

Write the guide now in Markdown format:`;
}

/**
 * Validate guide quality.
 * Returns { valid: boolean, score: number, reason?: string }
 */
function validateGuide(guide, toolType) {
  if (!guide || typeof guide !== 'string') {
    return { valid: false, score: 0, reason: 'Empty guide' };
  }

  const words = countWords(guide);
  if (words < 100) {
    return { valid: false, score: 0, reason: `Too short: ${words} words (min 100)` };
  }

  // Check required sections exist
  const requiredSections = [
    'Overview', 'Prerequisites', 'Install', 'Credential', 'Import', 'Configure', 'Test', 'Troubleshoot'
  ];
  const foundSections = [];
  for (const section of requiredSections) {
    if (guide.toLowerCase().includes(section.toLowerCase())) {
      foundSections.push(section);
    }
  }

  if (foundSections.length < 5) {
    return {
      valid: false,
      score: 0,
      reason: `Missing sections: only found ${foundSections.length}/8 (${foundSections.join(', ')})`,
    };
  }

  // Check for tool-specific terminology (reject generic boilerplate)
  const toolTerms = {
    n8n: ['n8n', 'node', 'workflow'],
    comfyui: ['comfyui', 'node', 'class_type'],
    dify: ['dify', 'app', 'model'],
    flowise: ['flowise', 'chatflow', 'node'],
    pipedream: ['pipedream', 'component', 'step'],
    argo: ['argo', 'template', 'kubernetes'],
    luigi: ['luigi', 'task', 'require'],
    temporal: ['temporal', 'workflow', 'activity'],
    airflow: ['airflow', 'dag', 'operator'],
    prefect: ['prefect', 'flow', 'task'],
    dagster: ['dagster', 'asset', 'op'],
    langgraph: ['langgraph', 'graph', 'node'],
    activepieces: ['activepieces', 'piece', 'trigger'],
    tekton: ['tekton', 'pipeline', 'task', 'step'],
    'github-actions': ['github', 'actions', 'workflow', 'job'],
    'home-assistant': ['home assistant', 'automation', 'trigger', 'entity'],
    mlflow: ['mlflow', 'experiment', 'run', 'model'],
    dbt: ['dbt', 'model', 'source', 'ref'],
    camunda: ['camunda', 'bpmn', 'process', 'task'],
    'kafka-connect': ['kafka', 'connector', 'topic', 'transform'],
    camel: ['camel', 'route', 'from', 'component'],
  };

  const terms = toolTerms[toolType] || [];
  const guideLower = guide.toLowerCase();
  const matchedTerms = terms.filter(t => guideLower.includes(t));

  if (terms.length > 0 && matchedTerms.length === 0) {
    return { valid: false, score: 0, reason: `No tool-specific terminology for ${toolType}` };
  }

  // Calculate quality score (0-100)
  let score = 0;
  score += Math.min(words / 10, 30); // Up to 30 points for length
  score += foundSections.length * 5; // Up to 40 points for sections
  score += matchedTerms.length * 10; // Up to 30 points for specificity
  score = Math.min(Math.round(score), 100);

  return { valid: true, score };
}

/**
 * Count words in text.
 */
function countWords(text) {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * Count Markdown sections (## headings).
 */
function countSections(text) {
  const matches = text.match(/^##\s+/gm);
  return matches ? matches.length : 0;
}
