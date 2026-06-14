// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateDeployManifest,
  generateDockerComposeManifest,
  generateK8sManifest,
  generateGitHubActionsManifest,
} from '../../src/export/deploy-generator.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeWorkflow(toolType = 'n8n', overrides = {}) {
  return {
    artifact_type: 'workflow',
    name: 'Test Workflow',
    description: 'A test workflow',
    tool_type: toolType,
    language: null,
    tags: [toolType],
    type_metadata: {
      node_count: 5,
    },
    tool_metadata: {},
    ...overrides,
  };
}

function makeCodePattern(language = 'python', overrides = {}) {
  return {
    artifact_type: 'code_pattern',
    name: 'Test Code Pattern',
    description: 'A code pattern',
    tool_type: null,
    language,
    tags: [language],
    type_metadata: { language },
    tool_metadata: {},
    ...overrides,
  };
}

function makeInfraConfig(configType = 'terraform', overrides = {}) {
  return {
    artifact_type: 'infra_config',
    name: 'Test Infra',
    description: 'Infrastructure configuration',
    tool_type: configType,
    language: null,
    tags: [configType],
    type_metadata: { config_type: configType },
    tool_metadata: {},
    ...overrides,
  };
}

// ── Docker Compose Manifest ───────────────────────────────────────────────────

describe('generateDockerComposeManifest', () => {
  it('returns a non-empty string', () => {
    const result = generateDockerComposeManifest(makeWorkflow('n8n'));
    assert.ok(typeof result === 'string' && result.length > 0);
  });

  it('contains "version:" key', () => {
    const result = generateDockerComposeManifest(makeWorkflow('n8n'));
    assert.ok(result.includes('version:'));
  });

  it('contains "services:" key', () => {
    const result = generateDockerComposeManifest(makeWorkflow('n8n'));
    assert.ok(result.includes('services:'));
  });

  it('contains "volumes:" key', () => {
    const result = generateDockerComposeManifest(makeWorkflow('n8n'));
    assert.ok(result.includes('volumes:'));
  });

  it('includes healthcheck for service', () => {
    const result = generateDockerComposeManifest(makeWorkflow('n8n'));
    assert.ok(result.includes('healthcheck'));
  });

  it('uses correct n8n image', () => {
    const result = generateDockerComposeManifest(makeWorkflow('n8n'));
    assert.ok(result.includes('n8nio/n8n'));
  });

  it('uses correct mlflow image', () => {
    const result = generateDockerComposeManifest(makeWorkflow('mlflow'));
    assert.ok(result.includes('mlflow'));
  });

  it('includes database for n8n', () => {
    const result = generateDockerComposeManifest(makeWorkflow('n8n'));
    assert.ok(result.includes('postgres'));
  });

  it('includes environment variables from type_metadata', () => {
    const artifact = makeWorkflow('n8n', {
      type_metadata: {
        env_vars: [{ name: 'MY_CUSTOM_VAR', value: 'custom_value' }],
      },
    });
    const result = generateDockerComposeManifest(artifact);
    assert.ok(result.includes('MY_CUSTOM_VAR'));
  });

  it('includes networks section', () => {
    const result = generateDockerComposeManifest(makeWorkflow('n8n'));
    assert.ok(result.includes('networks:') || result.includes('_network'));
  });

  it('exposes port configuration', () => {
    const result = generateDockerComposeManifest(makeWorkflow('n8n'));
    assert.ok(result.includes('5678') || result.includes('ports:'));
  });

  it('generates valid YAML-like structure (no tabs)', () => {
    const result = generateDockerComposeManifest(makeWorkflow('n8n'));
    assert.ok(!result.includes('\t'), 'YAML should not contain tabs');
  });

  it('generates for code_pattern artifacts', () => {
    const result = generateDockerComposeManifest(makeCodePattern('python'));
    assert.ok(result.includes('services:'));
    assert.ok(result.includes('image:'));
  });

  it('generates for infra_config artifacts', () => {
    const result = generateDockerComposeManifest(makeInfraConfig('terraform'));
    assert.ok(result.includes('services:'));
  });
});

// ── Kubernetes Manifest ───────────────────────────────────────────────────────

describe('generateK8sManifest', () => {
  it('returns a non-empty string', () => {
    const result = generateK8sManifest(makeWorkflow('n8n'));
    assert.ok(typeof result === 'string' && result.length > 0);
  });

  it('contains Deployment kind', () => {
    const result = generateK8sManifest(makeWorkflow('n8n'));
    assert.ok(result.includes('kind: Deployment'));
  });

  it('contains Service kind', () => {
    const result = generateK8sManifest(makeWorkflow('n8n'));
    assert.ok(result.includes('kind: Service'));
  });

  it('has correct apiVersion for Deployment', () => {
    const result = generateK8sManifest(makeWorkflow('n8n'));
    assert.ok(result.includes('apiVersion: apps/v1'));
  });

  it('has correct apiVersion for Service', () => {
    const result = generateK8sManifest(makeWorkflow('n8n'));
    assert.ok(result.includes('apiVersion: v1'));
  });

  it('has matching labels on Deployment and selector', () => {
    const result = generateK8sManifest(makeWorkflow('n8n'));
    // The app label should appear in both metadata.labels and selector.matchLabels
    const appMatches = (result.match(/app: test-workflow/g) || []).length;
    assert.ok(appMatches >= 2, 'App label should appear in multiple places');
  });

  it('specifies container image', () => {
    const result = generateK8sManifest(makeWorkflow('n8n'));
    assert.ok(result.includes('image:'));
  });

  it('specifies container port', () => {
    const result = generateK8sManifest(makeWorkflow('n8n'));
    assert.ok(result.includes('containerPort:') || result.includes('5678'));
  });

  it('includes resource requests and limits', () => {
    const result = generateK8sManifest(makeWorkflow('n8n'));
    assert.ok(result.includes('resources:'));
    assert.ok(result.includes('requests:'));
    assert.ok(result.includes('limits:'));
  });

  it('includes liveness and readiness probes', () => {
    const result = generateK8sManifest(makeWorkflow('n8n'));
    assert.ok(result.includes('livenessProbe'));
    assert.ok(result.includes('readinessProbe'));
  });

  it('includes environment variables from type_metadata', () => {
    const artifact = makeWorkflow('n8n', {
      type_metadata: {
        env_vars: [{ name: 'MY_K8S_VAR', value: 'k8s_value' }],
      },
    });
    const result = generateK8sManifest(artifact);
    assert.ok(result.includes('MY_K8S_VAR'));
  });

  it('uses --- document separator between Deployment and Service', () => {
    const result = generateK8sManifest(makeWorkflow('n8n'));
    assert.ok(result.includes('---'), 'Should use --- to separate documents');
  });

  it('generates for airflow workflow', () => {
    const result = generateK8sManifest(makeWorkflow('airflow'));
    assert.ok(result.includes('kind: Deployment'));
    assert.ok(result.includes('8080') || result.includes('containerPort'));
  });

  it('generates for code_pattern artifacts', () => {
    const result = generateK8sManifest(makeCodePattern('python'));
    assert.ok(result.includes('kind: Deployment'));
    assert.ok(result.includes('kind: Service'));
  });

  it('generates for infra_config artifacts', () => {
    const result = generateK8sManifest(makeInfraConfig('terraform'));
    assert.ok(result.includes('kind: Deployment'));
  });

  it('respects replicas from type_metadata', () => {
    const artifact = makeWorkflow('n8n', { type_metadata: { replicas: 3 } });
    const result = generateK8sManifest(artifact);
    assert.ok(result.includes('replicas: 3'));
  });
});

// ── GitHub Actions Manifest ───────────────────────────────────────────────────

describe('generateGitHubActionsManifest', () => {
  it('returns a non-empty string', () => {
    const result = generateGitHubActionsManifest(makeWorkflow('n8n'));
    assert.ok(typeof result === 'string' && result.length > 0);
  });

  it('has "on:" trigger section', () => {
    const result = generateGitHubActionsManifest(makeWorkflow('n8n'));
    assert.ok(result.includes('on:'));
  });

  it('triggers on push to main', () => {
    const result = generateGitHubActionsManifest(makeWorkflow('n8n'));
    assert.ok(result.includes('push') && result.includes('main'));
  });

  it('triggers on pull_request', () => {
    const result = generateGitHubActionsManifest(makeWorkflow('n8n'));
    assert.ok(result.includes('pull_request'));
  });

  it('has "jobs:" section', () => {
    const result = generateGitHubActionsManifest(makeWorkflow('n8n'));
    assert.ok(result.includes('jobs:'));
  });

  it('has "steps:" section', () => {
    const result = generateGitHubActionsManifest(makeWorkflow('n8n'));
    assert.ok(result.includes('steps:'));
  });

  it('has checkout step', () => {
    const result = generateGitHubActionsManifest(makeWorkflow('n8n'));
    assert.ok(result.includes('actions/checkout'));
  });

  it('has setup step for python artifacts', () => {
    const result = generateGitHubActionsManifest(makeCodePattern('python'));
    assert.ok(result.includes('setup-python') || result.includes('python'));
  });

  it('has setup step for node artifacts', () => {
    const result = generateGitHubActionsManifest(makeCodePattern('javascript'));
    assert.ok(result.includes('setup-node') || result.includes('node'));
  });

  it('has setup step for terraform infra', () => {
    const result = generateGitHubActionsManifest(makeInfraConfig('terraform'));
    assert.ok(result.includes('terraform') || result.includes('hashicorp'));
  });

  it('has build step', () => {
    const result = generateGitHubActionsManifest(makeWorkflow('n8n'));
    const lower = result.toLowerCase();
    assert.ok(lower.includes('build') || lower.includes('test') || lower.includes('validate'));
  });

  it('has deploy step', () => {
    const result = generateGitHubActionsManifest(makeWorkflow('n8n'));
    const lower = result.toLowerCase();
    assert.ok(lower.includes('deploy') || lower.includes('push') || lower.includes('apply'));
  });

  it('uses ubuntu-latest runner', () => {
    const result = generateGitHubActionsManifest(makeWorkflow('n8n'));
    assert.ok(result.includes('ubuntu-latest'));
  });

  it('generates for helm infra', () => {
    const artifact = makeInfraConfig('helm', { type_metadata: { config_type: 'helm' } });
    const result = generateGitHubActionsManifest(artifact);
    assert.ok(result.includes('helm') || result.includes('kubectl'));
  });

  it('generates for airflow workflow', () => {
    const result = generateGitHubActionsManifest(makeWorkflow('airflow'));
    assert.ok(result.includes('jobs:'));
  });

  it('includes concurrency group to cancel in-progress runs', () => {
    const result = generateGitHubActionsManifest(makeWorkflow('n8n'));
    assert.ok(result.includes('concurrency'));
  });
});

// ── generateDeployManifest — dispatch ─────────────────────────────────────────

describe('generateDeployManifest', () => {
  it('dispatches to docker-compose generator', () => {
    const result = generateDeployManifest(makeWorkflow('n8n'), 'docker-compose');
    assert.ok(result.includes('services:'));
  });

  it('dispatches to k8s generator', () => {
    const result = generateDeployManifest(makeWorkflow('n8n'), 'k8s');
    assert.ok(result.includes('kind: Deployment'));
  });

  it('dispatches to github-actions generator', () => {
    const result = generateDeployManifest(makeWorkflow('n8n'), 'github-actions');
    assert.ok(result.includes('on:'));
  });

  it('throws a helpful error for unknown target', () => {
    assert.throws(
      () => generateDeployManifest(makeWorkflow('n8n'), 'invalid-target'),
      /Unsupported deployment target/
    );
  });

  it('error message lists supported targets', () => {
    try {
      generateDeployManifest(makeWorkflow('n8n'), 'ecs');
    } catch (err) {
      assert.ok(
        err.message.includes('docker-compose') ||
        err.message.includes('k8s') ||
        err.message.includes('github-actions'),
        'Error should list supported targets'
      );
    }
  });
});

// ── Port and Image Derivation ─────────────────────────────────────────────────

describe('port configuration', () => {
  it('uses 5678 for n8n', () => {
    const result = generateK8sManifest(makeWorkflow('n8n'));
    assert.ok(result.includes('5678'));
  });

  it('uses 8080 for airflow', () => {
    const result = generateK8sManifest(makeWorkflow('airflow'));
    assert.ok(result.includes('8080'));
  });

  it('uses explicit port from type_metadata', () => {
    const artifact = makeWorkflow('n8n', { type_metadata: { port: 9090 } });
    const result = generateK8sManifest(artifact);
    assert.ok(result.includes('9090'));
  });
});

// ── No type_metadata edge case ────────────────────────────────────────────────

describe('edge cases — no type_metadata', () => {
  it('docker-compose handles missing type_metadata', () => {
    const artifact = makeWorkflow('n8n', { type_metadata: undefined });
    assert.doesNotThrow(() => generateDockerComposeManifest(artifact));
    const result = generateDockerComposeManifest(artifact);
    assert.ok(result.includes('services:'));
  });

  it('k8s handles missing type_metadata', () => {
    const artifact = makeWorkflow('n8n', { type_metadata: undefined });
    assert.doesNotThrow(() => generateK8sManifest(artifact));
    const result = generateK8sManifest(artifact);
    assert.ok(result.includes('kind: Deployment'));
  });

  it('github-actions handles missing type_metadata', () => {
    const artifact = makeWorkflow('n8n', { type_metadata: undefined });
    assert.doesNotThrow(() => generateGitHubActionsManifest(artifact));
    const result = generateGitHubActionsManifest(artifact);
    assert.ok(result.includes('on:'));
  });

  it('all targets handle empty artifact', () => {
    const artifact = {};
    assert.doesNotThrow(() => generateDockerComposeManifest(artifact));
    assert.doesNotThrow(() => generateK8sManifest(artifact));
    assert.doesNotThrow(() => generateGitHubActionsManifest(artifact));
  });
});
