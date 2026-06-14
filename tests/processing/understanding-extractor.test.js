// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Mock DB helper ──────────────────────────────────────────────────────────

function createMockDb(queryResults = {}) {
  const calls = [];
  return {
    query: async (text, params) => {
      calls.push({ text, params });
      for (const [key, result] of Object.entries(queryResults)) {
        if (text.includes(key)) return result;
      }
      return { rows: [], rowCount: 0 };
    },
    calls,
  };
}

// ── Reimplemented core functions from understanding-extractor.js ─────────────

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

function buildPrompt(artifact) {
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

function parseUnderstanding(jsonStr) {
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

async function extractUnderstanding(artifact, callOllamaFn) {
  try {
    const prompt = buildPrompt(artifact);
    const response = await callOllamaFn(prompt);
    return parseUnderstanding(response);
  } catch (err) {
    return null;
  }
}

async function batchExtractUnderstanding(db, limit, callOllamaFn) {
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

    let understanding;
    try {
      const prompt = buildPrompt(artifact);
      const response = await callOllamaFn(prompt);
      understanding = parseUnderstanding(response);
    } catch {
      understanding = null;
    }
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
  }

  return { processed, succeeded, failed };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

// ── buildPrompt ─────────────────────────────────────────────────────────────

describe('buildPrompt — template rendering', () => {
  it('includes artifact name in prompt', () => {
    const prompt = buildPrompt({ name: 'My Cool Workflow' });
    assert.ok(prompt.includes('My Cool Workflow'));
  });

  it('includes artifact type in prompt', () => {
    const prompt = buildPrompt({ artifact_type: 'code_pattern' });
    assert.ok(prompt.includes('code_pattern'));
  });

  it('includes description in prompt', () => {
    const prompt = buildPrompt({ description: 'A data pipeline for ETL' });
    assert.ok(prompt.includes('A data pipeline for ETL'));
  });

  it('includes tags in prompt', () => {
    const prompt = buildPrompt({ tags: ['python', 'etl', 'airflow'] });
    assert.ok(prompt.includes('python, etl, airflow'));
  });

  it('truncates long content to 1000 chars', () => {
    const longContent = 'x'.repeat(2000);
    const prompt = buildPrompt({ content: longContent });
    // The prompt should not contain the full 2000 chars of content
    const contentPart = prompt.split('Content summary: ')[1];
    assert.ok(contentPart.length <= 1000 + UNDERSTANDING_PROMPT.length,
      'Content should be truncated');
  });

  it('handles missing fields gracefully', () => {
    const prompt = buildPrompt({});
    assert.ok(prompt.includes('Unknown'), 'Should default name to Unknown');
    assert.ok(prompt.includes('unknown'), 'Should default type to unknown');
    assert.ok(prompt.includes('No description'), 'Should default description');
  });

  it('handles object content (stringifies)', () => {
    const prompt = buildPrompt({ content: { nodes: [1, 2, 3], edges: [] } });
    assert.ok(prompt.includes('nodes'));
    assert.ok(prompt.includes('edges'));
  });
});

// ── parseUnderstanding ──────────────────────────────────────────────────────

describe('parseUnderstanding — JSON parsing', () => {
  it('parses valid JSON response', () => {
    const json = JSON.stringify({
      cloud_services: ['AWS S3', 'GCP BigQuery'],
      integrations: ['Slack', 'GitHub'],
      problems_solved: ['Data ingestion'],
      prerequisites: ['Python 3.10+'],
      architecture_pattern: 'pipeline',
    });
    const result = parseUnderstanding(json);
    assert.deepStrictEqual(result.cloud_services, ['AWS S3', 'GCP BigQuery']);
    assert.deepStrictEqual(result.integrations, ['Slack', 'GitHub']);
    assert.deepStrictEqual(result.problems_solved, ['Data ingestion']);
    assert.deepStrictEqual(result.prerequisites, ['Python 3.10+']);
    assert.equal(result.architecture_pattern, 'pipeline');
  });

  it('handles missing fields with defaults', () => {
    const result = parseUnderstanding('{}');
    assert.deepStrictEqual(result.cloud_services, []);
    assert.deepStrictEqual(result.integrations, []);
    assert.deepStrictEqual(result.problems_solved, []);
    assert.deepStrictEqual(result.prerequisites, []);
    assert.equal(result.architecture_pattern, 'unknown');
  });

  it('handles invalid JSON gracefully', () => {
    const result = parseUnderstanding('not valid json at all');
    assert.deepStrictEqual(result.cloud_services, []);
    assert.equal(result.architecture_pattern, 'unknown');
  });

  it('handles non-array cloud_services', () => {
    const result = parseUnderstanding(JSON.stringify({ cloud_services: 'AWS S3' }));
    assert.deepStrictEqual(result.cloud_services, []);
  });

  it('handles non-string architecture_pattern', () => {
    const result = parseUnderstanding(JSON.stringify({ architecture_pattern: 42 }));
    assert.equal(result.architecture_pattern, 'unknown');
  });

  it('returns complete structure on empty JSON', () => {
    const result = parseUnderstanding('{}');
    const keys = Object.keys(result);
    assert.ok(keys.includes('cloud_services'));
    assert.ok(keys.includes('integrations'));
    assert.ok(keys.includes('problems_solved'));
    assert.ok(keys.includes('prerequisites'));
    assert.ok(keys.includes('architecture_pattern'));
  });

  it('handles null-like JSON string', () => {
    const result = parseUnderstanding('null');
    assert.deepStrictEqual(result.cloud_services, []);
    assert.equal(result.architecture_pattern, 'unknown');
  });
});

// ── extractUnderstanding ────────────────────────────────────────────────────

describe('extractUnderstanding — Ollama integration (mocked)', () => {
  it('returns parsed understanding on success', async () => {
    const mockOllama = async () => JSON.stringify({
      cloud_services: ['AWS Lambda'],
      integrations: ['Stripe'],
      problems_solved: ['Payment processing'],
      prerequisites: ['Node.js 18+'],
      architecture_pattern: 'serverless',
    });
    const result = await extractUnderstanding(
      { name: 'Payment Handler', artifact_type: 'code_pattern' },
      mockOllama
    );
    assert.ok(result);
    assert.deepStrictEqual(result.cloud_services, ['AWS Lambda']);
    assert.equal(result.architecture_pattern, 'serverless');
  });

  it('returns null on Ollama error (graceful degradation)', async () => {
    const mockOllama = async () => { throw new Error('Connection refused'); };
    const result = await extractUnderstanding(
      { name: 'Test' },
      mockOllama
    );
    assert.equal(result, null);
  });

  it('passes correct prompt to Ollama', async () => {
    let receivedPrompt = null;
    const mockOllama = async (prompt) => {
      receivedPrompt = prompt;
      return '{}';
    };
    await extractUnderstanding(
      { name: 'My Workflow', artifact_type: 'workflow', description: 'Does things' },
      mockOllama
    );
    assert.ok(receivedPrompt.includes('My Workflow'));
    assert.ok(receivedPrompt.includes('workflow'));
    assert.ok(receivedPrompt.includes('Does things'));
  });
});

// ── batchExtractUnderstanding ───────────────────────────────────────────────

describe('batchExtractUnderstanding — batch processing (mocked)', () => {
  it('processes batch of artifacts', async () => {
    const mockOllama = async () => JSON.stringify({
      cloud_services: [], integrations: [], problems_solved: [],
      prerequisites: [], architecture_pattern: 'monolith',
    });
    const db = createMockDb({
      'SELECT id': {
        rows: [
          { id: 'a1', name: 'Art1', description: 'desc', artifact_type: 'workflow', tags: [], content: {}, type_metadata: null },
          { id: 'a2', name: 'Art2', description: 'desc', artifact_type: 'workflow', tags: [], content: {}, type_metadata: null },
        ],
        rowCount: 2,
      },
      'UPDATE artifacts': { rows: [], rowCount: 1 },
    });
    const result = await batchExtractUnderstanding(db, 50, mockOllama);
    assert.equal(result.processed, 2);
    assert.equal(result.succeeded, 2);
    assert.equal(result.failed, 0);
  });

  it('updates type_metadata with understanding', async () => {
    const mockOllama = async () => JSON.stringify({
      cloud_services: ['GCP'], integrations: [], problems_solved: [],
      prerequisites: [], architecture_pattern: 'microservices',
    });
    const db = createMockDb({
      'SELECT id': {
        rows: [{ id: 'a1', name: 'Art', description: '', artifact_type: 'workflow', tags: [], content: {}, type_metadata: {} }],
        rowCount: 1,
      },
      'UPDATE artifacts': { rows: [], rowCount: 1 },
    });
    await batchExtractUnderstanding(db, 50, mockOllama);
    const updateCall = db.calls.find(c => c.text.includes('UPDATE'));
    assert.ok(updateCall);
    const metadata = JSON.parse(updateCall.params[0]);
    assert.ok(metadata.understanding);
    assert.deepStrictEqual(metadata.understanding.cloud_services, ['GCP']);
  });

  it('counts succeeded/failed correctly', async () => {
    let callCount = 0;
    const mockOllama = async () => {
      callCount++;
      if (callCount === 2) throw new Error('Ollama down');
      return JSON.stringify({ cloud_services: [], integrations: [], problems_solved: [], prerequisites: [], architecture_pattern: 'unknown' });
    };
    const db = createMockDb({
      'SELECT id': {
        rows: [
          { id: 'a1', name: 'Art1', description: '', artifact_type: 'workflow', tags: [], content: {}, type_metadata: null },
          { id: 'a2', name: 'Art2', description: '', artifact_type: 'workflow', tags: [], content: {}, type_metadata: null },
          { id: 'a3', name: 'Art3', description: '', artifact_type: 'workflow', tags: [], content: {}, type_metadata: null },
        ],
        rowCount: 3,
      },
      'UPDATE artifacts': { rows: [], rowCount: 1 },
    });
    const result = await batchExtractUnderstanding(db, 50, mockOllama);
    assert.equal(result.processed, 3);
    assert.equal(result.succeeded, 2);
    assert.equal(result.failed, 1);
  });

  it('respects limit parameter', async () => {
    const mockOllama = async () => '{}';
    const db = createMockDb();
    await batchExtractUnderstanding(db, 25, mockOllama);
    assert.equal(db.calls[0].params[0], 25);
  });

  it('handles empty result set', async () => {
    const mockOllama = async () => '{}';
    const db = createMockDb();
    const result = await batchExtractUnderstanding(db, 50, mockOllama);
    assert.equal(result.processed, 0);
    assert.equal(result.succeeded, 0);
    assert.equal(result.failed, 0);
  });

  it('preserves existing type_metadata', async () => {
    const mockOllama = async () => JSON.stringify({
      cloud_services: [], integrations: [], problems_solved: [],
      prerequisites: [], architecture_pattern: 'pipeline',
    });
    const db = createMockDb({
      'SELECT id': {
        rows: [{ id: 'a1', name: 'Art', description: '', artifact_type: 'workflow', tags: [], content: {}, type_metadata: { existing_field: 'keep' } }],
        rowCount: 1,
      },
      'UPDATE artifacts': { rows: [], rowCount: 1 },
    });
    await batchExtractUnderstanding(db, 50, mockOllama);
    const updateCall = db.calls.find(c => c.text.includes('UPDATE'));
    const metadata = JSON.parse(updateCall.params[0]);
    assert.equal(metadata.existing_field, 'keep');
    assert.ok(metadata.understanding);
  });

  it('handles Ollama unavailable (all fail gracefully)', async () => {
    const mockOllama = async () => { throw new Error('ECONNREFUSED'); };
    const db = createMockDb({
      'SELECT id': {
        rows: [
          { id: 'a1', name: 'Art1', description: '', artifact_type: 'workflow', tags: [], content: {}, type_metadata: null },
          { id: 'a2', name: 'Art2', description: '', artifact_type: 'workflow', tags: [], content: {}, type_metadata: null },
        ],
        rowCount: 2,
      },
      'UPDATE artifacts': { rows: [], rowCount: 1 },
    });
    const result = await batchExtractUnderstanding(db, 50, mockOllama);
    assert.equal(result.processed, 2);
    assert.equal(result.succeeded, 0);
    assert.equal(result.failed, 2);
  });

  it('handles artifacts with string type_metadata', async () => {
    const mockOllama = async () => JSON.stringify({
      cloud_services: [], integrations: [], problems_solved: [],
      prerequisites: [], architecture_pattern: 'unknown',
    });
    const db = createMockDb({
      'SELECT id': {
        rows: [{ id: 'a1', name: 'Art', description: '', artifact_type: 'workflow', tags: [], content: {}, type_metadata: '{"key": "val"}' }],
        rowCount: 1,
      },
      'UPDATE artifacts': { rows: [], rowCount: 1 },
    });
    const result = await batchExtractUnderstanding(db, 50, mockOllama);
    assert.equal(result.processed, 1);
    assert.equal(result.succeeded, 1);
    const updateCall = db.calls.find(c => c.text.includes('UPDATE'));
    const metadata = JSON.parse(updateCall.params[0]);
    assert.equal(metadata.key, 'val');
  });
});
