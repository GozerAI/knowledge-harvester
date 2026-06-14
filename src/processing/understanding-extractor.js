// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * LLM-driven metadata extraction via Ollama chat API.
 */

import http from 'node:http';
import { config } from '../config.js';

const UNDERSTANDING_PROMPT = `Analyze this software artifact and extract structured metadata. Return ONLY valid JSON with these fields:
{
  "cloud_services": ["list of cloud services used, e.g. AWS S3, GCP BigQuery"],
  "integrations": ["list of external integrations, e.g. Slack, GitHub, Stripe"],
  "problems_solved": ["list of problems this artifact solves"],
  "prerequisites": ["list of prerequisites to use this"],
  "architecture_pattern": "the primary architecture pattern (e.g. microservices, monolith, serverless, event-driven, pipeline)"
}

Artifact details:
Name: {{name}}
Type: {{artifact_type}}
Description: {{description}}
Tags: {{tags}}
Content summary: {{content_summary}}`;

export function buildPrompt(artifact) {
  const content = artifact.content || {};
  const contentSummary = typeof content === 'string'
    ? content.substring(0, 1000)
    : JSON.stringify(content).substring(0, 1000);

  return UNDERSTANDING_PROMPT
    .replace('{{name}}', artifact.name || 'Unknown')
    .replace('{{artifact_type}}', artifact.artifact_type || 'unknown')
    .replace('{{description}}', artifact.description || 'No description')
    .replace('{{tags}}', (artifact.tags || []).join(', '))
    .replace('{{content_summary}}', contentSummary);
}

export async function callOllama(prompt, ollamaHost, ollamaModel) {
  const host = ollamaHost || config.ollama?.host || 'http://localhost:11434';
  const model = ollamaModel || config.ollama?.model || 'qwen2.5:7b';

  const url = new URL('/api/chat', host);

  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
    format: 'json',
  });

  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 60000,
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.message?.content || '{}');
        } catch {
          reject(new Error('Invalid Ollama response'));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Ollama timeout')); });
    req.write(body);
    req.end();
  });
}

export function parseUnderstanding(jsonStr) {
  try {
    const parsed = JSON.parse(jsonStr);
    return {
      cloud_services: Array.isArray(parsed.cloud_services) ? parsed.cloud_services : [],
      integrations: Array.isArray(parsed.integrations) ? parsed.integrations : [],
      problems_solved: Array.isArray(parsed.problems_solved) ? parsed.problems_solved : [],
      prerequisites: Array.isArray(parsed.prerequisites) ? parsed.prerequisites : [],
      architecture_pattern: typeof parsed.architecture_pattern === 'string' ? parsed.architecture_pattern : 'unknown',
    };
  } catch {
    return {
      cloud_services: [],
      integrations: [],
      problems_solved: [],
      prerequisites: [],
      architecture_pattern: 'unknown',
    };
  }
}

export async function extractUnderstanding(artifact, ollamaHost, ollamaModel) {
  try {
    const prompt = buildPrompt(artifact);
    const response = await callOllama(prompt, ollamaHost, ollamaModel);
    return parseUnderstanding(response);
  } catch (err) {
    // Graceful degradation
    return null;
  }
}

export async function batchExtractUnderstanding(db, limit = 50, ollamaHost, ollamaModel) {
  const result = await db.query(
    `SELECT id, name, description, artifact_type, tags, content, type_metadata
     FROM artifacts
     WHERE type_metadata IS NULL
        OR NOT (type_metadata::jsonb ? 'understanding')
     ORDER BY quality_score DESC NULLS LAST
     LIMIT $1`,
    [limit]
  );

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const row of result.rows) {
    const artifact = {
      id: row.id,
      name: row.name,
      description: row.description,
      artifact_type: row.artifact_type,
      tags: row.tags || [],
      content: row.content,
      type_metadata: typeof row.type_metadata === 'string' ? JSON.parse(row.type_metadata) : (row.type_metadata || {}),
    };

    const understanding = await extractUnderstanding(artifact, ollamaHost, ollamaModel);
    processed++;

    if (understanding) {
      const updatedMetadata = { ...artifact.type_metadata, understanding };
      await db.query(
        'UPDATE artifacts SET type_metadata = $1 WHERE id = $2',
        [JSON.stringify(updatedMetadata), artifact.id]
      );
      succeeded++;
    } else {
      failed++;
    }

    // Rate limit: 1 request per 2 seconds
    if (processed < result.rows.length) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  return { processed, succeeded, failed };
}
