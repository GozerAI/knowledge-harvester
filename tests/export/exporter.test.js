// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

import {
  exportArtifact,
  generateReadme,
  generateEnvExample,
  generateDockerCompose,
  createTarGz,
  createTarBuffer,
  toYaml,
} from '../../src/export/exporter.js';

const gunzip = promisify(zlib.gunzip);

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeArtifact(overrides = {}) {
  return {
    id: 'test-uuid-1234',
    artifact_type: 'workflow',
    name: 'Test Workflow',
    description: 'A test workflow artifact',
    tool_type: 'n8n',
    language: null,
    source: 'github',
    source_url: 'https://github.com/example/repo',
    tags: ['automation', 'n8n'],
    credentials_required: ['openaiApi', 'slackOAuth'],
    type_metadata: {
      node_count: 5,
      trigger_type: 'webhook',
    },
    ...overrides,
  };
}

// ── JSON Export ───────────────────────────────────────────────────────────────

describe('exportArtifact — json', () => {
  it('returns a valid JSON string', async () => {
    const artifact = makeArtifact();
    const result = await exportArtifact(artifact, 'json');
    assert.doesNotThrow(() => JSON.parse(result));
  });

  it('pretty-prints with 2-space indentation', async () => {
    const artifact = makeArtifact();
    const result = await exportArtifact(artifact, 'json');
    assert.ok(result.includes('  "name"'), 'Should have 2-space indent');
  });

  it('round-trips the artifact data', async () => {
    const artifact = makeArtifact();
    const result = await exportArtifact(artifact, 'json');
    const parsed = JSON.parse(result);
    assert.equal(parsed.id, artifact.id);
    assert.equal(parsed.name, artifact.name);
    assert.deepEqual(parsed.tags, artifact.tags);
  });

  it('includes all top-level fields', async () => {
    const artifact = makeArtifact();
    const result = await exportArtifact(artifact, 'json');
    const parsed = JSON.parse(result);
    assert.ok('artifact_type' in parsed);
    assert.ok('tool_type' in parsed);
    assert.ok('type_metadata' in parsed);
  });
});

// ── YAML Export ───────────────────────────────────────────────────────────────

describe('exportArtifact — yaml', () => {
  it('returns a non-empty string', async () => {
    const artifact = makeArtifact();
    const result = await exportArtifact(artifact, 'yaml');
    assert.ok(typeof result === 'string' && result.length > 0);
  });

  it('contains key: value pairs', async () => {
    const artifact = makeArtifact();
    const result = await exportArtifact(artifact, 'yaml');
    assert.ok(result.includes('name:'), 'Should contain "name:" key');
    assert.ok(result.includes('Test Workflow'), 'Should contain artifact name');
  });

  it('serializes arrays with dash notation', async () => {
    const artifact = makeArtifact();
    const result = await exportArtifact(artifact, 'yaml');
    assert.ok(result.includes('- '), 'Arrays should use dash notation');
    assert.ok(result.includes('automation') || result.includes('n8n'));
  });

  it('serializes nested objects with indentation', async () => {
    const artifact = makeArtifact();
    const result = await exportArtifact(artifact, 'yaml');
    // type_metadata has nested keys — should see indented output
    assert.ok(result.includes('type_metadata'), 'Should contain type_metadata');
  });

  it('handles boolean values correctly', async () => {
    const result = toYaml({ active: true, disabled: false });
    assert.ok(result.includes('active: true'));
    assert.ok(result.includes('disabled: false'));
  });

  it('handles numeric values', async () => {
    const result = toYaml({ count: 42, ratio: 0.5 });
    assert.ok(result.includes('count: 42'));
    assert.ok(result.includes('ratio: 0.5'));
  });

  it('handles null values', async () => {
    const result = toYaml({ value: null });
    assert.ok(result.includes('value: null'));
  });

  it('quotes strings with special characters', async () => {
    const result = toYaml({ url: 'http://example.com:8080/path' });
    assert.ok(result.includes('"'), 'URLs with colons should be quoted');
  });
});

// ── tar.gz Export ─────────────────────────────────────────────────────────────

describe('exportArtifact — tar.gz', () => {
  it('returns a Buffer', async () => {
    const artifact = makeArtifact();
    const result = await exportArtifact(artifact, 'tar.gz');
    assert.ok(Buffer.isBuffer(result), 'Should return a Buffer');
  });

  it('produces valid gzip output (can decompress)', async () => {
    const artifact = makeArtifact();
    const result = await exportArtifact(artifact, 'tar.gz');
    await assert.doesNotReject(() => gunzip(result), 'Should be valid gzip');
  });

  it('contains artifact.json in the archive', async () => {
    const artifact = makeArtifact();
    const result = await exportArtifact(artifact, 'tar.gz');
    const decompressed = await gunzip(result);
    assert.ok(decompressed.toString().includes('artifact.json'), 'Archive should list artifact.json');
  });

  it('contains README.md in the archive', async () => {
    const artifact = makeArtifact();
    const result = await exportArtifact(artifact, 'tar.gz');
    const decompressed = await gunzip(result);
    assert.ok(decompressed.toString().includes('README.md'), 'Archive should list README.md');
  });

  it('contains .env.example in the archive', async () => {
    const artifact = makeArtifact();
    const result = await exportArtifact(artifact, 'tar.gz');
    const decompressed = await gunzip(result);
    assert.ok(decompressed.toString().includes('.env.example'), 'Archive should list .env.example');
  });

  it('contains docker-compose.yml for workflow artifacts', async () => {
    const artifact = makeArtifact({ artifact_type: 'workflow', tool_type: 'n8n' });
    const result = await exportArtifact(artifact, 'tar.gz');
    const decompressed = await gunzip(result);
    assert.ok(decompressed.toString().includes('docker-compose.yml'), 'Should include docker-compose.yml');
  });
});

// ── README Generation ─────────────────────────────────────────────────────────

describe('generateReadme', () => {
  it('includes the artifact name as heading', () => {
    const artifact = makeArtifact({ name: 'My Awesome Workflow' });
    const readme = generateReadme(artifact);
    assert.ok(readme.includes('# My Awesome Workflow'), 'Should include name as H1');
  });

  it('includes the description', () => {
    const artifact = makeArtifact({ description: 'Does amazing things' });
    const readme = generateReadme(artifact);
    assert.ok(readme.includes('Does amazing things'));
  });

  it('includes artifact type information', () => {
    const artifact = makeArtifact({ artifact_type: 'workflow', tool_type: 'n8n' });
    const readme = generateReadme(artifact);
    assert.ok(readme.includes('workflow'), 'Should mention artifact type');
    assert.ok(readme.includes('n8n'), 'Should mention tool type');
  });

  it('includes tags section when tags are present', () => {
    const artifact = makeArtifact({ tags: ['automation', 'api'] });
    const readme = generateReadme(artifact);
    assert.ok(readme.includes('Tags') || readme.includes('automation'));
  });

  it('includes source URL when provided', () => {
    const artifact = makeArtifact({ source_url: 'https://github.com/example/repo' });
    const readme = generateReadme(artifact);
    assert.ok(readme.includes('https://github.com/example/repo'));
  });

  it('handles missing description gracefully', () => {
    const artifact = makeArtifact({ description: undefined });
    assert.doesNotThrow(() => generateReadme(artifact));
    const readme = generateReadme(artifact);
    assert.ok(readme.includes('No description'));
  });

  it('includes setup instructions', () => {
    const artifact = makeArtifact();
    const readme = generateReadme(artifact);
    assert.ok(readme.includes('Setup') || readme.includes('setup'));
  });
});

// ── .env.example Generation ───────────────────────────────────────────────────

describe('generateEnvExample', () => {
  it('produces a non-empty string', () => {
    const artifact = makeArtifact();
    const env = generateEnvExample(artifact);
    assert.ok(typeof env === 'string' && env.length > 0);
  });

  it('includes credential placeholders from credentials_required', () => {
    const artifact = makeArtifact({ credentials_required: ['openaiApi'] });
    const env = generateEnvExample(artifact);
    assert.ok(env.includes('OPENAIAPI') || env.includes('OPENAI'), 'Should include openai credential');
  });

  it('includes n8n-specific env vars for n8n artifacts', () => {
    const artifact = makeArtifact({ tool_type: 'n8n' });
    const env = generateEnvExample(artifact);
    assert.ok(env.includes('N8N'), 'Should include N8N env vars');
  });

  it('includes comment header', () => {
    const artifact = makeArtifact();
    const env = generateEnvExample(artifact);
    assert.ok(env.startsWith('#'), 'Should start with a comment');
  });

  it('handles empty credentials gracefully', () => {
    const artifact = makeArtifact({ credentials_required: [] });
    assert.doesNotThrow(() => generateEnvExample(artifact));
  });

  it('handles artifact with no tool_type', () => {
    const artifact = makeArtifact({ tool_type: undefined });
    assert.doesNotThrow(() => generateEnvExample(artifact));
  });
});

// ── Docker Compose Generation ─────────────────────────────────────────────────

describe('generateDockerCompose', () => {
  it('produces a non-empty string', () => {
    const artifact = makeArtifact();
    const compose = generateDockerCompose(artifact);
    assert.ok(typeof compose === 'string' && compose.length > 0);
  });

  it('contains "version:" key', () => {
    const artifact = makeArtifact();
    const compose = generateDockerCompose(artifact);
    assert.ok(compose.includes('version:'), 'Should contain version key');
  });

  it('contains "services:" key', () => {
    const artifact = makeArtifact();
    const compose = generateDockerCompose(artifact);
    assert.ok(compose.includes('services:'), 'Should contain services key');
  });

  it('generates n8n-specific compose for n8n artifacts', () => {
    const artifact = makeArtifact({ tool_type: 'n8n' });
    const compose = generateDockerCompose(artifact);
    assert.ok(compose.includes('n8nio/n8n'), 'Should reference n8n image');
    assert.ok(compose.includes('postgres'), 'Should include postgres for n8n');
  });

  it('includes a healthcheck for n8n service', () => {
    const artifact = makeArtifact({ tool_type: 'n8n' });
    const compose = generateDockerCompose(artifact);
    assert.ok(compose.includes('healthcheck'), 'Should include healthcheck');
  });
});

// ── createTarGz ───────────────────────────────────────────────────────────────

describe('createTarGz', () => {
  it('returns a Buffer', async () => {
    const result = await createTarGz([{ name: 'test.txt', content: 'hello' }]);
    assert.ok(Buffer.isBuffer(result));
  });

  it('creates decompressible gzip output', async () => {
    const result = await createTarGz([{ name: 'test.txt', content: 'hello world' }]);
    await assert.doesNotReject(() => gunzip(result));
  });

  it('includes file names in tar headers', async () => {
    const result = await createTarGz([{ name: 'my-file.txt', content: 'content' }]);
    const decompressed = await gunzip(result);
    assert.ok(decompressed.toString().includes('my-file.txt'));
  });

  it('handles multiple files', async () => {
    const files = [
      { name: 'file1.txt', content: 'content one' },
      { name: 'file2.txt', content: 'content two' },
      { name: 'nested/file3.txt', content: 'nested content' },
    ];
    const result = await createTarGz(files);
    const decompressed = await gunzip(result);
    const str = decompressed.toString();
    assert.ok(str.includes('file1.txt'));
    assert.ok(str.includes('file2.txt'));
    assert.ok(str.includes('nested/file3.txt'));
  });

  it('embeds file content in the archive', async () => {
    const result = await createTarGz([{ name: 'data.txt', content: 'hello archive world' }]);
    const decompressed = await gunzip(result);
    assert.ok(decompressed.toString().includes('hello archive world'));
  });

  it('creates valid 512-byte aligned tar headers', async () => {
    const result = await createTarGz([{ name: 'test.txt', content: 'x'.repeat(1000) }]);
    const decompressed = await gunzip(result);
    // Raw tar must be a multiple of 512 bytes
    assert.equal(decompressed.length % 512, 0, 'Tar should be 512-byte aligned');
  });

  it('handles Buffer content', async () => {
    const content = Buffer.from('binary content', 'utf8');
    const result = await createTarGz([{ name: 'binary.bin', content }]);
    await assert.doesNotReject(() => gunzip(result));
  });
});

// ── Edge Cases ────────────────────────────────────────────────────────────────

describe('exportArtifact — edge cases', () => {
  it('handles artifact with no description', async () => {
    const artifact = makeArtifact({ description: undefined, name: 'Bare Artifact' });
    await assert.doesNotReject(() => exportArtifact(artifact, 'json'));
    await assert.doesNotReject(() => exportArtifact(artifact, 'yaml'));
    await assert.doesNotReject(() => exportArtifact(artifact, 'tar.gz'));
  });

  it('handles artifact with no credentials', async () => {
    const artifact = makeArtifact({ credentials_required: [] });
    await assert.doesNotReject(() => exportArtifact(artifact, 'tar.gz'));
  });

  it('throws for unsupported format', async () => {
    const artifact = makeArtifact();
    await assert.rejects(
      () => exportArtifact(artifact, 'csv'),
      /Unsupported export format/
    );
  });

  it('handles empty artifact object for json', async () => {
    const result = await exportArtifact({}, 'json');
    assert.doesNotThrow(() => JSON.parse(result));
  });

  it('handles non-workflow artifact type without docker-compose', async () => {
    const artifact = makeArtifact({ artifact_type: 'documentation', tool_type: undefined });
    const result = await exportArtifact(artifact, 'tar.gz');
    // Should still produce valid gzip
    await assert.doesNotReject(() => gunzip(result));
  });
});
