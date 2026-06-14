// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Reimplemented pure logic from infra-config/normalizer.js ──

function extractTerraformComponents(content) {
  const providers = [...new Set(
    (content.match(/provider\s+"([^"]+)"/g) || []).map(m => m.match(/"([^"]+)"/)?.[1]).filter(Boolean)
  )];
  const resources = [...new Set(
    (content.match(/resource\s+"([^"]+)"/g) || []).map(m => m.match(/"([^"]+)"/)?.[1]).filter(Boolean)
  )];
  const variables = [...new Set(
    (content.match(/variable\s+"([^"]+)"/g) || []).map(m => m.match(/"([^"]+)"/)?.[1]).filter(Boolean)
  )];
  const outputs = [...new Set(
    (content.match(/output\s+"([^"]+)"/g) || []).map(m => m.match(/"([^"]+)"/)?.[1]).filter(Boolean)
  )];
  const modules = [...new Set(
    (content.match(/module\s+"([^"]+)"/g) || []).map(m => m.match(/"([^"]+)"/)?.[1]).filter(Boolean)
  )];
  const dataBlocks = [...new Set(
    (content.match(/data\s+"([^"]+)"/g) || []).map(m => m.match(/"([^"]+)"/)?.[1]).filter(Boolean)
  )];
  return { providers, resources, variables, outputs, modules, dataBlocks };
}

function extractHelmComponents(content, filename) {
  const name = (filename || '').toLowerCase();
  const isChart = name === 'chart.yaml' || name === 'chart.yml';
  let chartName = null, chartVersion = null, appVersion = null;
  const dependencies = [], templateKinds = [], valuesKeys = [];

  if (isChart) {
    chartName = content.match(/^name:\s*(.+)/m)?.[1]?.trim() || null;
    chartVersion = content.match(/^version:\s*(.+)/m)?.[1]?.trim() || null;
    appVersion = content.match(/^appVersion:\s*(.+)/m)?.[1]?.trim() || null;
    const depMatches = content.match(/^\s+-\s+name:\s*(.+)/gm) || [];
    for (const m of depMatches) {
      const dep = m.match(/name:\s*(.+)/)?.[1]?.trim();
      if (dep) dependencies.push(dep);
    }
  } else {
    const kinds = content.match(/^kind:\s*(\w+)/gm) || [];
    for (const k of kinds) {
      const kind = k.match(/kind:\s*(\w+)/)?.[1];
      if (kind) templateKinds.push(kind);
    }
    const topKeys = content.match(/^(\w+):/gm) || [];
    for (const k of topKeys) valuesKeys.push(k.replace(':', ''));
  }
  return { chartName, chartVersion, appVersion, dependencies, templateKinds, valuesKeys };
}

function extractDockerComposeComponents(content) {
  const services = [], images = [], volumes = [], networks = [];
  let inServices = false;
  for (const line of content.split('\n')) {
    if (/^services:/m.test(line)) { inServices = true; continue; }
    if (inServices && /^\s{2}\w/.test(line) && !line.trim().startsWith('#')) {
      const svc = line.trim().replace(':', '');
      if (svc) services.push(svc);
    }
    if (inServices && /^\w/.test(line) && !line.startsWith(' ')) inServices = false;
  }
  const imageMatches = content.match(/image:\s*(.+)/g) || [];
  for (const m of imageMatches) {
    const img = m.replace(/image:\s*/, '').trim().replace(/["']/g, '');
    if (img) images.push(img);
  }
  const hasBuild = /\bbuild:/m.test(content);
  const hasHealthcheck = /\bhealthcheck:/m.test(content);
  return { services, images, volumes, networks, hasBuild, hasHealthcheck };
}

function extractK8sComponents(content) {
  const apiVersion = content.match(/apiVersion:\s*(.+)/)?.[1]?.trim() || '';
  const kind = content.match(/kind:\s*(\w+)/)?.[1] || '';
  const namespace = content.match(/namespace:\s*(\S+)/)?.[1] || 'default';
  const containers = [];
  const imageMatches = content.match(/image:\s*(.+)/g) || [];
  for (const m of imageMatches) {
    const img = m.replace(/image:\s*/, '').trim().replace(/["']/g, '');
    if (img) containers.push(img);
  }
  const hasResources = /\bresources:/m.test(content) &&
    (/\blimits:/m.test(content) || /\brequests:/m.test(content));
  const hasProbes = /\blivenessProbe:/m.test(content) || /\breadinessProbe:/m.test(content);
  return { apiVersion, kind, namespace, containers, labels: {}, hasResources, hasProbes };
}

function extractAnsibleComponents(content) {
  const hosts = content.match(/hosts:\s*(.+)/)?.[1]?.trim() || 'all';
  const taskMatches = content.match(/^\s+-\s+name:/gm) || [];
  const taskCount = taskMatches.length;
  const modulesUsed = [...new Set(
    (content.match(/(ansible\.\w+\.\w+|community\.\w+\.\w+)/g) || [])
  )];
  const hasHandlers = /\bhandlers:/m.test(content);
  const hasVariables = /\bvars:/m.test(content) || /\bvars_files:/m.test(content);
  return { hosts, taskCount, modulesUsed, hasHandlers, hasVariables, roles: [], collections: [] };
}

// ── Validation functions ──

function validateTerraform(content, filename) {
  const ext = filename?.split('.').pop()?.toLowerCase();
  if (ext !== 'tf' && ext !== 'json') return false;
  return /\b(resource|variable|module|provider|data|output|terraform)\s+"/.test(content)
    || /\b(resource|variable|module|provider|data|output|terraform)\s+\{/.test(content);
}

function validateCompose(content) {
  return /^services:/m.test(content) || /^\s+services:/m.test(content);
}

function validateK8s(content, filename) {
  const ext = (filename || '').split('.').pop()?.toLowerCase();
  if (!['yaml', 'yml'].includes(ext)) return false;
  return content.includes('apiVersion:') && content.includes('kind:');
}

function validateAnsible(content) {
  const hasHosts = /^\s*-?\s*hosts:/m.test(content);
  const hasTasks = /\btasks:/m.test(content);
  const hasRoles = /\broles:/m.test(content);
  const hasModule = /ansible\.builtin|ansible\.posix|community\./m.test(content);
  return (hasHosts && (hasTasks || hasRoles)) || hasModule;
}

function validateHelm(content, filename) {
  const name = (filename || '').toLowerCase();
  if (name === 'chart.yaml' || name === 'chart.yml') {
    return content.includes('apiVersion') && content.includes('name:');
  }
  if (name === 'values.yaml' || name === 'values.yml') {
    return content.includes(':');
  }
  return content.includes('kind:') && (
    content.includes('helm.sh') || content.includes('{{ .Values') || content.includes('{{ .Release')
  );
}

// ── Tests ──

describe('Terraform Component Extraction', () => {
  it('should extract providers', () => {
    const content = `provider "aws" {\n  region = "us-east-1"\n}\nprovider "google" {}`;
    const result = extractTerraformComponents(content);
    assert.deepEqual(result.providers, ['aws', 'google']);
  });

  it('should extract resources', () => {
    const content = `resource "aws_vpc" "main" {}\nresource "aws_subnet" "pub" {}`;
    const result = extractTerraformComponents(content);
    assert.deepEqual(result.resources, ['aws_vpc', 'aws_subnet']);
  });

  it('should extract variables', () => {
    const content = `variable "region" {\n  type = string\n}\nvariable "name" {}`;
    const result = extractTerraformComponents(content);
    assert.deepEqual(result.variables, ['region', 'name']);
  });

  it('should extract outputs', () => {
    const content = `output "vpc_id" {\n  value = aws_vpc.main.id\n}`;
    const result = extractTerraformComponents(content);
    assert.deepEqual(result.outputs, ['vpc_id']);
  });

  it('should extract modules', () => {
    const content = `module "vpc" {\n  source = "terraform-aws-modules/vpc/aws"\n}`;
    const result = extractTerraformComponents(content);
    assert.deepEqual(result.modules, ['vpc']);
  });

  it('should extract data blocks', () => {
    const content = `data "aws_ami" "ubuntu" {}`;
    const result = extractTerraformComponents(content);
    assert.deepEqual(result.dataBlocks, ['aws_ami']);
  });

  it('should deduplicate resources', () => {
    const content = `resource "aws_vpc" "a" {}\nresource "aws_vpc" "b" {}`;
    const result = extractTerraformComponents(content);
    assert.deepEqual(result.resources, ['aws_vpc']);
  });

  it('should handle empty content', () => {
    const result = extractTerraformComponents('');
    assert.deepEqual(result.providers, []);
    assert.deepEqual(result.resources, []);
    assert.deepEqual(result.variables, []);
  });
});

describe('Helm Component Extraction', () => {
  it('should extract chart metadata from Chart.yaml', () => {
    const content = `apiVersion: v2\nname: my-app\nversion: 1.2.3\nappVersion: "2.0"`;
    const result = extractHelmComponents(content, 'Chart.yaml');
    assert.equal(result.chartName, 'my-app');
    assert.equal(result.chartVersion, '1.2.3');
    assert.equal(result.appVersion, '"2.0"');
  });

  it('should extract dependencies', () => {
    const content = `dependencies:\n  - name: redis\n    version: "17.0.0"\n  - name: postgresql`;
    const result = extractHelmComponents(content, 'Chart.yaml');
    assert.deepEqual(result.dependencies, ['redis', 'postgresql']);
  });

  it('should extract template kinds', () => {
    const content = `kind: Deployment\n---\nkind: Service`;
    const result = extractHelmComponents(content, 'deployment.yaml');
    assert.deepEqual(result.templateKinds, ['Deployment', 'Service']);
  });

  it('should extract values keys', () => {
    const content = `replicaCount: 1\nimage:\n  repository: nginx\nservice:\n  type: ClusterIP`;
    const result = extractHelmComponents(content, 'values.yaml');
    assert.ok(result.valuesKeys.includes('replicaCount'));
    assert.ok(result.valuesKeys.includes('image'));
    assert.ok(result.valuesKeys.includes('service'));
  });
});

describe('Docker Compose Component Extraction', () => {
  it('should extract service names', () => {
    const content = `services:\n  web:\n    image: nginx\n  db:\n    image: postgres`;
    const result = extractDockerComposeComponents(content);
    assert.deepEqual(result.services, ['web', 'db']);
  });

  it('should extract images', () => {
    const content = `services:\n  web:\n    image: nginx:latest\n  db:\n    image: postgres:16`;
    const result = extractDockerComposeComponents(content);
    assert.ok(result.images.includes('nginx:latest'));
    assert.ok(result.images.includes('postgres:16'));
  });

  it('should detect build directive', () => {
    const content = `services:\n  app:\n    build: .\n`;
    const result = extractDockerComposeComponents(content);
    assert.equal(result.hasBuild, true);
  });

  it('should detect healthcheck', () => {
    const content = `services:\n  app:\n    healthcheck:\n      test: curl -f http://localhost/`;
    const result = extractDockerComposeComponents(content);
    assert.equal(result.hasHealthcheck, true);
  });

  it('should handle no services section', () => {
    const result = extractDockerComposeComponents('version: "3"\n');
    assert.deepEqual(result.services, []);
  });
});

describe('K8s Component Extraction', () => {
  it('should extract apiVersion and kind', () => {
    const content = `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: test`;
    const result = extractK8sComponents(content);
    assert.equal(result.apiVersion, 'apps/v1');
    assert.equal(result.kind, 'Deployment');
  });

  it('should extract namespace', () => {
    const content = `apiVersion: v1\nkind: Service\nmetadata:\n  namespace: production`;
    const result = extractK8sComponents(content);
    assert.equal(result.namespace, 'production');
  });

  it('should default namespace to default', () => {
    const content = `apiVersion: v1\nkind: Pod`;
    const result = extractK8sComponents(content);
    assert.equal(result.namespace, 'default');
  });

  it('should extract container images', () => {
    const content = `spec:\n  containers:\n    - image: nginx:1.25\n    - image: redis:7`;
    const result = extractK8sComponents(content);
    assert.ok(result.containers.includes('nginx:1.25'));
    assert.ok(result.containers.includes('redis:7'));
  });

  it('should detect resource limits', () => {
    const content = `resources:\n  limits:\n    cpu: "500m"`;
    const result = extractK8sComponents(content);
    assert.equal(result.hasResources, true);
  });

  it('should detect probes', () => {
    const content = `livenessProbe:\n  httpGet:\n    path: /health`;
    const result = extractK8sComponents(content);
    assert.equal(result.hasProbes, true);
  });
});

describe('Ansible Component Extraction', () => {
  it('should extract hosts', () => {
    const content = `- hosts: webservers\n  tasks:\n    - name: Install nginx`;
    const result = extractAnsibleComponents(content);
    assert.equal(result.hosts, 'webservers');
  });

  it('should count tasks', () => {
    const content = `tasks:\n  - name: Task 1\n    apt: name=nginx\n  - name: Task 2\n    service: name=nginx`;
    const result = extractAnsibleComponents(content);
    assert.equal(result.taskCount, 2);
  });

  it('should extract FQCN modules', () => {
    const content = `- ansible.builtin.copy:\n    src: file.txt\n- community.general.ufw:`;
    const result = extractAnsibleComponents(content);
    assert.ok(result.modulesUsed.includes('ansible.builtin.copy'));
    assert.ok(result.modulesUsed.includes('community.general.ufw'));
  });

  it('should detect handlers', () => {
    const content = `tasks:\n  - name: test\nhandlers:\n  - name: restart`;
    const result = extractAnsibleComponents(content);
    assert.equal(result.hasHandlers, true);
  });

  it('should detect variables', () => {
    const content = `- hosts: all\n  vars:\n    http_port: 80`;
    const result = extractAnsibleComponents(content);
    assert.equal(result.hasVariables, true);
  });
});

describe('Validation Functions', () => {
  describe('validateTerraform', () => {
    it('should accept valid .tf with resource block', () => {
      assert.equal(validateTerraform('resource "aws_vpc" "main" {}', 'main.tf'), true);
    });
    it('should reject non-.tf files', () => {
      assert.equal(validateTerraform('resource "aws_vpc" "main" {}', 'main.py'), false);
    });
    it('should reject files without HCL blocks', () => {
      assert.equal(validateTerraform('just some text', 'main.tf'), false);
    });
  });

  describe('validateCompose', () => {
    it('should accept file with services section', () => {
      assert.equal(validateCompose('services:\n  web:\n    image: nginx'), true);
    });
    it('should reject file without services', () => {
      assert.equal(validateCompose('version: "3"\nnetworks:\n  default:'), false);
    });
  });

  describe('validateK8s', () => {
    it('should accept valid K8s YAML', () => {
      assert.equal(validateK8s('apiVersion: v1\nkind: Pod', 'pod.yaml'), true);
    });
    it('should reject non-YAML', () => {
      assert.equal(validateK8s('apiVersion: v1\nkind: Pod', 'pod.json'), false);
    });
    it('should reject without kind', () => {
      assert.equal(validateK8s('apiVersion: v1', 'test.yaml'), false);
    });
  });

  describe('validateAnsible', () => {
    it('should accept playbook with hosts and tasks', () => {
      assert.equal(validateAnsible('- hosts: all\n  tasks:\n    - name: test'), true);
    });
    it('should accept file with ansible.builtin module', () => {
      assert.equal(validateAnsible('- ansible.builtin.debug:\n    msg: hi'), true);
    });
    it('should reject generic YAML', () => {
      assert.equal(validateAnsible('name: test\nversion: 1'), false);
    });
  });

  describe('validateHelm', () => {
    it('should accept Chart.yaml with apiVersion and name', () => {
      assert.equal(validateHelm('apiVersion: v2\nname: test', 'Chart.yaml'), true);
    });
    it('should accept values.yaml with any YAML content', () => {
      assert.equal(validateHelm('replicaCount: 1', 'values.yaml'), true);
    });
    it('should accept template with helm markers', () => {
      assert.equal(validateHelm('kind: Deployment\n{{ .Values.image }}', 'deploy.yaml'), true);
    });
    it('should reject template without helm markers', () => {
      assert.equal(validateHelm('kind: Deployment\nname: test', 'deploy.yaml'), false);
    });
  });
});
