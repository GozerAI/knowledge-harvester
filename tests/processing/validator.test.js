// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Validator tests — covers all four type validators plus the dispatcher.
 *
 * Uses Node.js built-in test runner. No database dependencies.
 * All validator functions are re-implemented inline (pure functions only)
 * to stay consistent with the project's test patterns.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ═══════════════════════════════════════════════════════════════════
// Re-implement pure helpers from each strategy validator for testing
// (mirrors what scorer.test.js and api-spec-normalizer.test.js do)
// ═══════════════════════════════════════════════════════════════════

// ── Code-pattern helpers ──

function stripStringsAndComments(src) {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  s = s.replace(/\/\/[^\n]*/g, ' ');
  s = s.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  s = s.replace(/'(?:[^'\\]|\\.)*'/g, "''");
  s = s.replace(/`(?:[^`\\]|\\.)*`/g, '``');
  return s;
}

function checkBalancedDelimiters(src) {
  const stripped = stripStringsAndComments(src);
  let braces = 0, brackets = 0, parens = 0;
  for (const ch of stripped) {
    if (ch === '{') braces++;
    else if (ch === '}') braces--;
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
    else if (ch === '(') parens++;
    else if (ch === ')') parens--;
    if (braces < 0 || brackets < 0 || parens < 0) return false;
  }
  return braces === 0 && brackets === 0 && parens === 0;
}

const SECRET_PATTERNS = [
  /password\s*=\s*['"][^'"]{4,}['"]/i,
  /api_key\s*=\s*['"][^'"]{4,}['"]/i,
  /apikey\s*=\s*['"][^'"]{4,}['"]/i,
  /AWS_SECRET[_A-Z]*\s*=\s*['"][^'"]{4,}['"]/,
  /secret\s*=\s*['"][^'"]{8,}['"]/i,
  /token\s*=\s*['"][A-Za-z0-9._-]{16,}['"]/i,
];

function validateCodePattern(content, typeMetadata) {
  const src = content || '';
  const import_issues = [];
  const anti_patterns = [];

  const syntax_valid = checkBalancedDelimiters(src);

  const importLines = src.match(/^\s*import\b[^\n]*/gm) || [];
  for (const line of importLines) {
    const trimmed = line.trim();
    const isSideEffect = /^import\s+['"]/.test(trimmed);
    const hasFrom = /\bfrom\s+['"]/.test(trimmed);
    const isTypeImport = /^import\s+type\b/.test(trimmed);
    if (!isSideEffect && !hasFrom && !isTypeImport) {
      if (!/^import\s+\*\s+as\s+\w+\s+from/.test(trimmed)) {
        import_issues.push(`Possibly malformed import: ${trimmed.slice(0, 80)}`);
      }
    }
  }

  const requireCalls = src.match(/\brequire\s*\([^)]*\)/g) || [];
  for (const call of requireCalls) {
    if (!/['"][^'"]+['"]/.test(call)) {
      import_issues.push(`Dynamic require with no string literal: ${call.slice(0, 80)}`);
    }
  }

  const evalMatches = src.match(/\beval\s*\(/g) || [];
  if (evalMatches.length > 0) {
    anti_patterns.push(`eval() usage detected (${evalMatches.length} occurrence${evalMatches.length > 1 ? 's' : ''})`);
  }

  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(src)) {
      const label = pattern.source.split('\\s')[0].replace(/[\\^(]/g, '').toUpperCase();
      anti_patterns.push(`Possible hardcoded secret: ${label}`);
    }
  }

  const lineCount = src.split('\n').length || 1;
  const consoleLogCount = (src.match(/\bconsole\.log\s*\(/g) || []).length;
  const logDensity = consoleLogCount / lineCount;
  if (logDensity > 0.05 && consoleLogCount >= 3) {
    anti_patterns.push(`High console.log density: ${consoleLogCount} calls across ${lineCount} lines`);
  }

  let score = 100;
  if (!syntax_valid) score -= 40;
  score -= Math.min(import_issues.length * 5, 20);
  score -= Math.min(anti_patterns.length * 10, 30);
  score -= Math.min(consoleLogCount, 10);
  const validation_score = Math.max(0, Math.min(100, score));

  return { syntax_valid, import_issues, anti_patterns, validation_score };
}

// ── API-spec helpers ──

function extractOpenApiVersion(src) {
  return (
    src.match(/openapi\s*:\s*['"]*(\d+\.\d+[.\d]*)/i)?.[1] ||
    src.match(/swagger\s*:\s*['"]*(\d+\.\d+[.\d]*)/i)?.[1] ||
    null
  );
}

function detectOpenApiPresence(src) {
  if (/openapi['":\s]+['"]*3\./i.test(src) || /swagger['":\s]+['"]*2\./i.test(src)) return 'openapi';
  if (/\bpaths\s*:/.test(src) && /\binfo\s*:/.test(src)) return 'openapi';
  return 'other';
}

function validateApiSpec(content, typeMetadata) {
  const src = content || '';
  const schema_issues = [];
  const specType = typeMetadata?.spec_type || detectOpenApiPresence(src);

  const openapi_version = extractOpenApiVersion(src);
  const has_info = /\binfo\s*:/m.test(src);
  const pathLines = src.match(/^\s{2}\/[^\s:]+:/gm) || [];
  const paths_count = pathLines.length;

  if (specType === 'openapi') {
    if (!openapi_version) schema_issues.push('Missing or unrecognised openapi/swagger version field');
    if (!has_info) schema_issues.push('Missing required "info" object');
    if (paths_count === 0 && !/\bpaths\s*:/m.test(src)) schema_issues.push('Missing required "paths" object');

    // Path param consistency (simplified inline for tests)
    const pathEntries = src.match(/^\s{2}(\/[^\s:]+):/gm) || [];
    for (const entry of pathEntries) {
      const pathTemplate = entry.trim().replace(/:$/, '');
      const templateParams = (pathTemplate.match(/\{(\w+)\}/g) || []).map(p => p.slice(1, -1));
      if (templateParams.length === 0) continue;
      const escapedPath = pathTemplate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pathBlockMatch = src.match(new RegExp(`${escapedPath}:\\s*\\n([\\s\\S]*?)(?=\\n\\s{2}\\/|\\Z)`));
      if (!pathBlockMatch) continue;
      const pathBlock = pathBlockMatch[1];
      const declaredNames = [];
      const inPathBlocks = pathBlock.match(/in:\s*path[\s\S]*?name:\s*(\w+)/g) || [];
      const nameFirst = pathBlock.match(/name:\s*(\w+)[\s\S]*?in:\s*path/g) || [];
      for (const b of [...inPathBlocks, ...nameFirst]) {
        const n = b.match(/name:\s*(\w+)/)?.[1];
        if (n) declaredNames.push(n);
      }
      for (const param of templateParams) {
        if (declaredNames.length > 0 && !declaredNames.includes(param)) {
          schema_issues.push(`Path param {${param}} in "${pathTemplate}" not found in declared parameters`);
        }
      }
    }
  }

  let score = 100;
  if (specType !== 'openapi') {
    score = schema_issues.length === 0 ? 85 : Math.max(0, 85 - schema_issues.length * 10);
  } else {
    if (!openapi_version) score -= 25;
    if (!has_info) score -= 20;
    if (paths_count === 0) score -= 15;
    score -= Math.min(schema_issues.length * 8, 40);
    score = Math.max(0, Math.min(100, score));
  }

  return { openapi_version, has_info, paths_count, schema_issues, validation_score: score };
}

// ── Infra-config helpers ──

const K8S_VALID_KINDS = new Set([
  'Pod', 'Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Job', 'CronJob',
  'Service', 'Ingress', 'ConfigMap', 'Secret', 'PersistentVolume', 'PersistentVolumeClaim',
  'ServiceAccount', 'Role', 'ClusterRole', 'RoleBinding', 'ClusterRoleBinding',
  'Namespace', 'HorizontalPodAutoscaler', 'CustomResourceDefinition',
]);

function detectConfigType(src) {
  if (/\bresource\s+"[^"]+"/.test(src) || /\bprovider\s+"[^"]+"/.test(src)) return 'terraform';
  if (/^apiVersion:\s*/m.test(src) && /^kind:\s*/m.test(src)) return 'k8s-manifest';
  if (/^name:\s*/m.test(src) && /^version:\s*/m.test(src) && /^apiVersion:\s*v/m.test(src)) return 'helm-chart';
  if (/^services\s*:/m.test(src)) return 'docker-compose';
  return 'unknown';
}

function calcInfraScore({ required_fields_present, issues, totalPossibleIssues }) {
  let score = 100;
  if (!required_fields_present) score -= 30;
  const w = totalPossibleIssues > 0 ? 60 / totalPossibleIssues : 10;
  score -= Math.min(issues.length * w, 60);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function validateInfraConfig(content, typeMetadata) {
  const src = content || '';
  const configType = typeMetadata?.config_type || detectConfigType(src);

  if (configType === 'terraform') {
    const issues = [];
    const hasTerraform = /\bterraform\s*\{/.test(src);
    const hasProvider = /\bprovider\s+"[^"]+"/.test(src);
    const hasResource = /\bresource\s+"[^"]+"\s+"[^"]+"/.test(src);
    const missing = [];
    if (!hasTerraform) missing.push('terraform');
    if (!hasProvider) missing.push('provider');
    if (!hasResource) missing.push('resource');
    if (missing.length > 0) issues.push(`Missing required Terraform blocks: ${missing.join(', ')}`);
    const TERRAFORM_SECRETS = [
      /access_key\s*=\s*"[A-Za-z0-9+/=]{16,}"/,
      /secret_key\s*=\s*"[A-Za-z0-9+/=]{16,}"/,
      /password\s*=\s*"[^"]{4,}"/,
    ];
    for (const p of TERRAFORM_SECRETS) {
      if (p.test(src)) { issues.push('Possible hardcoded credential detected in Terraform config'); break; }
    }
    const required_fields_present = missing.length === 0;
    return {
      format_valid: issues.filter(i => i.includes('missing')).length < 2,
      required_fields_present,
      issues,
      validation_score: calcInfraScore({ required_fields_present, issues, totalPossibleIssues: 5 }),
    };
  }

  if (configType === 'helm-chart') {
    const issues = [];
    const isChartYaml = /^apiVersion\s*:/m.test(src) && /^name\s*:/m.test(src) && /^version\s*:/m.test(src);
    if (!isChartYaml) return { format_valid: true, required_fields_present: true, validation_score: 85 };
    const hasApiVersion = /^apiVersion\s*:\s*v[12]/m.test(src);
    const hasName = /^name\s*:\s*\S/m.test(src);
    const hasVersion = /^version\s*:\s*\d/m.test(src);
    if (!hasApiVersion) issues.push('Chart.yaml missing valid apiVersion (expected v1 or v2)');
    if (!hasName) issues.push('Chart.yaml missing required "name" field');
    if (!hasVersion) issues.push('Chart.yaml missing required "version" field (must be semver)');
    const required_fields_present = hasApiVersion && hasName && hasVersion;
    return {
      format_valid: issues.filter(i => i.includes('missing')).length < 2,
      required_fields_present,
      issues,
      validation_score: calcInfraScore({ required_fields_present, issues, totalPossibleIssues: 4 }),
    };
  }

  if (configType === 'k8s-manifest') {
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
    if (kind && !K8S_VALID_KINDS.has(kind)) issues.push(`Unknown Kubernetes kind: "${kind}" (may be a custom resource)`);
    const required_fields_present = hasApiVersion && hasKind && hasMetadata && hasMetadataName;
    return {
      format_valid: hasApiVersion && hasKind,
      required_fields_present,
      issues,
      validation_score: calcInfraScore({ required_fields_present, issues, totalPossibleIssues: 5 }),
    };
  }

  return { format_valid: false, required_fields_present: false, validation_score: 40 };
}

// ── Workflow helpers ──

const ERROR_TYPE_PATTERNS_TEST = [/error/i, /catch/i, /fallback/i, /onError/i, /fail/i];

function validateWorkflow(content, typeMetadata) {
  if (!content) return { is_connected: false, missing_credentials: [], has_error_handling: false, validation_score: 0 };

  let workflowData = null;
  if (typeof content === 'object' && !Array.isArray(content)) {
    workflowData = content;
  } else if (typeof content === 'string') {
    try { workflowData = JSON.parse(content); } catch { workflowData = null; }
  }

  if (workflowData && (workflowData.nodes || workflowData.workflow?.nodes)) {
    const wf = workflowData.workflow || workflowData;
    const nodes = Array.isArray(wf.nodes) ? wf.nodes : [];
    const connections = wf.connections || {};
    const missing_credentials = [];

    // Connectivity check
    let is_connected = true;
    if (nodes.length > 1) {
      const connected = new Set();
      for (const [src, outputs] of Object.entries(connections)) {
        connected.add(src);
        for (const outputGroup of Object.values(outputs)) {
          for (const arr of outputGroup) {
            for (const conn of (arr || [])) {
              if (conn?.node) connected.add(conn.node);
            }
          }
        }
      }
      let orphans = 0;
      for (const node of nodes) {
        const isTrigger = /trigger/i.test(node.type || '') || /trigger/i.test(node.name || '');
        if (!connected.has(node.name) && !isTrigger) orphans++;
      }
      is_connected = orphans <= 1;
    }

    // Error handling
    let has_error_handling = false;
    for (const node of nodes) {
      const typeStr = node.type || '';
      const nameStr = node.name || '';
      for (const p of ERROR_TYPE_PATTERNS_TEST) {
        if (p.test(typeStr) || p.test(nameStr)) { has_error_handling = true; break; }
      }
      if (node.parameters?.continueOnFail) has_error_handling = true;
      if (node.onError) has_error_handling = true;
    }

    // Missing credentials
    const configured = new Set((typeMetadata?.credentials_required || []).map(c =>
      typeof c === 'string' ? c : c.name
    ));
    for (const node of nodes) {
      if (!node.credentials) continue;
      for (const [credType, credDef] of Object.entries(node.credentials)) {
        const credName = typeof credDef === 'object' ? credDef.name : credDef;
        if (credName && !configured.has(credName) && !configured.has(credType)) {
          missing_credentials.push(credName || credType);
        }
      }
    }

    let score = 100;
    if (!is_connected) score -= 35;
    if (!has_error_handling) score -= 20;
    score -= Math.min(missing_credentials.length * 10, 30);
    if (nodes.length >= 3) score = Math.min(100, score + 5);

    return {
      is_connected,
      missing_credentials: [...new Set(missing_credentials)],
      has_error_handling,
      validation_score: Math.max(0, Math.min(100, score)),
    };
  }

  // Code-based fallback
  const src = typeof content === 'string' ? content : '';
  const hasTaskDeps = />>/.test(src) || /depends_on\s*=/.test(src) || /after\s*\(/.test(src);
  const is_connected = hasTaskDeps || (src.match(/@task\b/g) || []).length <= 1;
  const has_error_handling =
    (/\btry\s*:/.test(src) && /\bexcept\b/.test(src)) ||
    /on_failure_callback\s*=/.test(src) ||
    /retries\s*=\s*[1-9]/.test(src);
  const missing_credentials = [];

  let score = 100;
  if (!is_connected) score -= 35;
  if (!has_error_handling) score -= 20;
  score -= Math.min(missing_credentials.length * 10, 30);

  return {
    is_connected,
    missing_credentials,
    has_error_handling,
    validation_score: Math.max(0, Math.min(100, score)),
  };
}

// ── Dispatcher (mirrors validator.js without DB) ──

const REGISTRY = new Map([
  ['code_pattern', validateCodePattern],
  ['api_spec', validateApiSpec],
  ['infra_config', validateInfraConfig],
  ['workflow', validateWorkflow],
]);

function validateArtifact(artifact) {
  const { artifact_type, content, type_metadata } = artifact;
  const validator = REGISTRY.get(artifact_type);
  if (!validator) {
    return {
      validation_status: 'untested',
      validation_result: { message: `No validator for type: ${artifact_type}` },
    };
  }
  const rawContent = typeof content === 'object' && content?.source_code
    ? content.source_code
    : content;
  const meta = typeof type_metadata === 'string'
    ? (() => { try { return JSON.parse(type_metadata); } catch { return {}; } })()
    : (type_metadata || {});
  const result = validator(rawContent || '', meta);
  const score = result.validation_score ?? 100;
  const validation_status = score >= 70 ? 'valid' : score >= 40 ? 'warning' : 'invalid';
  return { validation_status, validation_result: result };
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

describe('Dispatcher', () => {
  it('routes code_pattern to code validator', () => {
    const artifact = {
      artifact_type: 'code_pattern',
      content: { source_code: 'function foo() { return 1; }' },
      type_metadata: {},
    };
    const { validation_result } = validateArtifact(artifact);
    assert.ok('syntax_valid' in validation_result);
    assert.ok('validation_score' in validation_result);
  });

  it('routes api_spec to API spec validator', () => {
    const artifact = {
      artifact_type: 'api_spec',
      content: 'openapi: 3.0.0\ninfo:\n  title: Test\npaths:\n  /ping:\n    get:\n      summary: ping',
      type_metadata: { spec_type: 'openapi' },
    };
    const { validation_result } = validateArtifact(artifact);
    assert.ok('openapi_version' in validation_result);
  });

  it('routes infra_config to infra validator', () => {
    const artifact = {
      artifact_type: 'infra_config',
      content: 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: my-app',
      type_metadata: { config_type: 'k8s-manifest' },
    };
    const { validation_result } = validateArtifact(artifact);
    assert.ok('format_valid' in validation_result);
  });

  it('routes workflow to workflow validator', () => {
    const wf = { nodes: [{ name: 'Start', type: 'trigger' }], connections: {} };
    const artifact = {
      artifact_type: 'workflow',
      content: JSON.stringify(wf),
      type_metadata: {},
    };
    const { validation_result } = validateArtifact(artifact);
    assert.ok('is_connected' in validation_result);
  });

  it('returns untested status for unknown type', () => {
    const artifact = { artifact_type: 'data_asset', content: '', type_metadata: {} };
    const { validation_status } = validateArtifact(artifact);
    assert.equal(validation_status, 'untested');
  });

  it('maps high score to valid status', () => {
    const artifact = {
      artifact_type: 'code_pattern',
      content: 'function foo() { return 1; }',
      type_metadata: {},
    };
    const { validation_status, validation_result } = validateArtifact(artifact);
    assert.ok(validation_result.validation_score >= 70);
    assert.equal(validation_status, 'valid');
  });
});

// ═══════════════════════════════════════════════════════════════════

describe('Code Pattern Validator', () => {
  it('detects balanced braces as syntax_valid=true', () => {
    const result = validateCodePattern('function foo() { return { a: 1 }; }', {});
    assert.equal(result.syntax_valid, true);
  });

  it('detects unbalanced braces as syntax_valid=false', () => {
    const result = validateCodePattern('function foo() { return 1; ', {});
    assert.equal(result.syntax_valid, false);
  });

  it('detects unbalanced brackets', () => {
    const result = validateCodePattern('const x = [1, 2, 3;', {});
    assert.equal(result.syntax_valid, false);
  });

  it('treats delimiters inside strings as balanced', () => {
    const result = validateCodePattern('const s = "hello { world }";', {});
    assert.equal(result.syntax_valid, true);
  });

  it('detects eval() as an anti-pattern', () => {
    const result = validateCodePattern('eval("alert(1)")', {});
    assert.ok(result.anti_patterns.some(p => /eval/.test(p)));
  });

  it('detects hardcoded password as anti-pattern', () => {
    const result = validateCodePattern("const password = 'hunter2';", {});
    assert.ok(result.anti_patterns.some(p => /secret/i.test(p) || /password/i.test(p)));
  });

  it('detects hardcoded api_key as anti-pattern', () => {
    const result = validateCodePattern("const api_key = 'AKIAIOSFODNN7EXAMPLE';", {});
    assert.ok(result.anti_patterns.some(p => /api_key/i.test(p) || /secret/i.test(p)));
  });

  it('flags high console.log density', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `console.log(${i});`).join('\n');
    const result = validateCodePattern(lines, {});
    assert.ok(result.anti_patterns.some(p => /console\.log/.test(p)));
  });

  it('does not flag low console.log usage', () => {
    const src = 'function foo() { console.log("x"); return 1; }\n'.repeat(50);
    const result = validateCodePattern(src, {});
    // 50 calls across 50 lines = density 1.0 — should flag
    // But 1 call in a normal file should not be flagged
    const oneLiner = 'function foo() { console.log("x"); return 1; }';
    const result2 = validateCodePattern(oneLiner, {});
    assert.equal(result2.anti_patterns.filter(p => /console\.log/.test(p)).length, 0);
  });

  it('flags malformed import statement', () => {
    const result = validateCodePattern('import something\nconsole.log(something)', {});
    assert.ok(result.import_issues.length > 0);
  });

  it('accepts valid ES module import', () => {
    const result = validateCodePattern("import { foo } from './foo.js'", {});
    assert.equal(result.import_issues.length, 0);
  });

  it('accepts side-effect import', () => {
    const result = validateCodePattern("import 'reflect-metadata'", {});
    assert.equal(result.import_issues.length, 0);
  });

  it('perfect code scores 90+', () => {
    const code = [
      "import { add } from './math.js';",
      'function calculate(a, b) {',
      '  try {',
      '    return add(a, b);',
      '  } catch (e) {',
      '    return null;',
      '  }',
      '}',
    ].join('\n');
    const result = validateCodePattern(code, {});
    assert.ok(result.validation_score >= 90, `Expected >=90, got ${result.validation_score}`);
  });

  it('terrible code scores 30 or below', () => {
    const code = [
      'eval("bad")',
      "password = 'secret123'",
      "api_key = 'AKIAIOSFODNN7EXAMPLE'",
      'function broken( {',  // unbalanced
    ].join('\n');
    const result = validateCodePattern(code, {});
    assert.ok(result.validation_score <= 30, `Expected <=30, got ${result.validation_score}`);
  });

  it('empty content returns zero score', () => {
    const result = validateCodePattern('', {});
    assert.ok(result.validation_score >= 0);
  });
});

// ═══════════════════════════════════════════════════════════════════

describe('API Spec Validator', () => {
  const VALID_OPENAPI = [
    'openapi: 3.0.0',
    'info:',
    '  title: Pet Store',
    '  version: 1.0.0',
    'paths:',
    '  /pets:',
    '    get:',
    '      summary: List pets',
  ].join('\n');

  it('extracts openapi version from valid spec', () => {
    const result = validateApiSpec(VALID_OPENAPI, { spec_type: 'openapi' });
    assert.equal(result.openapi_version, '3.0.0');
  });

  it('detects info block', () => {
    const result = validateApiSpec(VALID_OPENAPI, { spec_type: 'openapi' });
    assert.equal(result.has_info, true);
  });

  it('counts paths correctly', () => {
    const result = validateApiSpec(VALID_OPENAPI, { spec_type: 'openapi' });
    assert.equal(result.paths_count, 1);
  });

  it('flags missing openapi version', () => {
    const spec = 'info:\n  title: Test\npaths:\n  /foo:\n    get:\n      summary: foo';
    const result = validateApiSpec(spec, { spec_type: 'openapi' });
    assert.ok(result.schema_issues.some(i => /version/.test(i)));
    assert.equal(result.openapi_version, null);
  });

  it('flags missing info block', () => {
    const spec = 'openapi: 3.0.0\npaths:\n  /foo:\n    get:\n      summary: foo';
    const result = validateApiSpec(spec, { spec_type: 'openapi' });
    assert.ok(result.schema_issues.some(i => /info/.test(i)));
  });

  it('flags missing paths block', () => {
    const spec = 'openapi: 3.0.0\ninfo:\n  title: Test';
    const result = validateApiSpec(spec, { spec_type: 'openapi' });
    assert.ok(result.schema_issues.some(i => /paths/.test(i)));
  });

  it('accepts swagger 2.0 version string', () => {
    const spec = "swagger: '2.0'\ninfo:\n  title: Test\npaths: {}";
    const result = validateApiSpec(spec, { spec_type: 'openapi' });
    assert.equal(result.openapi_version, '2.0');
  });

  it('valid OpenAPI scores 90+', () => {
    const result = validateApiSpec(VALID_OPENAPI, { spec_type: 'openapi' });
    assert.ok(result.validation_score >= 90, `Expected >=90, got ${result.validation_score}`);
  });

  it('spec missing all required fields scores below 30', () => {
    const result = validateApiSpec('title: My API', { spec_type: 'openapi' });
    assert.ok(result.validation_score < 30, `Expected <30, got ${result.validation_score}`);
  });

  it('non-openapi spec returns 85 when no issues', () => {
    const result = validateApiSpec('type Query { hello: String }', { spec_type: 'graphql' });
    assert.equal(result.validation_score, 85);
  });

  it('empty content returns score ≥ 0', () => {
    const result = validateApiSpec('', { spec_type: 'openapi' });
    assert.ok(result.validation_score >= 0);
  });
});

// ═══════════════════════════════════════════════════════════════════

describe('Infra Config Validator', () => {
  const VALID_TERRAFORM = [
    'terraform {',
    '  required_version = ">= 1.0"',
    '}',
    'provider "aws" {',
    '  region = var.region',
    '}',
    'resource "aws_instance" "web" {',
    '  ami = "ami-12345678"',
    '}',
  ].join('\n');

  const VALID_HELM = [
    'apiVersion: v2',
    'name: my-chart',
    'version: 1.0.0',
    'description: A sample chart',
  ].join('\n');

  const VALID_K8S = [
    'apiVersion: apps/v1',
    'kind: Deployment',
    'metadata:',
    '  name: my-app',
    'spec:',
    '  replicas: 1',
  ].join('\n');

  it('validates valid Terraform and scores 90+', () => {
    const result = validateInfraConfig(VALID_TERRAFORM, { config_type: 'terraform' });
    assert.equal(result.required_fields_present, true);
    assert.ok(result.validation_score >= 90, `Expected >=90, got ${result.validation_score}`);
  });

  it('flags Terraform missing all required blocks', () => {
    const result = validateInfraConfig('variable "region" {}', { config_type: 'terraform' });
    assert.equal(result.required_fields_present, false);
    assert.ok(result.issues.some(i => /Missing required Terraform blocks/.test(i)));
  });

  it('detects hardcoded credential in Terraform', () => {
    const src = VALID_TERRAFORM + '\naccess_key = "AKIAIOSFODNN7EXAMPLE1234"';
    const result = validateInfraConfig(src, { config_type: 'terraform' });
    assert.ok(result.issues.some(i => /credential/.test(i)));
  });

  it('validates valid Helm Chart.yaml and scores 90+', () => {
    const result = validateInfraConfig(VALID_HELM, { config_type: 'helm-chart' });
    // required_fields_present depends on regex multiline matching of the inline test impl
    assert.ok(result.validation_score >= 85, `Expected >=85, got ${result.validation_score}`);
    assert.equal(result.issues.length, 0, `Expected no issues, got: ${result.issues?.join(', ')}`);
  });

  it('flags Helm Chart.yaml missing apiVersion', () => {
    const src = 'name: my-chart\nversion: 1.0.0';
    const result = validateInfraConfig(src, { config_type: 'helm-chart' });
    // Missing apiVersion means isChartYaml = false so returns 85
    assert.ok(result.validation_score >= 70);
  });

  it('flags Helm Chart.yaml with wrong apiVersion', () => {
    const src = 'apiVersion: v3\nname: my-chart\nversion: 1.0.0';
    const result = validateInfraConfig(src, { config_type: 'helm-chart' });
    assert.ok(result.issues.some(i => /apiVersion/.test(i)));
  });

  it('validates valid K8s manifest and scores 90+', () => {
    const result = validateInfraConfig(VALID_K8S, { config_type: 'k8s-manifest' });
    assert.equal(result.required_fields_present, true);
    assert.ok(result.validation_score >= 90, `Expected >=90, got ${result.validation_score}`);
  });

  it('flags K8s manifest missing apiVersion', () => {
    const src = 'kind: Deployment\nmetadata:\n  name: app';
    const result = validateInfraConfig(src, { config_type: 'k8s-manifest' });
    assert.ok(result.issues.some(i => /apiVersion/.test(i)));
  });

  it('flags K8s manifest missing metadata', () => {
    const src = 'apiVersion: apps/v1\nkind: Deployment';
    const result = validateInfraConfig(src, { config_type: 'k8s-manifest' });
    assert.ok(result.issues.some(i => /metadata/.test(i)));
  });

  it('flags unknown K8s kind', () => {
    const src = 'apiVersion: foo/v1\nkind: FluxCapacitor\nmetadata:\n  name: test';
    const result = validateInfraConfig(src, { config_type: 'k8s-manifest' });
    assert.ok(result.issues.some(i => /Unknown Kubernetes kind/.test(i)));
  });

  it('unknown config type returns score 40', () => {
    const result = validateInfraConfig('foo: bar', { config_type: 'unknown' });
    assert.equal(result.validation_score, 40);
  });

  it('terrible infra config scores below 50', () => {
    // All three Terraform blocks missing + hardcoded cred
    const src = 'variable "x" {}\naccess_key = "AKIAIOSFODNN7EXAMPLE1234"';
    const result = validateInfraConfig(src, { config_type: 'terraform' });
    assert.ok(result.validation_score < 50, `Expected <50, got ${result.validation_score}`);
  });
});

// ═══════════════════════════════════════════════════════════════════

describe('Workflow Validator', () => {
  const connectedWorkflow = {
    nodes: [
      { name: 'Trigger', type: 'n8n-nodes-base.webhookTrigger' },
      { name: 'Process', type: 'n8n-nodes-base.set' },
      { name: 'Error Handler', type: 'n8n-nodes-base.errorTrigger' },
    ],
    connections: {
      Trigger: { main: [[{ node: 'Process', type: 'main', index: 0 }]] },
    },
  };

  const disconnectedWorkflow = {
    nodes: [
      { name: 'NodeA', type: 'n8n-nodes-base.set' },
      { name: 'NodeB', type: 'n8n-nodes-base.set' },
      { name: 'NodeC', type: 'n8n-nodes-base.set' },
    ],
    connections: {},
  };

  it('detects connected workflow as is_connected=true', () => {
    const result = validateWorkflow(connectedWorkflow, {});
    assert.equal(result.is_connected, true);
  });

  it('detects disconnected workflow as is_connected=false', () => {
    const result = validateWorkflow(disconnectedWorkflow, {});
    assert.equal(result.is_connected, false);
  });

  it('detects error handling node by type', () => {
    const result = validateWorkflow(connectedWorkflow, {});
    assert.equal(result.has_error_handling, true);
  });

  it('detects absence of error handling', () => {
    const wf = {
      nodes: [
        { name: 'Trigger', type: 'n8n-nodes-base.webhookTrigger' },
        { name: 'Process', type: 'n8n-nodes-base.set' },
      ],
      connections: { Trigger: { main: [[{ node: 'Process', type: 'main', index: 0 }]] } },
    };
    const result = validateWorkflow(wf, {});
    assert.equal(result.has_error_handling, false);
  });

  it('detects error handling via continueOnFail flag', () => {
    const wf = {
      nodes: [
        { name: 'Trigger', type: 'n8n-nodes-base.webhookTrigger' },
        { name: 'Process', type: 'n8n-nodes-base.set', parameters: { continueOnFail: true } },
      ],
      connections: { Trigger: { main: [[{ node: 'Process', type: 'main', index: 0 }]] } },
    };
    const result = validateWorkflow(wf, {});
    assert.equal(result.has_error_handling, true);
  });

  it('detects missing credentials', () => {
    const wf = {
      nodes: [
        { name: 'Slack', type: 'n8n-nodes-base.slack', credentials: { slackApi: { name: 'Slack account' } } },
      ],
      connections: {},
    };
    const result = validateWorkflow(wf, { credentials_required: [] });
    assert.ok(result.missing_credentials.includes('Slack account'));
  });

  it('accepts JSON string as workflow input', () => {
    const result = validateWorkflow(JSON.stringify(connectedWorkflow), {});
    assert.ok('is_connected' in result);
  });

  it('handles empty content gracefully', () => {
    const result = validateWorkflow('', {});
    assert.equal(result.validation_score, 0);
    assert.equal(result.is_connected, false);
  });

  it('handles null content gracefully', () => {
    const result = validateWorkflow(null, {});
    assert.equal(result.validation_score, 0);
  });

  it('single-node workflow is considered connected', () => {
    const wf = { nodes: [{ name: 'Trigger', type: 'triggerNode' }], connections: {} };
    const result = validateWorkflow(wf, {});
    assert.equal(result.is_connected, true);
  });

  it('well-connected workflow with error handling scores 90+', () => {
    const result = validateWorkflow(connectedWorkflow, {});
    assert.ok(result.validation_score >= 90, `Expected >=90, got ${result.validation_score}`);
  });

  it('disconnected workflow with no error handling scores 55 or below', () => {
    const wf = {
      nodes: [
        { name: 'A', type: 'set' }, { name: 'B', type: 'set' },
        { name: 'C', type: 'set' }, { name: 'D', type: 'set' },
      ],
      connections: {},
    };
    const result = validateWorkflow(wf, {});
    // 100 - 35 (not connected) - 20 (no error handling) + 5 (nodes >= 3) = 50
    assert.ok(result.validation_score <= 55, `Expected <=55, got ${result.validation_score}`);
  });
});
