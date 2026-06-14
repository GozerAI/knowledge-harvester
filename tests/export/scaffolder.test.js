// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  scaffoldProject,
  detectProjectType,
} from '../../src/export/scaffolder.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeWorkflow(overrides = {}) {
  return {
    artifact_type: 'workflow',
    name: 'My Workflow',
    description: 'A test workflow',
    tool_type: 'n8n',
    tags: ['automation'],
    type_metadata: {},
    content: {},
    ...overrides,
  };
}

function makeCodePattern(language, overrides = {}) {
  return {
    artifact_type: 'code_pattern',
    name: 'My Code Pattern',
    description: 'A code pattern artifact',
    language,
    tool_type: null,
    tags: [language],
    type_metadata: { language },
    content: { source_code: `# ${language} code here\n` },
    ...overrides,
  };
}

function makeInfraConfig(configType, overrides = {}) {
  return {
    artifact_type: 'infra_config',
    name: 'My Infra Config',
    description: 'Infrastructure configuration',
    tool_type: configType,
    language: null,
    tags: [configType],
    type_metadata: { config_type: configType },
    content: {},
    ...overrides,
  };
}

function makeAiMlAsset(framework = 'pytorch', overrides = {}) {
  return {
    artifact_type: 'ai_ml_asset',
    name: 'My ML Model',
    description: 'An ML model asset',
    language: 'python',
    tool_type: null,
    tags: ['ml', framework],
    type_metadata: { framework },
    content: {},
    ...overrides,
  };
}

// ── detectProjectType ─────────────────────────────────────────────────────────

describe('detectProjectType', () => {
  it('detects n8n workflow', () => {
    const artifact = makeWorkflow({ tool_type: 'n8n' });
    const { scaffoldType } = detectProjectType(artifact);
    assert.equal(scaffoldType, 'workflow-n8n');
  });

  it('detects python code pattern', () => {
    const artifact = makeCodePattern('python');
    const { scaffoldType, runtime } = detectProjectType(artifact);
    assert.equal(scaffoldType, 'code-python');
    assert.equal(runtime, 'python');
  });

  it('detects typescript code pattern', () => {
    const artifact = makeCodePattern('typescript');
    const { scaffoldType } = detectProjectType(artifact);
    assert.equal(scaffoldType, 'code-typescript');
  });

  it('detects javascript code pattern', () => {
    const artifact = makeCodePattern('javascript');
    const { scaffoldType } = detectProjectType(artifact);
    assert.equal(scaffoldType, 'code-javascript');
  });

  it('detects terraform infra config', () => {
    const artifact = makeInfraConfig('terraform');
    const { scaffoldType } = detectProjectType(artifact);
    assert.equal(scaffoldType, 'infra-terraform');
  });

  it('detects helm infra config via config_type', () => {
    const artifact = makeInfraConfig('helm');
    const { scaffoldType } = detectProjectType(artifact);
    assert.equal(scaffoldType, 'infra-helm');
  });

  it('detects k8s infra config via config_type', () => {
    const artifact = makeInfraConfig('kubernetes');
    const { scaffoldType } = detectProjectType(artifact);
    assert.equal(scaffoldType, 'infra-k8s');
  });

  it('detects k8s via tags', () => {
    const artifact = makeInfraConfig('generic', { tags: ['k8s'] });
    const { scaffoldType } = detectProjectType(artifact);
    assert.equal(scaffoldType, 'infra-k8s');
  });

  it('detects helm via tags', () => {
    const artifact = makeInfraConfig('generic', { tags: ['helm'], type_metadata: { config_type: 'helm' } });
    const { scaffoldType } = detectProjectType(artifact);
    assert.equal(scaffoldType, 'infra-helm');
  });

  it('detects ai_ml_asset', () => {
    const artifact = makeAiMlAsset('pytorch');
    const { scaffoldType, runtime } = detectProjectType(artifact);
    assert.equal(scaffoldType, 'ai-ml');
    assert.equal(runtime, 'python');
  });

  it('returns default for unknown artifact type', () => {
    const artifact = { artifact_type: 'unknown_type', name: 'Test', description: '' };
    const { scaffoldType } = detectProjectType(artifact);
    assert.equal(scaffoldType, 'default');
  });

  it('returns framework for python code pattern', () => {
    const artifact = makeCodePattern('python', { type_metadata: { language: 'python', framework: 'fastapi' } });
    const { framework } = detectProjectType(artifact);
    assert.equal(framework, 'fastapi');
  });

  it('detects airflow workflow', () => {
    const artifact = makeWorkflow({ tool_type: 'airflow' });
    const { runtime } = detectProjectType(artifact);
    assert.equal(runtime, 'python');
  });
});

// ── n8n Workflow Scaffold ─────────────────────────────────────────────────────

describe('scaffoldProject — n8n workflow', () => {
  it('returns a files array', () => {
    const { files } = scaffoldProject(makeWorkflow({ tool_type: 'n8n' }));
    assert.ok(Array.isArray(files));
  });

  it('includes docker-compose.yml', () => {
    const { files } = scaffoldProject(makeWorkflow({ tool_type: 'n8n' }));
    const paths = files.map(f => f.path);
    assert.ok(paths.includes('docker-compose.yml'), 'Should have docker-compose.yml');
  });

  it('includes .env file', () => {
    const { files } = scaffoldProject(makeWorkflow({ tool_type: 'n8n' }));
    const paths = files.map(f => f.path);
    assert.ok(paths.some(p => p === '.env' || p === '.env.example'));
  });

  it('includes README.md', () => {
    const { files } = scaffoldProject(makeWorkflow({ tool_type: 'n8n' }));
    const paths = files.map(f => f.path);
    assert.ok(paths.includes('README.md'));
  });

  it('docker-compose.yml mentions n8n image', () => {
    const { files } = scaffoldProject(makeWorkflow({ tool_type: 'n8n' }));
    const compose = files.find(f => f.path === 'docker-compose.yml');
    assert.ok(compose.content.includes('n8nio/n8n') || compose.content.includes('n8n'));
  });

  it('includes postgres in n8n docker-compose', () => {
    const { files } = scaffoldProject(makeWorkflow({ tool_type: 'n8n' }));
    const compose = files.find(f => f.path === 'docker-compose.yml');
    assert.ok(compose.content.includes('postgres'));
  });
});

// ── Python Code Pattern ───────────────────────────────────────────────────────

describe('scaffoldProject — python code pattern', () => {
  it('includes pyproject.toml', () => {
    const { files } = scaffoldProject(makeCodePattern('python'));
    const paths = files.map(f => f.path);
    assert.ok(paths.includes('pyproject.toml'));
  });

  it('includes src/__init__.py', () => {
    const { files } = scaffoldProject(makeCodePattern('python'));
    const paths = files.map(f => f.path);
    assert.ok(paths.includes('src/__init__.py'));
  });

  it('includes src/main.py', () => {
    const { files } = scaffoldProject(makeCodePattern('python'));
    const paths = files.map(f => f.path);
    assert.ok(paths.includes('src/main.py'));
  });

  it('includes tests/test_main.py', () => {
    const { files } = scaffoldProject(makeCodePattern('python'));
    const paths = files.map(f => f.path);
    assert.ok(paths.includes('tests/test_main.py'));
  });

  it('includes README.md', () => {
    const { files } = scaffoldProject(makeCodePattern('python'));
    const paths = files.map(f => f.path);
    assert.ok(paths.includes('README.md'));
  });

  it('pyproject.toml references python version', () => {
    const { files } = scaffoldProject(makeCodePattern('python'));
    const pyproject = files.find(f => f.path === 'pyproject.toml');
    assert.ok(pyproject.content.includes('python'));
  });
});

// ── JavaScript Code Pattern ───────────────────────────────────────────────────

describe('scaffoldProject — javascript code pattern', () => {
  it('includes package.json', () => {
    const { files } = scaffoldProject(makeCodePattern('javascript'));
    const paths = files.map(f => f.path);
    assert.ok(paths.includes('package.json'));
  });

  it('includes src/index.js', () => {
    const { files } = scaffoldProject(makeCodePattern('javascript'));
    const paths = files.map(f => f.path);
    assert.ok(paths.some(p => p === 'src/index.js'));
  });

  it('includes tests/index.test.js', () => {
    const { files } = scaffoldProject(makeCodePattern('javascript'));
    const paths = files.map(f => f.path);
    assert.ok(paths.some(p => p.includes('test')));
  });

  it('package.json has valid JSON content', () => {
    const { files } = scaffoldProject(makeCodePattern('javascript'));
    const pkg = files.find(f => f.path === 'package.json');
    assert.doesNotThrow(() => JSON.parse(pkg.content));
  });
});

// ── TypeScript Code Pattern ───────────────────────────────────────────────────

describe('scaffoldProject — typescript code pattern', () => {
  it('includes tsconfig.json', () => {
    const { files } = scaffoldProject(makeCodePattern('typescript'));
    const paths = files.map(f => f.path);
    assert.ok(paths.includes('tsconfig.json'));
  });

  it('includes src/index.ts', () => {
    const { files } = scaffoldProject(makeCodePattern('typescript'));
    const paths = files.map(f => f.path);
    assert.ok(paths.some(p => p === 'src/index.ts'));
  });
});

// ── Terraform Infra Config ────────────────────────────────────────────────────

describe('scaffoldProject — terraform', () => {
  it('includes main.tf', () => {
    const { files } = scaffoldProject(makeInfraConfig('terraform'));
    const paths = files.map(f => f.path);
    assert.ok(paths.includes('main.tf'));
  });

  it('includes variables.tf', () => {
    const { files } = scaffoldProject(makeInfraConfig('terraform'));
    const paths = files.map(f => f.path);
    assert.ok(paths.includes('variables.tf'));
  });

  it('includes outputs.tf', () => {
    const { files } = scaffoldProject(makeInfraConfig('terraform'));
    const paths = files.map(f => f.path);
    assert.ok(paths.includes('outputs.tf'));
  });

  it('includes terraform.tfvars.example', () => {
    const { files } = scaffoldProject(makeInfraConfig('terraform'));
    const paths = files.map(f => f.path);
    assert.ok(paths.includes('terraform.tfvars.example'));
  });

  it('includes README.md', () => {
    const { files } = scaffoldProject(makeInfraConfig('terraform'));
    const paths = files.map(f => f.path);
    assert.ok(paths.includes('README.md'));
  });

  it('main.tf contains terraform block', () => {
    const { files } = scaffoldProject(makeInfraConfig('terraform'));
    const main = files.find(f => f.path === 'main.tf');
    assert.ok(main.content.includes('terraform'));
  });
});

// ── Helm Infra Config ─────────────────────────────────────────────────────────

describe('scaffoldProject — helm', () => {
  it('includes Chart.yaml', () => {
    const { files } = scaffoldProject(makeInfraConfig('helm'));
    const paths = files.map(f => f.path);
    assert.ok(paths.includes('Chart.yaml'));
  });

  it('includes values.yaml', () => {
    const { files } = scaffoldProject(makeInfraConfig('helm'));
    const paths = files.map(f => f.path);
    assert.ok(paths.includes('values.yaml'));
  });

  it('includes templates/ directory files', () => {
    const { files } = scaffoldProject(makeInfraConfig('helm'));
    const paths = files.map(f => f.path);
    assert.ok(paths.some(p => p.startsWith('templates/')));
  });

  it('Chart.yaml has apiVersion', () => {
    const { files } = scaffoldProject(makeInfraConfig('helm'));
    const chart = files.find(f => f.path === 'Chart.yaml');
    assert.ok(chart.content.includes('apiVersion'));
  });

  it('values.yaml has replicaCount', () => {
    const { files } = scaffoldProject(makeInfraConfig('helm'));
    const values = files.find(f => f.path === 'values.yaml');
    assert.ok(values.content.includes('replicaCount'));
  });
});

// ── Kubernetes Infra Config ───────────────────────────────────────────────────

describe('scaffoldProject — kubernetes/kustomize', () => {
  it('includes kustomization.yaml', () => {
    const { files } = scaffoldProject(makeInfraConfig('kubernetes'));
    const paths = files.map(f => f.path);
    assert.ok(paths.includes('kustomization.yaml'));
  });

  it('includes base/ directory files', () => {
    const { files } = scaffoldProject(makeInfraConfig('kubernetes'));
    const paths = files.map(f => f.path);
    assert.ok(paths.some(p => p.startsWith('base/')));
  });

  it('kustomization.yaml has resources section', () => {
    const { files } = scaffoldProject(makeInfraConfig('kubernetes'));
    const kustomize = files.find(f => f.path === 'kustomization.yaml');
    assert.ok(kustomize.content.includes('resources'));
  });
});

// ── AI/ML Asset ───────────────────────────────────────────────────────────────

describe('scaffoldProject — ai_ml_asset', () => {
  it('includes requirements.txt', () => {
    const { files } = scaffoldProject(makeAiMlAsset());
    const paths = files.map(f => f.path);
    assert.ok(paths.includes('requirements.txt'));
  });

  it('includes src/model.py', () => {
    const { files } = scaffoldProject(makeAiMlAsset());
    const paths = files.map(f => f.path);
    assert.ok(paths.includes('src/model.py'));
  });

  it('includes notebook file', () => {
    const { files } = scaffoldProject(makeAiMlAsset());
    const paths = files.map(f => f.path);
    assert.ok(paths.some(p => p.includes('notebooks/')));
  });

  it('includes README.md', () => {
    const { files } = scaffoldProject(makeAiMlAsset());
    const paths = files.map(f => f.path);
    assert.ok(paths.includes('README.md'));
  });

  it('notebook file has valid JSON structure', () => {
    const { files } = scaffoldProject(makeAiMlAsset());
    const notebook = files.find(f => f.path.endsWith('.ipynb'));
    assert.ok(notebook, 'Should have a notebook file');
    const parsed = JSON.parse(notebook.content);
    assert.ok(parsed.cells, 'Notebook should have cells');
    assert.ok(parsed.nbformat >= 4, 'Notebook should be format 4+');
  });
});

// ── Default Fallback ──────────────────────────────────────────────────────────

describe('scaffoldProject — default fallback', () => {
  it('includes README.md for unknown type', () => {
    const artifact = { artifact_type: 'unknown', name: 'Mystery', description: 'Unknown type' };
    const { files } = scaffoldProject(artifact);
    const paths = files.map(f => f.path);
    assert.ok(paths.includes('README.md'));
  });

  it('includes artifact.json for default fallback', () => {
    const artifact = { artifact_type: 'unknown', name: 'Mystery', description: 'Unknown type' };
    const { files } = scaffoldProject(artifact);
    const paths = files.map(f => f.path);
    assert.ok(paths.includes('artifact.json'));
  });

  it('artifact.json contains valid JSON', () => {
    const artifact = { artifact_type: 'unknown', name: 'Test', tags: ['x'] };
    const { files } = scaffoldProject(artifact);
    const artifactFile = files.find(f => f.path === 'artifact.json');
    assert.doesNotThrow(() => JSON.parse(artifactFile.content));
  });
});

// ── File Path Validation ──────────────────────────────────────────────────────

describe('scaffoldProject — file path validation', () => {
  const allScaffoldTypes = [
    makeWorkflow({ tool_type: 'n8n' }),
    makeCodePattern('python'),
    makeCodePattern('javascript'),
    makeCodePattern('typescript'),
    makeInfraConfig('terraform'),
    makeInfraConfig('helm'),
    makeInfraConfig('kubernetes'),
    makeAiMlAsset(),
  ];

  for (const artifact of allScaffoldTypes) {
    it(`files for ${artifact.artifact_type}/${artifact.tool_type || artifact.language || 'default'} have no absolute paths`, () => {
      const { files } = scaffoldProject(artifact);
      for (const file of files) {
        assert.ok(!file.path.startsWith('/'), `File path should not be absolute: ${file.path}`);
        assert.ok(!file.path.match(/^[A-Z]:\\/), `File path should not be Windows absolute: ${file.path}`);
      }
    });

    it(`files for ${artifact.artifact_type}/${artifact.tool_type || artifact.language || 'default'} have non-empty content`, () => {
      const { files } = scaffoldProject(artifact);
      for (const file of files) {
        // Allow empty __init__.py
        if (file.path.endsWith('__init__.py') && file.content === '') continue;
        assert.ok(
          typeof file.content === 'string' && file.content.length > 0,
          `File ${file.path} should have non-empty content`
        );
      }
    });
  }
});

// ── Edge Cases ────────────────────────────────────────────────────────────────

describe('scaffoldProject — edge cases', () => {
  it('handles minimal artifact with only artifact_type', () => {
    const artifact = { artifact_type: 'workflow' };
    assert.doesNotThrow(() => scaffoldProject(artifact));
  });

  it('handles artifact with missing type_metadata', () => {
    const artifact = makeCodePattern('python', { type_metadata: undefined });
    assert.doesNotThrow(() => scaffoldProject(artifact));
  });

  it('handles artifact with missing content', () => {
    const artifact = makeCodePattern('python', { content: undefined });
    assert.doesNotThrow(() => scaffoldProject(artifact));
    const { files } = scaffoldProject(artifact);
    assert.ok(files.length > 0);
  });

  it('returns files with path and content properties', () => {
    const { files } = scaffoldProject(makeWorkflow());
    for (const file of files) {
      assert.ok('path' in file, `File should have path property`);
      assert.ok('content' in file, `File should have content property`);
    }
  });
});
