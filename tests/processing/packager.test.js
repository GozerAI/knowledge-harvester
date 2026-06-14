// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Reimplemented pure logic from packager.js for testing ──

function isStdlib(pkg) {
  const stdlib = new Set([
    'os', 'sys', 'json', 'time', 'datetime', 'logging', 'typing', 'pathlib',
    'collections', 'itertools', 'functools', 'math', 'random', 'string',
    'hashlib', 'uuid', 'abc', 'dataclasses', 'enum', 'io', 're',
    'subprocess', 'threading', 'multiprocessing', 'asyncio', 'concurrent',
    'copy', 'pprint', 'textwrap', 'struct', 'csv', 'configparser',
    'argparse', 'shutil', 'tempfile', 'glob', 'fnmatch', 'traceback',
    'unittest', 'contextlib', 'warnings', 'signal', 'socket', 'http',
    'urllib', 'email', 'html', 'xml', 'base64', 'pickle', 'shelve',
    'sqlite3', 'gzip', 'zipfile', 'tarfile', 'zlib',
  ]);
  return stdlib.has(pkg);
}

function extractPythonImports(code) {
  const packages = new Set();
  if (!code || typeof code !== 'string') return packages;
  const fromImports = code.match(/^from\s+(\w+)/gm) || [];
  for (const m of fromImports) {
    const pkg = m.match(/from\s+(\w+)/)?.[1];
    if (pkg && !isStdlib(pkg)) packages.add(pkg);
  }
  const directImports = code.match(/^import\s+(\w+)/gm) || [];
  for (const m of directImports) {
    const pkg = m.match(/import\s+(\w+)/)?.[1];
    if (pkg && !isStdlib(pkg)) packages.add(pkg);
  }
  return packages;
}

function guessCredentialType(name) {
  const lower = name.toLowerCase();
  if (lower.includes('oauth')) return 'oauth2';
  if (lower.includes('api') || lower.includes('key')) return 'api_key';
  if (lower.includes('basic') || lower.includes('password')) return 'basic_auth';
  if (lower.includes('token')) return 'bearer_token';
  return 'api_key';
}

function estimateSetupTime(bundle) {
  let minutes = 5;
  const pkg = bundle.package || {};
  const deps = pkg.dependencies || [];
  const creds = pkg.credentials || [];
  const services = pkg.services || [];
  minutes += Math.min(deps.length * 2, 20);
  minutes += creds.length * 5;
  minutes += services.length * 3;
  return Math.min(minutes, 120);
}

function getMinimumRequirements(toolType) {
  const reqs = {
    n8n: { tool_version: 'n8n >=1.0', runtime: 'Node.js >=18' },
    comfyui: { tool_version: 'ComfyUI latest', runtime: 'Python >=3.10' },
    airflow: { tool_version: 'Apache Airflow >=2.0', runtime: 'Python >=3.8' },
    luigi: { tool_version: 'Luigi >=3.0', runtime: 'Python >=3.8' },
    argo: { tool_version: 'Argo Workflows >=3.0', runtime: 'Kubernetes >=1.25' },
  };
  return reqs[toolType] || { tool_version: 'unknown', runtime: 'unknown' };
}


describe('extractPythonImports', () => {
  it('extracts from-imports', () => {
    const imports = extractPythonImports('from pandas import DataFrame\nfrom numpy import array');
    assert.ok(imports.has('pandas'));
    assert.ok(imports.has('numpy'));
  });

  it('extracts direct imports', () => {
    const imports = extractPythonImports('import requests\nimport boto3');
    assert.ok(imports.has('requests'));
    assert.ok(imports.has('boto3'));
  });

  it('excludes stdlib modules', () => {
    const imports = extractPythonImports('import os\nimport json\nimport pandas');
    assert.ok(!imports.has('os'));
    assert.ok(!imports.has('json'));
    assert.ok(imports.has('pandas'));
  });

  it('handles empty/null input', () => {
    assert.equal(extractPythonImports('').size, 0);
    assert.equal(extractPythonImports(null).size, 0);
  });

  it('handles mixed imports', () => {
    const code = `import os
from temporalio import workflow
import asyncio
from temporalio.client import Client`;
    const imports = extractPythonImports(code);
    assert.ok(imports.has('temporalio'));
    assert.ok(!imports.has('os'));
    assert.ok(!imports.has('asyncio'));
  });
});


describe('guessCredentialType', () => {
  it('detects OAuth', () => assert.equal(guessCredentialType('googleOAuth2'), 'oauth2'));
  it('detects API key', () => assert.equal(guessCredentialType('openaiApi'), 'api_key'));
  it('detects basic auth', () => assert.equal(guessCredentialType('httpBasicAuth'), 'basic_auth'));
  it('detects bearer token', () => assert.equal(guessCredentialType('slackToken'), 'bearer_token'));
  it('defaults to api_key', () => assert.equal(guessCredentialType('customCred'), 'api_key'));
});


describe('estimateSetupTime', () => {
  it('returns base time for empty package', () => {
    assert.equal(estimateSetupTime({ package: {} }), 5);
  });

  it('adds time for dependencies', () => {
    const time = estimateSetupTime({
      package: { dependencies: ['a', 'b', 'c'], credentials: [], services: [] }
    });
    assert.equal(time, 5 + 6); // 5 base + 3*2
  });

  it('adds time for credentials', () => {
    const time = estimateSetupTime({
      package: {
        dependencies: [],
        credentials: [{ name: 'a' }, { name: 'b' }],
        services: [],
      }
    });
    assert.equal(time, 5 + 10); // 5 base + 2*5
  });

  it('adds time for services', () => {
    const time = estimateSetupTime({
      package: {
        dependencies: [],
        credentials: [],
        services: [{ name: 'PostgreSQL' }],
      }
    });
    assert.equal(time, 5 + 3); // 5 base + 1*3
  });

  it('caps at 120 minutes', () => {
    const time = estimateSetupTime({
      package: {
        dependencies: Array(50).fill('pkg'),
        credentials: Array(20).fill({ name: 'c' }),
        services: Array(10).fill({ name: 's' }),
      }
    });
    assert.equal(time, 120);
  });
});


describe('getMinimumRequirements', () => {
  it('returns n8n requirements', () => {
    const reqs = getMinimumRequirements('n8n');
    assert.ok(reqs.runtime.includes('Node.js'));
  });

  it('returns Python for airflow', () => {
    const reqs = getMinimumRequirements('airflow');
    assert.ok(reqs.runtime.includes('Python'));
  });

  it('returns Kubernetes for argo', () => {
    const reqs = getMinimumRequirements('argo');
    assert.ok(reqs.runtime.includes('Kubernetes'));
  });

  it('returns unknown for unrecognized tool', () => {
    const reqs = getMinimumRequirements('mystery-tool');
    assert.equal(reqs.runtime, 'unknown');
  });
});


describe('isStdlib', () => {
  it('identifies os as stdlib', () => assert.ok(isStdlib('os')));
  it('identifies json as stdlib', () => assert.ok(isStdlib('json')));
  it('identifies asyncio as stdlib', () => assert.ok(isStdlib('asyncio')));
  it('rejects pandas as non-stdlib', () => assert.ok(!isStdlib('pandas')));
  it('rejects requests as non-stdlib', () => assert.ok(!isStdlib('requests')));
});
