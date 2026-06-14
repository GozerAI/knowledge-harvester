// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Infrastructure Config Validator — Linting and validation for infra artifacts.
 *
 * Dispatches to format-specific sub-validators based on typeMetadata.config_type
 * or heuristic detection:
 *   - Terraform (HCL): required blocks, variable types, no hardcoded creds
 *   - Helm: Chart.yaml fields (apiVersion, name, version), values structure
 *   - Kubernetes: apiVersion, kind, metadata fields, valid kind list
 *
 * Returns { format_valid, required_fields_present, validation_score }.
 */

// Valid Kubernetes resource kinds
const K8S_VALID_KINDS = new Set([
  'Pod', 'Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Job', 'CronJob',
  'Service', 'Ingress', 'IngressClass', 'NetworkPolicy',
  'ConfigMap', 'Secret', 'PersistentVolume', 'PersistentVolumeClaim', 'StorageClass',
  'ServiceAccount', 'Role', 'ClusterRole', 'RoleBinding', 'ClusterRoleBinding',
  'Namespace', 'LimitRange', 'ResourceQuota',
  'HorizontalPodAutoscaler', 'VerticalPodAutoscaler', 'PodDisruptionBudget',
  'CustomResourceDefinition', 'MutatingWebhookConfiguration', 'ValidatingWebhookConfiguration',
]);

// Credential-like patterns for Terraform (hardcoded credential detection)
const TERRAFORM_SECRET_PATTERNS = [
  /access_key\s*=\s*"[A-Za-z0-9+/=]{16,}"/,
  /secret_key\s*=\s*"[A-Za-z0-9+/=]{16,}"/,
  /password\s*=\s*"[^"]{4,}"/,
  /token\s*=\s*"[A-Za-z0-9._-]{16,}"/,
  /private_key\s*=\s*"-----BEGIN/,
];

/**
 * Validate an infrastructure config artifact.
 *
 * @param {string} content - Raw config file content
 * @param {object} typeMetadata - Existing type_metadata from normalization
 * @returns {{ format_valid: boolean, required_fields_present: boolean, validation_score: number }}
 */
export function validateInfraConfig(content, typeMetadata) {
  const src = content || '';
  const configType = typeMetadata?.config_type || detectConfigType(src);

  switch (configType) {
    case 'terraform':           return validateTerraform(src, typeMetadata);
    case 'helm-chart':          return validateHelm(src, typeMetadata);
    case 'k8s-manifest':        return validateK8s(src, typeMetadata);
    case 'docker-compose':      return validateDockerCompose(src, typeMetadata);
    case 'ansible-playbook':    return validateAnsible(src, typeMetadata);
    default:                    return { format_valid: false, required_fields_present: false, validation_score: 40 };
  }
}

/**
 * Heuristic config type detection when typeMetadata is absent.
 */
function detectConfigType(src) {
  if (/\bresource\s+"[^"]+"/.test(src) || /\bprovider\s+"[^"]+"/.test(src)) return 'terraform';
  if (/^apiVersion:\s*/m.test(src) && /^kind:\s*/m.test(src)) return 'k8s-manifest';
  if (/^name:\s*/m.test(src) && /^version:\s*/m.test(src) && /^apiVersion:\s*v/m.test(src)) return 'helm-chart';
  if (/^services\s*:/m.test(src) && /image\s*:/.test(src)) return 'docker-compose';
  if (/^-\s+hosts\s*:/.test(src) || /^- hosts:/.test(src)) return 'ansible-playbook';
  return 'unknown';
}

// ── Terraform ──

function validateTerraform(src, meta) {
  const issues = [];

  // Required HCL block types
  const hasRequiredBlocks = {
    terraform: /\bterraform\s*\{/.test(src),
    provider: /\bprovider\s+"[^"]+"/.test(src),
    resource: /\bresource\s+"[^"]+"\s+"[^"]+"/.test(src),
  };

  const missingBlocks = Object.entries(hasRequiredBlocks)
    .filter(([, present]) => !present)
    .map(([name]) => name);

  if (missingBlocks.length > 0) {
    issues.push(`Missing required Terraform blocks: ${missingBlocks.join(', ')}`);
  }

  // Variable type annotations (variables without type = are technically valid but flag for quality)
  const variableBlocks = src.match(/variable\s+"[^"]+"\s*\{[\s\S]*?\}/g) || [];
  let untypedVars = 0;
  for (const block of variableBlocks) {
    if (!/\btype\s*=/.test(block)) untypedVars++;
  }
  if (untypedVars > 0) {
    issues.push(`${untypedVars} variable block${untypedVars > 1 ? 's' : ''} without type annotation`);
  }

  // Hardcoded credentials
  for (const pattern of TERRAFORM_SECRET_PATTERNS) {
    if (pattern.test(src)) {
      issues.push('Possible hardcoded credential detected in Terraform config');
      break; // Report once
    }
  }

  const format_valid = !hasRequiredBlocks.resource || /\bterraform\s*\{/.test(src) || /\bprovider\s*"/.test(src);
  const required_fields_present = missingBlocks.length === 0;

  return {
    format_valid: issues.length === 0 || missingBlocks.length < 3,
    required_fields_present,
    issues,
    validation_score: calculateInfraScore({ required_fields_present, issues, totalPossibleIssues: 5 }),
  };
}

// ── Helm ──

function validateHelm(src, meta) {
  const issues = [];

  // Required Chart.yaml fields — only validate if this looks like a Chart.yaml
  const isChartYaml = /^apiVersion\s*:/m.test(src) && /^name\s*:/m.test(src) && /^version\s*:/m.test(src);
  const isTemplateOrValues = !isChartYaml;

  if (isTemplateOrValues) {
    // Templates and values files don't have strict required fields
    return { format_valid: true, required_fields_present: true, validation_score: 85 };
  }

  const hasApiVersion = /^apiVersion\s*:\s*v2/m.test(src) || /^apiVersion\s*:\s*v1/m.test(src);
  const hasName = /^name\s*:\s*\S/m.test(src);
  const hasVersion = /^version\s*:\s*\d/m.test(src);

  if (!hasApiVersion) issues.push('Chart.yaml missing valid apiVersion (expected v1 or v2)');
  if (!hasName) issues.push('Chart.yaml missing required "name" field');
  if (!hasVersion) issues.push('Chart.yaml missing required "version" field (must be semver)');

  // Validate values structure — top-level values should not be arrays
  if (/^-\s+\w/.test(src)) {
    issues.push('Values file appears to define a top-level array instead of a mapping');
  }

  const required_fields_present = hasApiVersion && hasName && hasVersion;

  return {
    format_valid: issues.filter(i => i.includes('missing')).length < 2,
    required_fields_present,
    issues,
    validation_score: calculateInfraScore({ required_fields_present, issues, totalPossibleIssues: 4 }),
  };
}

// ── Kubernetes ──

function validateK8s(src, meta) {
  const issues = [];

  const hasApiVersion = /^apiVersion\s*:\s*\S/m.test(src);
  const kindMatch = src.match(/^kind\s*:\s*(\S+)/m);
  const hasKind = !!kindMatch;
  const kind = kindMatch?.[1] || '';
  const hasMetadata = /^metadata\s*:/m.test(src);
  const hasMetadataName = /^\s{2}name\s*:\s*\S/m.test(src);

  if (!hasApiVersion) issues.push('Missing required "apiVersion" field');
  if (!hasKind) issues.push('Missing required "kind" field');
  if (!hasMetadata) issues.push('Missing required "metadata" block');
  if (hasMetadata && !hasMetadataName) issues.push('metadata block missing required "name" field');

  // Validate kind against known list (but don't penalise CRDs harshly)
  if (kind && !K8S_VALID_KINDS.has(kind)) {
    // Could be a CRD — issue a warning rather than error
    issues.push(`Unknown Kubernetes kind: "${kind}" (may be a custom resource)`);
  }

  const required_fields_present = hasApiVersion && hasKind && hasMetadata && hasMetadataName;

  return {
    format_valid: hasApiVersion && hasKind,
    required_fields_present,
    issues,
    validation_score: calculateInfraScore({ required_fields_present, issues, totalPossibleIssues: 5 }),
  };
}

// ── Docker Compose ──

function validateDockerCompose(src, meta) {
  const issues = [];

  const hasServicesBlock = /^services\s*:/m.test(src);
  if (!hasServicesBlock) issues.push('Missing required "services" block');

  // Each service should have either image or build
  const serviceNames = extractDockerServiceNames(src);
  for (const svc of serviceNames) {
    const escapedSvc = svc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const svcBlock = src.match(
      new RegExp(`^  ${escapedSvc}\\s*:\\s*\\n([\\s\\S]*?)(?=\\n  \\w|\\Z)`, 'm')
    );
    if (svcBlock) {
      const block = svcBlock[1];
      if (!/\bimage\s*:/.test(block) && !/\bbuild\s*:/.test(block)) {
        issues.push(`Service "${svc}" has neither image nor build directive`);
      }
    }
  }

  const required_fields_present = hasServicesBlock && serviceNames.length > 0;

  return {
    format_valid: hasServicesBlock,
    required_fields_present,
    issues,
    validation_score: calculateInfraScore({ required_fields_present, issues, totalPossibleIssues: 4 }),
  };
}

function extractDockerServiceNames(src) {
  const names = [];
  let inServices = false;
  for (const line of src.split('\n')) {
    if (/^services\s*:/.test(line)) { inServices = true; continue; }
    if (inServices && /^\s{2}\w/.test(line) && !line.trim().startsWith('#')) {
      names.push(line.trim().replace(':', ''));
    }
    if (inServices && /^\w/.test(line) && !/^services\s*:/.test(line)) inServices = false;
  }
  return names;
}

// ── Ansible ──

function validateAnsible(src, meta) {
  const issues = [];

  const hasHosts = /\bhosts\s*:/.test(src);
  const hasTasks = /\btasks\s*:/.test(src);

  if (!hasHosts) issues.push('Playbook missing required "hosts" field');
  if (!hasTasks) issues.push('Playbook missing "tasks" block');

  // Check for tasks without a name (anonymous tasks are harder to debug)
  const taskBlocks = src.match(/^\s+-\s+(?!name\s*:)\w+\s*:/gm) || [];
  if (taskBlocks.length > 0) {
    issues.push(`${taskBlocks.length} task(s) without a "name" field`);
  }

  const required_fields_present = hasHosts && hasTasks;

  return {
    format_valid: hasHosts,
    required_fields_present,
    issues,
    validation_score: calculateInfraScore({ required_fields_present, issues, totalPossibleIssues: 3 }),
  };
}

/**
 * Calculate a validation score for infra configs (0-100).
 *
 * @param {{ required_fields_present: boolean, issues: string[], totalPossibleIssues: number }} params
 */
function calculateInfraScore({ required_fields_present, issues, totalPossibleIssues }) {
  let score = 100;

  if (!required_fields_present) score -= 30;

  // Deduct proportionally based on issue count vs total possible issues
  const issueWeight = totalPossibleIssues > 0 ? (60 / totalPossibleIssues) : 10;
  score -= Math.min(issues.length * issueWeight, 60);

  return Math.max(0, Math.min(100, Math.round(score)));
}
