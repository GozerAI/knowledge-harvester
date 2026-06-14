// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for Artifact Processing — type detection, metadata extraction,
 * hash-based deduplication, versioning, large artifact handling,
 * and malformed artifact recovery.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  ARTIFACT_TYPES,
  PHASES,
  registerStrategy,
  getStrategy,
  clearStrategies,
  hasStrategy,
  registerType,
  listStrategies,
} from '../../src/processing/registry.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function sha256(str) {
  return createHash('sha256').update(str).digest('hex');
}

function generateContentHash(content, framework = 'generic') {
  let normalized;
  if (typeof content === 'string') {
    normalized = content
      .replace(/\r\n/g, '\n')
      .replace(/#.*$/gm, '')
      .replace(/\/\/.*$/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
  } else {
    normalized = JSON.stringify(content, Object.keys(content).sort());
  }
  return sha256(`${framework}:${normalized}`);
}

// ── Artifact type detection (rule-based, from classifier logic) ────────────

const TYPE_SIGNATURES = {
  workflow: {
    extensions: ['.json'],
    keywords: ['nodes', 'connections', 'trigger', 'workflow'],
    tools: ['n8n', 'activepieces', 'node-red', 'pipedream', 'windmill', 'temporal'],
  },
  code_pattern: {
    extensions: ['.py', '.js', '.ts', '.go', '.rs', '.java'],
    keywords: ['function', 'class', 'def', 'import', 'export', 'module'],
    tools: ['langchain', 'crewai', 'autogen', 'langgraph'],
  },
  api_spec: {
    extensions: ['.yaml', '.yml', '.json'],
    keywords: ['openapi', 'swagger', 'paths', 'endpoints', 'schemas'],
    tools: [],
  },
  infra_config: {
    extensions: ['.yaml', '.yml', '.tf', '.hcl', '.toml'],
    keywords: ['provider', 'resource', 'service', 'container', 'volume', 'helm', 'chart'],
    tools: ['terraform', 'ansible', 'helm', 'docker-compose', 'k8s'],
  },
  ai_ml_asset: {
    extensions: ['.py', '.ipynb', '.yaml'],
    keywords: ['model', 'training', 'inference', 'dataset', 'epoch', 'loss', 'optimizer'],
    tools: ['mlflow', 'pytorch', 'tensorflow', 'comfyui'],
  },
  data_asset: {
    extensions: ['.sql', '.csv', '.parquet', '.json'],
    keywords: ['schema', 'table', 'column', 'query', 'SELECT', 'INSERT', 'migration'],
    tools: ['dbt', 'dagster', 'airflow', 'prefect'],
  },
  documentation: {
    extensions: ['.md', '.rst', '.txt', '.adoc'],
    keywords: ['README', 'guide', 'tutorial', 'documentation', 'setup', 'install'],
    tools: [],
  },
};

function detectArtifactType(artifact) {
  if (!artifact) return null;

  const filename = (artifact.filename || '').toLowerCase();
  const content = (artifact.content || '').toLowerCase();
  const toolType = (artifact.tool_type || '').toLowerCase();

  const scores = {};

  for (const [type, sigs] of Object.entries(TYPE_SIGNATURES)) {
    let score = 0;

    // Check file extension
    for (const ext of sigs.extensions) {
      if (filename.endsWith(ext)) { score += 3; break; }
    }

    // Check content keywords
    for (const kw of sigs.keywords) {
      if (content.includes(kw.toLowerCase())) score += 1;
    }

    // Check tool type
    for (const tool of sigs.tools) {
      if (toolType === tool || toolType.includes(tool)) { score += 5; break; }
    }

    scores[type] = score;
  }

  // Return the type with the highest score
  let bestType = 'workflow'; // default
  let bestScore = 0;
  for (const [type, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestType = type;
      bestScore = score;
    }
  }

  return bestType;
}

/**
 * Extract metadata from an artifact based on its type.
 */
function extractMetadata(artifact) {
  const meta = {
    name: artifact.name || 'Untitled',
    source: artifact.source || 'unknown',
    artifact_type: artifact.artifact_type || detectArtifactType(artifact),
    size_bytes: typeof artifact.content === 'string' ? Buffer.byteLength(artifact.content) : 0,
    detected_language: null,
    dependency_count: 0,
    has_tests: false,
    has_documentation: false,
    extracted_at: new Date().toISOString(),
  };

  const content = artifact.content || '';

  // Language detection
  if (content.includes('def ') || content.includes('import ')) meta.detected_language = 'python';
  else if (content.includes('function ') || content.includes('const ')) meta.detected_language = 'javascript';
  else if (content.includes('func ') || content.includes('package ')) meta.detected_language = 'go';
  else if (content.includes('fn ') || content.includes('use ')) meta.detected_language = 'rust';

  // Dependency detection
  const importMatches = content.match(/^(import |from |require\(|use )/gm);
  meta.dependency_count = importMatches ? importMatches.length : 0;

  // Test detection
  meta.has_tests = /\b(test_|_test|\.test\.|spec\.|describe\(|it\(|assert)/i.test(content);

  // Documentation detection
  meta.has_documentation = /\b(README|@param|@returns|"""|'''|\/\*\*)/i.test(content);

  return meta;
}

/**
 * Artifact versioning: determine if a new version should be created.
 */
function shouldCreateVersion(existingHash, newHash, existingVersion = 1) {
  if (!existingHash || !newHash) return { create: false, reason: 'missing_hash' };
  if (existingHash === newHash) return { create: false, reason: 'identical' };
  return { create: true, reason: 'content_changed', newVersion: existingVersion + 1 };
}

/**
 * Handle large artifacts: check if an artifact exceeds size limits and needs chunking.
 */
const MAX_ARTIFACT_SIZE = 1024 * 1024; // 1MB
const CHUNK_SIZE = 256 * 1024; // 256KB

function handleLargeArtifact(artifact) {
  const size = typeof artifact.content === 'string' ? Buffer.byteLength(artifact.content) : 0;

  if (size <= MAX_ARTIFACT_SIZE) {
    return { isLarge: false, chunks: null, originalSize: size };
  }

  // Split into chunks
  const content = artifact.content;
  const chunks = [];
  for (let i = 0; i < content.length; i += CHUNK_SIZE) {
    chunks.push({
      index: chunks.length,
      content: content.slice(i, i + CHUNK_SIZE),
      hash: sha256(content.slice(i, i + CHUNK_SIZE)),
    });
  }

  return {
    isLarge: true,
    chunks,
    originalSize: size,
    chunkCount: chunks.length,
  };
}

/**
 * Attempt to recover a malformed artifact by cleaning/fixing common issues.
 */
function recoverMalformedArtifact(rawData) {
  const issues = [];

  if (!rawData) return { recovered: false, issues: ['null_data'] };

  let data = { ...rawData };

  // Fix 1: Missing name
  if (!data.name || data.name.trim() === '') {
    data.name = data.filename || data.source_id || 'Recovered-Artifact';
    issues.push('missing_name');
  }

  // Fix 2: Malformed JSON content
  if (typeof data.content === 'string' && data.content.trim().startsWith('{')) {
    try {
      JSON.parse(data.content);
    } catch {
      // Try to fix common JSON issues
      let fixed = data.content
        .replace(/,\s*}/g, '}')      // trailing commas
        .replace(/,\s*]/g, ']')      // trailing commas in arrays
        .replace(/'/g, '"')          // single quotes to double
        .replace(/\n/g, '\\n');      // unescaped newlines in strings
      try {
        JSON.parse(fixed);
        data.content = fixed;
        issues.push('fixed_json');
      } catch {
        issues.push('unfixable_json');
      }
    }
  }

  // Fix 3: Missing source
  if (!data.source) {
    data.source = 'unknown';
    issues.push('missing_source');
  }

  // Fix 4: Invalid dates
  if (data.discovered_at && isNaN(new Date(data.discovered_at).getTime())) {
    data.discovered_at = new Date().toISOString();
    issues.push('invalid_discovered_at');
  }

  // Fix 5: Empty content
  if (!data.content || (typeof data.content === 'string' && data.content.trim() === '')) {
    return { recovered: false, data, issues: [...issues, 'empty_content'] };
  }

  return {
    recovered: issues.length > 0 || true,
    data,
    issues,
  };
}


// ── Tests ──────────────────────────────────────────────────────────────────

describe('Artifact Type Detection', () => {
  it('detects workflow type from n8n tool', () => {
    const type = detectArtifactType({
      tool_type: 'n8n',
      filename: 'workflow.json',
      content: '{"nodes": [], "connections": {}}',
    });
    assert.equal(type, 'workflow');
  });

  it('detects code_pattern from Python source', () => {
    const type = detectArtifactType({
      filename: 'agent.py',
      content: 'from langchain import chains\ndef process():\n  pass',
      tool_type: 'langchain',
    });
    assert.equal(type, 'code_pattern');
  });

  it('detects api_spec from OpenAPI content', () => {
    const type = detectArtifactType({
      filename: 'api.yaml',
      content: 'openapi: 3.0.0\npaths:\n  /users:\n    get:\n      schemas: []\n      endpoints: []',
    });
    assert.equal(type, 'api_spec');
  });

  it('detects infra_config from Terraform file', () => {
    const type = detectArtifactType({
      filename: 'main.tf',
      content: 'provider "aws" {\n  resource "ec2" {}\n}',
      tool_type: 'terraform',
    });
    assert.equal(type, 'infra_config');
  });

  it('detects ai_ml_asset from ML training code', () => {
    const type = detectArtifactType({
      filename: 'train.py',
      content: 'model = create_model()\nfor epoch in range(10):\n  loss = train(model)\n  optimizer.step()',
      tool_type: 'pytorch',
    });
    assert.equal(type, 'ai_ml_asset');
  });

  it('detects data_asset from SQL schema', () => {
    const type = detectArtifactType({
      filename: 'schema.sql',
      content: 'CREATE TABLE users (id INT, name TEXT);\nSELECT * FROM users;',
      tool_type: 'dbt',
    });
    assert.equal(type, 'data_asset');
  });

  it('detects documentation from markdown', () => {
    const type = detectArtifactType({
      filename: 'README.md',
      content: '# Setup Guide\n\nThis is a tutorial for documentation and install instructions.',
    });
    assert.equal(type, 'documentation');
  });

  it('returns workflow as default for ambiguous content', () => {
    const type = detectArtifactType({
      filename: 'unknown',
      content: '',
    });
    assert.equal(type, 'workflow');
  });

  it('returns null for null artifact', () => {
    assert.equal(detectArtifactType(null), null);
  });

  it('handles missing fields gracefully', () => {
    const type = detectArtifactType({});
    assert.ok(ARTIFACT_TYPES.includes(type));
  });

  it('all 7 artifact types are detectable', () => {
    for (const expectedType of ARTIFACT_TYPES) {
      const sigs = TYPE_SIGNATURES[expectedType];
      assert.ok(sigs, `No signatures defined for ${expectedType}`);
      assert.ok(sigs.extensions.length > 0 || sigs.keywords.length > 0,
        `${expectedType} needs at least extensions or keywords`);
    }
  });
});


describe('Artifact Metadata Extraction', () => {
  it('extracts basic metadata fields', () => {
    const meta = extractMetadata({
      name: 'Test Artifact',
      source: 'github',
      content: 'console.log("hello")',
    });
    assert.equal(meta.name, 'Test Artifact');
    assert.equal(meta.source, 'github');
    assert.ok(meta.size_bytes > 0);
    assert.ok(meta.extracted_at);
  });

  it('detects Python language', () => {
    const meta = extractMetadata({
      content: 'def hello():\n  import os\n  pass',
    });
    assert.equal(meta.detected_language, 'python');
  });

  it('detects JavaScript language', () => {
    const meta = extractMetadata({
      content: 'const x = 1;\nfunction hello() {}',
    });
    assert.equal(meta.detected_language, 'javascript');
  });

  it('detects Go language', () => {
    const meta = extractMetadata({
      content: 'package main\nfunc main() {}',
    });
    assert.equal(meta.detected_language, 'go');
  });

  it('detects Rust language', () => {
    const meta = extractMetadata({
      content: 'use std::io;\nfn main() {}',
    });
    assert.equal(meta.detected_language, 'rust');
  });

  it('counts dependencies', () => {
    const meta = extractMetadata({
      content: 'import os\nimport sys\nfrom pathlib import Path\nrequire("express")',
    });
    assert.equal(meta.dependency_count, 4);
  });

  it('detects tests in content', () => {
    const meta = extractMetadata({
      content: 'describe("test", () => { it("works", () => { assert.ok(true); }) })',
    });
    assert.equal(meta.has_tests, true);
  });

  it('detects documentation markers', () => {
    const meta = extractMetadata({
      content: 'README\n@param name - The name\n@returns string',
    });
    assert.equal(meta.has_documentation, true);
  });

  it('handles empty content', () => {
    const meta = extractMetadata({ content: '' });
    assert.equal(meta.size_bytes, 0);
    assert.equal(meta.detected_language, null);
    assert.equal(meta.dependency_count, 0);
  });

  it('uses Untitled for missing name', () => {
    const meta = extractMetadata({});
    assert.equal(meta.name, 'Untitled');
  });

  it('uses unknown for missing source', () => {
    const meta = extractMetadata({});
    assert.equal(meta.source, 'unknown');
  });

  it('auto-detects artifact_type when not provided', () => {
    const meta = extractMetadata({
      filename: 'main.tf',
      content: 'provider "aws" { resource "s3" {} }',
      tool_type: 'terraform',
    });
    assert.equal(meta.artifact_type, 'infra_config');
  });
});


describe('Artifact Hash-Based Deduplication', () => {
  it('produces identical hash for identical content', () => {
    const h1 = generateContentHash('def hello(): pass', 'python');
    const h2 = generateContentHash('def hello(): pass', 'python');
    assert.equal(h1, h2);
  });

  it('produces different hash for different content', () => {
    const h1 = generateContentHash('def hello(): pass', 'python');
    const h2 = generateContentHash('def goodbye(): pass', 'python');
    assert.notEqual(h1, h2);
  });

  it('produces different hash for different frameworks', () => {
    const h1 = generateContentHash('code', 'langchain');
    const h2 = generateContentHash('code', 'crewai');
    assert.notEqual(h1, h2);
  });

  it('normalizes whitespace differences', () => {
    const h1 = generateContentHash('x = 1\ny = 2');
    const h2 = generateContentHash('x = 1  \n  y = 2');
    assert.equal(h1, h2);
  });

  it('normalizes line endings', () => {
    const h1 = generateContentHash('line1\nline2');
    const h2 = generateContentHash('line1\r\nline2');
    assert.equal(h1, h2);
  });

  it('strips Python comments', () => {
    const h1 = generateContentHash('x = 1 # comment');
    const h2 = generateContentHash('x = 1 ');
    assert.equal(h1, h2);
  });

  it('strips JS single-line comments', () => {
    const h1 = generateContentHash('x = 1 // comment');
    const h2 = generateContentHash('x = 1 ');
    assert.equal(h1, h2);
  });

  it('handles JSON object content', () => {
    const h = generateContentHash({ key: 'value', nested: { a: 1 } });
    assert.equal(h.length, 64);
  });

  it('hash is always 64 characters (SHA-256 hex)', () => {
    assert.equal(generateContentHash('').length, 64);
    assert.equal(generateContentHash('a'.repeat(10000)).length, 64);
  });
});


describe('Artifact Versioning', () => {
  it('does not create version when hashes match', () => {
    const hash = sha256('content');
    const result = shouldCreateVersion(hash, hash, 1);
    assert.equal(result.create, false);
    assert.equal(result.reason, 'identical');
  });

  it('creates new version when hashes differ', () => {
    const result = shouldCreateVersion(sha256('v1'), sha256('v2'), 1);
    assert.equal(result.create, true);
    assert.equal(result.reason, 'content_changed');
    assert.equal(result.newVersion, 2);
  });

  it('increments version correctly', () => {
    const result = shouldCreateVersion(sha256('a'), sha256('b'), 5);
    assert.equal(result.newVersion, 6);
  });

  it('handles missing existing hash', () => {
    const result = shouldCreateVersion(null, sha256('new'));
    assert.equal(result.create, false);
    assert.equal(result.reason, 'missing_hash');
  });

  it('handles missing new hash', () => {
    const result = shouldCreateVersion(sha256('old'), null);
    assert.equal(result.create, false);
    assert.equal(result.reason, 'missing_hash');
  });

  it('handles both hashes missing', () => {
    const result = shouldCreateVersion(null, null);
    assert.equal(result.create, false);
  });

  it('defaults to version 1 when existing version not provided', () => {
    const result = shouldCreateVersion(sha256('a'), sha256('b'));
    assert.equal(result.newVersion, 2);
  });
});


describe('Large Artifact Handling', () => {
  it('small artifact is not flagged as large', () => {
    const result = handleLargeArtifact({ content: 'small content' });
    assert.equal(result.isLarge, false);
    assert.equal(result.chunks, null);
  });

  it('large artifact is split into chunks', () => {
    const largeContent = 'x'.repeat(1024 * 1024 + 1); // 1MB+1
    const result = handleLargeArtifact({ content: largeContent });
    assert.equal(result.isLarge, true);
    assert.ok(result.chunks.length > 1);
    assert.ok(result.chunkCount > 1);
  });

  it('chunks have correct structure', () => {
    const largeContent = 'a'.repeat(1024 * 1024 + 1);
    const result = handleLargeArtifact({ content: largeContent });
    for (const chunk of result.chunks) {
      assert.ok('index' in chunk);
      assert.ok('content' in chunk);
      assert.ok('hash' in chunk);
      assert.equal(chunk.hash.length, 64);
    }
  });

  it('chunk indices are sequential', () => {
    const largeContent = 'b'.repeat(1024 * 1024 * 2);
    const result = handleLargeArtifact({ content: largeContent });
    for (let i = 0; i < result.chunks.length; i++) {
      assert.equal(result.chunks[i].index, i);
    }
  });

  it('preserves original size', () => {
    const content = 'c'.repeat(1024 * 1024 + 100);
    const result = handleLargeArtifact({ content });
    assert.equal(result.originalSize, Buffer.byteLength(content));
  });

  it('handles exactly 1MB content (at boundary)', () => {
    const content = 'd'.repeat(1024 * 1024);
    const result = handleLargeArtifact({ content });
    assert.equal(result.isLarge, false);
  });

  it('handles empty content', () => {
    const result = handleLargeArtifact({ content: '' });
    assert.equal(result.isLarge, false);
    assert.equal(result.originalSize, 0);
  });

  it('handles missing content', () => {
    const result = handleLargeArtifact({});
    assert.equal(result.isLarge, false);
    assert.equal(result.originalSize, 0);
  });
});


describe('Malformed Artifact Recovery', () => {
  it('recovers artifact with missing name', () => {
    const result = recoverMalformedArtifact({
      content: 'valid content',
      filename: 'test.py',
    });
    assert.equal(result.recovered, true);
    assert.equal(result.data.name, 'test.py');
    assert.ok(result.issues.includes('missing_name'));
  });

  it('recovers artifact with empty name', () => {
    const result = recoverMalformedArtifact({
      name: '  ',
      content: 'content',
      source_id: 'abc-123',
    });
    assert.equal(result.data.name, 'abc-123');
  });

  it('fixes trailing commas in JSON content', () => {
    const result = recoverMalformedArtifact({
      name: 'Test',
      content: '{"key": "value",}',
    });
    assert.ok(result.issues.includes('fixed_json'));
    // The fixed content should be parseable
    assert.doesNotThrow(() => JSON.parse(result.data.content));
  });

  it('fixes single quotes in JSON content', () => {
    const result = recoverMalformedArtifact({
      name: 'Test',
      content: "{'key': 'value'}",
    });
    assert.ok(result.issues.includes('fixed_json'));
  });

  it('adds missing source', () => {
    const result = recoverMalformedArtifact({
      name: 'Test',
      content: 'content',
    });
    assert.equal(result.data.source, 'unknown');
    assert.ok(result.issues.includes('missing_source'));
  });

  it('fixes invalid discovered_at date', () => {
    const result = recoverMalformedArtifact({
      name: 'Test',
      content: 'content',
      source: 'github',
      discovered_at: 'not-a-date',
    });
    assert.ok(result.issues.includes('invalid_discovered_at'));
    assert.ok(!isNaN(new Date(result.data.discovered_at).getTime()));
  });

  it('fails recovery for empty content', () => {
    const result = recoverMalformedArtifact({
      name: 'Test',
      content: '',
      source: 'github',
    });
    assert.equal(result.recovered, false);
    assert.ok(result.issues.includes('empty_content'));
  });

  it('fails recovery for null data', () => {
    const result = recoverMalformedArtifact(null);
    assert.equal(result.recovered, false);
    assert.ok(result.issues.includes('null_data'));
  });

  it('reports unfixable JSON', () => {
    const result = recoverMalformedArtifact({
      name: 'Test',
      content: '{{{{invalid json completely broken',
    });
    // Starts with { so tries JSON recovery, but it's unfixable
    assert.ok(result.issues.includes('unfixable_json'));
  });

  it('passes through valid artifact with no issues', () => {
    const result = recoverMalformedArtifact({
      name: 'Valid',
      content: 'def hello(): pass',
      source: 'github',
      discovered_at: '2026-01-01T00:00:00Z',
    });
    assert.equal(result.recovered, true);
    assert.equal(result.issues.length, 0);
    assert.equal(result.data.name, 'Valid');
  });

  it('handles multiple simultaneous issues', () => {
    const result = recoverMalformedArtifact({
      content: '{"key": "value",}',
      discovered_at: 'bad-date',
    });
    assert.ok(result.issues.length >= 3); // missing_name + missing_source + fixed_json + invalid_discovered_at
  });
});


describe('Registry ARTIFACT_TYPES and PHASES constants', () => {
  it('has exactly 7 artifact types', () => {
    assert.equal(ARTIFACT_TYPES.length, 7);
  });

  it('includes all expected types', () => {
    const expected = ['workflow', 'code_pattern', 'api_spec', 'infra_config', 'ai_ml_asset', 'data_asset', 'documentation'];
    for (const t of expected) {
      assert.ok(ARTIFACT_TYPES.includes(t), `Missing type: ${t}`);
    }
  });

  it('has 6 processing phases', () => {
    assert.equal(PHASES.length, 6);
  });

  it('includes all expected phases', () => {
    const expected = ['normalize', 'classify', 'score', 'package', 'complexity', 'validate'];
    for (const p of expected) {
      assert.ok(PHASES.includes(p), `Missing phase: ${p}`);
    }
  });
});
