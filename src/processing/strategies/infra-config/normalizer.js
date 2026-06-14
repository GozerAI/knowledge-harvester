// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { randomUUID } from 'node:crypto';
import { generateContentHash } from '../../../utils/hash.js';
import { extractNameFromPath } from '../../../utils/helpers.js';

/**
 * Normalize raw infrastructure config data into the unified artifact schema.
 *
 * @param {'terraform'|'helm'|'docker-compose'|'k8s-manifests'|'ansible'} source
 * @param {object} rawData
 * @returns {object} Normalized artifact object for storeArtifact()
 */
export function normalizeInfraConfig(source, rawData) {
  switch (source) {
    case 'terraform':       return normalizeTerraform(rawData);
    case 'helm':            return normalizeHelm(rawData);
    case 'docker-compose':  return normalizeDockerCompose(rawData);
    case 'k8s-manifests':   return normalizeK8sManifest(rawData);
    case 'ansible':         return normalizeAnsible(rawData);
    default: throw new Error(`Unknown infra config source: ${source}`);
  }
}

// ── Terraform ──

function normalizeTerraform(data) {
  const { searchResult, content, filename } = data;
  const components = extractTerraformComponents(content);

  return buildInfraArtifact({
    source: 'terraform',
    searchResult,
    content,
    filename,
    toolType: 'terraform',
    language: 'hcl',
    components,
    typeMetadata: {
      config_type: 'terraform',
      providers: components.providers,
      resources: components.resources,
      resource_count: components.resources.length,
      variables_count: components.variables.length,
      outputs_count: components.outputs.length,
      modules: components.modules,
    },
  });
}

/**
 * Extract Terraform components from HCL content.
 */
export function extractTerraformComponents(content) {
  const providers = [...new Set(
    (content.match(/provider\s+"([^"]+)"/g) || [])
      .map(m => m.match(/"([^"]+)"/)?.[1])
      .filter(Boolean)
  )];

  const resources = [...new Set(
    (content.match(/resource\s+"([^"]+)"/g) || [])
      .map(m => m.match(/"([^"]+)"/)?.[1])
      .filter(Boolean)
  )];

  const variables = [...new Set(
    (content.match(/variable\s+"([^"]+)"/g) || [])
      .map(m => m.match(/"([^"]+)"/)?.[1])
      .filter(Boolean)
  )];

  const outputs = [...new Set(
    (content.match(/output\s+"([^"]+)"/g) || [])
      .map(m => m.match(/"([^"]+)"/)?.[1])
      .filter(Boolean)
  )];

  const modules = [...new Set(
    (content.match(/module\s+"([^"]+)"/g) || [])
      .map(m => m.match(/"([^"]+)"/)?.[1])
      .filter(Boolean)
  )];

  const dataBlocks = [...new Set(
    (content.match(/data\s+"([^"]+)"/g) || [])
      .map(m => m.match(/"([^"]+)"/)?.[1])
      .filter(Boolean)
  )];

  return { providers, resources, variables, outputs, modules, dataBlocks };
}

// ── Helm ──

function normalizeHelm(data) {
  const { searchResult, content, filename } = data;
  const components = extractHelmComponents(content, filename);

  return buildInfraArtifact({
    source: 'helm',
    searchResult,
    content,
    filename,
    toolType: 'helm',
    language: 'yaml',
    components,
    typeMetadata: {
      config_type: 'helm-chart',
      chart_name: components.chartName,
      chart_version: components.chartVersion,
      app_version: components.appVersion,
      dependencies: components.dependencies,
      template_kinds: components.templateKinds,
      values_keys: components.valuesKeys,
    },
  });
}

export function extractHelmComponents(content, filename) {
  const name = (filename || '').toLowerCase();
  const isChart = name === 'chart.yaml' || name === 'chart.yml';

  let chartName = null;
  let chartVersion = null;
  let appVersion = null;
  const dependencies = [];
  const templateKinds = [];
  const valuesKeys = [];

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
    // Template or values file
    const kinds = content.match(/^kind:\s*(\w+)/gm) || [];
    for (const k of kinds) {
      const kind = k.match(/kind:\s*(\w+)/)?.[1];
      if (kind) templateKinds.push(kind);
    }

    // Top-level keys from values.yaml
    const topKeys = content.match(/^(\w+):/gm) || [];
    for (const k of topKeys) {
      const key = k.replace(':', '');
      if (key) valuesKeys.push(key);
    }
  }

  return { chartName, chartVersion, appVersion, dependencies, templateKinds, valuesKeys };
}

// ── Docker Compose ──

function normalizeDockerCompose(data) {
  const { searchResult, content, filename } = data;
  const components = extractDockerComposeComponents(content);

  return buildInfraArtifact({
    source: 'docker-compose',
    searchResult,
    content,
    filename,
    toolType: 'docker-compose',
    language: 'yaml',
    components,
    typeMetadata: {
      config_type: 'docker-compose',
      services: components.services,
      service_count: components.services.length,
      images: components.images,
      volumes: components.volumes,
      networks: components.networks,
      has_build: components.hasBuild,
      has_healthcheck: components.hasHealthcheck,
    },
  });
}

export function extractDockerComposeComponents(content) {
  const services = [];
  const images = [];
  const volumes = [];
  const networks = [];

  // Extract service names (indented keys under services:)
  let inServices = false;
  for (const line of content.split('\n')) {
    if (/^services:/m.test(line)) {
      inServices = true;
      continue;
    }
    if (inServices && /^\s{2}\w/.test(line) && !line.trim().startsWith('#')) {
      const svc = line.trim().replace(':', '');
      if (svc) services.push(svc);
    }
    if (inServices && /^\w/.test(line) && !line.startsWith(' ')) {
      inServices = false;
    }
  }

  // Images
  const imageMatches = content.match(/image:\s*(.+)/g) || [];
  for (const m of imageMatches) {
    const img = m.replace(/image:\s*/, '').trim().replace(/["']/g, '');
    if (img) images.push(img);
  }

  // Named volumes
  const volSection = content.match(/^volumes:\n([\s\S]*?)(?=^\w|\Z)/m);
  if (volSection) {
    const volLines = volSection[1].match(/^\s{2}(\w+):/gm) || [];
    for (const v of volLines) {
      volumes.push(v.trim().replace(':', ''));
    }
  }

  // Named networks
  const netSection = content.match(/^networks:\n([\s\S]*?)(?=^\w|\Z)/m);
  if (netSection) {
    const netLines = netSection[1].match(/^\s{2}(\w+):/gm) || [];
    for (const n of netLines) {
      networks.push(n.trim().replace(':', ''));
    }
  }

  const hasBuild = /\bbuild:/m.test(content);
  const hasHealthcheck = /\bhealthcheck:/m.test(content);

  return { services, images, volumes, networks, hasBuild, hasHealthcheck };
}

// ── Kubernetes Manifests ──

function normalizeK8sManifest(data) {
  const { searchResult, content, filename } = data;
  const components = extractK8sComponents(content);

  return buildInfraArtifact({
    source: 'k8s-manifests',
    searchResult,
    content,
    filename,
    toolType: 'kubernetes',
    language: 'yaml',
    components,
    typeMetadata: {
      config_type: 'k8s-manifest',
      api_version: components.apiVersion,
      kind: components.kind,
      namespace: components.namespace,
      containers: components.containers,
      container_count: components.containers.length,
      labels: components.labels,
      has_resources: components.hasResources,
      has_probes: components.hasProbes,
    },
  });
}

export function extractK8sComponents(content) {
  const apiVersion = content.match(/apiVersion:\s*(.+)/)?.[1]?.trim() || '';
  const kind = content.match(/kind:\s*(\w+)/)?.[1] || '';
  const namespace = content.match(/namespace:\s*(\S+)/)?.[1] || 'default';

  const containers = [];
  const containerNames = content.match(/^\s+-?\s*name:\s*(\S+)/gm) || [];
  // Filter to likely container names (under containers: section)
  const imageMatches = content.match(/image:\s*(.+)/g) || [];
  for (const m of imageMatches) {
    const img = m.replace(/image:\s*/, '').trim().replace(/["']/g, '');
    if (img) containers.push(img);
  }

  const labels = {};
  const labelMatches = content.match(/^\s{4,}(\w[\w.-]*):\s*(.+)/gm) || [];

  const hasResources = /\bresources:/m.test(content) &&
    (/\blimits:/m.test(content) || /\brequests:/m.test(content));
  const hasProbes = /\blivenessProbe:/m.test(content) || /\breadinessProbe:/m.test(content);

  return { apiVersion, kind, namespace, containers, labels, hasResources, hasProbes };
}

// ── Ansible ──

function normalizeAnsible(data) {
  const { searchResult, content, filename } = data;
  const components = extractAnsibleComponents(content);

  return buildInfraArtifact({
    source: 'ansible',
    searchResult,
    content,
    filename,
    toolType: 'ansible',
    language: 'yaml',
    components,
    typeMetadata: {
      config_type: 'ansible-playbook',
      hosts: components.hosts,
      task_count: components.taskCount,
      modules_used: components.modulesUsed,
      roles: components.roles,
      has_handlers: components.hasHandlers,
      has_variables: components.hasVariables,
      collections: components.collections,
    },
  });
}

export function extractAnsibleComponents(content) {
  const hosts = content.match(/hosts:\s*(.+)/)?.[1]?.trim() || 'all';

  // Count tasks
  const taskMatches = content.match(/^\s+-\s+name:/gm) || [];
  const taskCount = taskMatches.length;

  // Extract module names (ansible.builtin.X, community.X, etc.)
  const modulesUsed = [...new Set(
    (content.match(/(ansible\.\w+\.\w+|community\.\w+\.\w+)/g) || [])
  )];

  // Also detect shorthand modules (apt, yum, copy, template, etc.)
  const shortModules = [...new Set(
    (content.match(/^\s+(apt|yum|dnf|copy|template|file|service|systemd|lineinfile|shell|command|debug|set_fact|include_tasks|import_tasks|include_role|block):/gm) || [])
      .map(m => m.trim().replace(':', ''))
  )];
  for (const m of shortModules) {
    if (!modulesUsed.some(mod => mod.includes(m))) {
      modulesUsed.push(m);
    }
  }

  // Roles
  const roles = [...new Set(
    (content.match(/^\s+-\s+(?:role:\s*)?(\w[\w.-]*)/gm) || [])
      .map(m => m.trim().replace(/^-\s+(?:role:\s*)?/, ''))
      .filter(r => r && !r.startsWith('name'))
  )];

  const hasHandlers = /\bhandlers:/m.test(content);
  const hasVariables = /\bvars:/m.test(content) || /\bvars_files:/m.test(content);

  const collections = [...new Set(
    (content.match(/^\s+-\s*(ansible\.\w+|community\.\w+)/gm) || [])
      .map(m => m.trim().replace(/^-\s*/, ''))
  )];

  return { hosts, taskCount, modulesUsed, roles, hasHandlers, hasVariables, collections };
}

// ── Shared Builder ──

function buildInfraArtifact({ source, searchResult, content, filename, toolType, language, components, typeMetadata }) {
  const name = searchResult?.repository?.full_name
    ? `${searchResult.repository.full_name}/${filename}`
    : extractNameFromPath(filename);
  const description = searchResult?.repository?.description || '';

  return {
    id: randomUUID(),
    hash: generateContentHash(content, toolType),
    artifact_type: 'infra_config',
    source,
    source_url: searchResult?.html_url || '',
    source_id: searchResult?.sha || searchResult?.html_url || randomUUID(),
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    content: { source_code: content, filename },
    name,
    description,
    author: {
      username: searchResult?.repository?.owner?.login || null,
      profile_url: searchResult?.repository?.owner?.html_url || null,
    },
    language,
    tool_type: toolType,
    tool_metadata: typeMetadata,
    tags: [],
    type_metadata: typeMetadata,
    quality: {
      score: 0,
      has_description: description.length > 0,
      has_documentation: description.length > 100,
      is_complete: true,
      validation_status: 'valid',
    },
  };
}
