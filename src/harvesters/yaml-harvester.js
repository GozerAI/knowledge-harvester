// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { ArtifactBaseHarvester } from './artifact-base.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { storeArtifact, checkArtifactDuplicate } from '../db/artifact-store.js';
import { createSourceRecordSafely } from '../db/source-record-store.js';
import { normalizeCodePattern } from '../processing/strategies/code-pattern/normalizer.js';
import { normalizeAiMlAsset } from '../processing/strategies/ai-ml-asset/normalizer.js';
import { normalizeApiSpec } from '../processing/strategies/api-spec/normalizer.js';
import { normalizeDataAsset } from '../processing/strategies/data-asset/normalizer.js';
import { normalizeDocumentation } from '../processing/strategies/documentation/normalizer.js';
import { detectLanguage } from '../processing/strategies/code-pattern/normalizer.js';
import { generateContentHash } from '../utils/hash.js';
import { extractNameFromPath } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import pLimit from 'p-limit';
import { parse as parseYaml } from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFINITIONS_DIR = join(__dirname, '..', 'definitions');
const GITHUB_API = 'https://api.github.com';
const CONCURRENCY = 5;
const MAX_PAGES_PER_QUERY = 3;
const WORKFLOW_STEP_KEYS = ['steps', 'tasks', 'actions', 'jobs', 'stages', 'activities', 'blocks', 'pipelines', 'nodes'];
const WORKFLOW_COMPONENT_KEYS = ['type', 'task', 'action', 'uses', 'call', 'connector', 'service', 'plugin', 'kind', 'module'];
const INFRA_PROVIDER_KEYS = ['provider', 'providers', 'runtime', 'cloud', 'platform'];
const INFRA_RESOURCE_KEYS = ['resource', 'resources', 'module', 'modules', 'service', 'services', 'function', 'functions', 'policy', 'policies'];

/**
 * Load and parse a YAML harvester definition.
 *
 * @param {string} filePath - Absolute path to the YAML definition
 * @returns {object} Parsed definition
 */
export function loadDefinition(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const def = parseYaml(content);

  // Validate required fields
  if (!def.name) throw new Error(`Definition missing 'name': ${filePath}`);
  if (!def.artifact_type) throw new Error(`Definition missing 'artifact_type': ${filePath}`);
  if (!def.queries?.length) throw new Error(`Definition missing 'queries': ${filePath}`);

  return def;
}

/**
 * Load all YAML definitions from the definitions directory.
 * @returns {object[]} Array of parsed definitions
 */
export function loadAllDefinitions() {
  let files;
  try {
    files = readdirSync(DEFINITIONS_DIR)
      .filter(f => ['.yaml', '.yml'].includes(extname(f)));
  } catch {
    return [];
  }

  return files.map(f => {
    try {
      return loadDefinition(join(DEFINITIONS_DIR, f));
    } catch (err) {
      logger.warn(`Failed to load definition ${f}`, { error: err.message });
      return null;
    }
  }).filter(Boolean);
}

function parseStructuredContent(content, filename = '') {
  const lower = filename.toLowerCase();
  try {
    if (lower.endsWith('.json')) {
      return JSON.parse(content);
    }
    if (lower.endsWith('.yaml') || lower.endsWith('.yml')) {
      return parseYaml(content);
    }
  } catch {
    return null;
  }
  return null;
}

function collectValuesByKeys(node, keys, values = new Set(), limit = 60) {
  if (!node || values.size >= limit) return values;

  if (Array.isArray(node)) {
    for (const item of node) {
      if (values.size >= limit) break;
      collectValuesByKeys(item, keys, values, limit);
    }
    return values;
  }

  if (typeof node !== 'object') return values;

  for (const [key, value] of Object.entries(node)) {
    const normalizedKey = key.toLowerCase();
    if (keys.includes(normalizedKey)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (values.size >= limit) break;
          if (typeof item === 'string' && item.trim()) values.add(item.trim());
          else if (item && typeof item === 'object') {
            const name = item.name || item.id || item.type || item.kind || item.task;
            if (typeof name === 'string' && name.trim()) values.add(name.trim());
          }
        }
      } else if (value && typeof value === 'object') {
        for (const [nestedKey, nestedValue] of Object.entries(value)) {
          if (values.size >= limit) break;
          if (typeof nestedKey === 'string' && nestedKey.trim()) values.add(nestedKey.trim());
          if (typeof nestedValue === 'string' && nestedValue.trim()) values.add(nestedValue.trim());
        }
      } else if (typeof value === 'string' && value.trim()) {
        values.add(value.trim());
      }
    }
    collectValuesByKeys(value, keys, values, limit);
  }

  return values;
}

function countWorkflowSteps(structured) {
  if (!structured || typeof structured !== 'object') return 0;

  let count = 0;
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      if (WORKFLOW_STEP_KEYS.includes(key.toLowerCase())) {
        if (Array.isArray(value)) count += value.length;
        else if (value && typeof value === 'object') count += Object.keys(value).length;
      }
      visit(value);
    }
  };

  visit(structured);
  return count;
}

function detectTriggerType(content, hasSchedule, hasWebhook) {
  if (hasSchedule) return 'cron';
  if (hasWebhook) return 'webhook';
  if (/\b(event|queue|topic|stream|subscribe|pubsub|trigger)\b/i.test(content)) return 'event';
  return 'programmatic';
}

function buildArtifactName(searchResult, filename) {
  return searchResult?.repository?.full_name
    ? `${searchResult.repository.full_name}/${filename}`
    : extractNameFromPath(filename);
}

function buildArtifactAuthor(searchResult) {
  return {
    username: searchResult?.repository?.owner?.login || null,
    profile_url: searchResult?.repository?.owner?.html_url || null,
  };
}

function extractGenericWorkflowComponents(content, filename) {
  const structured = parseStructuredContent(content, filename);
  const topLevelKeys = structured && typeof structured === 'object' && !Array.isArray(structured)
    ? Object.keys(structured).slice(0, 30)
    : [];
  const components = [
    ...collectValuesByKeys(structured, WORKFLOW_COMPONENT_KEYS),
  ].slice(0, 40);
  const stepCount = countWorkflowSteps(structured)
    || (content.match(/^\s*-\s+(id|name|task|action):/gm) || []).length
    || (content.match(/\b(Task|Choice|Map|Parallel|Pass|Wait|Call|uses:|call:)\b/g) || []).length;
  const hasSchedule = /\b(cron|schedule|interval|timer|every:)\b/i.test(content);
  const hasWebhook = /\b(webhook|https?:\/\/|endpoint|ingress|callback)\b/i.test(content);
  const hasBranches = /\b(choice|branch|condition|switch|parallel|when:|if:|cases:|default:|map:)\b/i.test(content);

  return {
    topLevelKeys,
    components,
    stepCount,
    hasSchedule,
    hasWebhook,
    hasBranches,
    triggerType: detectTriggerType(content, hasSchedule, hasWebhook),
    isStructured: Boolean(structured),
  };
}

function extractGenericInfraComponents(content, filename) {
  const structured = parseStructuredContent(content, filename);
  const topLevelKeys = structured && typeof structured === 'object' && !Array.isArray(structured)
    ? Object.keys(structured).slice(0, 30)
    : [];
  const providerHints = [
    ...collectValuesByKeys(structured, INFRA_PROVIDER_KEYS),
  ].filter(Boolean).slice(0, 20);
  const resourceHints = [
    ...collectValuesByKeys(structured, INFRA_RESOURCE_KEYS),
  ].filter(Boolean).slice(0, 40);

  if (providerHints.length === 0) {
    for (const match of content.match(/\b(pulumi|aws|azure|gcp|google|kubernetes|docker|cloudformation|terraform)\b/gi) || []) {
      if (providerHints.length >= 20) break;
      if (!providerHints.includes(match.toLowerCase())) providerHints.push(match.toLowerCase());
    }
  }
  if (resourceHints.length === 0) {
    for (const match of content.match(/\b(bucket|lambda|queue|topic|table|service|deployment|policy|function|cluster|secret)\b/gi) || []) {
      if (resourceHints.length >= 40) break;
      if (!resourceHints.includes(match.toLowerCase())) resourceHints.push(match.toLowerCase());
    }
  }

  return {
    topLevelKeys,
    providerHints,
    resourceHints,
    resourceCountHint: resourceHints.length,
    hasVariables: /\b(variable|variables|parameter|parameters|config|input)\b/i.test(content),
    hasOutputs: /\b(output|outputs|export|exports)\b/i.test(content),
    hasSecrets: /\b(secret|kms|vault|ssm|keyvault)\b/i.test(content),
    isStructured: Boolean(structured),
  };
}

export function normalizeGenericWorkflowArtifact(definition, rawData) {
  const { searchResult, content, filename, label, language } = rawData;
  const extracted = extractGenericWorkflowComponents(content, filename);
  const detectedLanguage = language || definition.language || detectLanguage(filename);
  const toolType = definition.tool_type || definition.metadata?.framework || definition.name;
  const description = searchResult?.repository?.description || definition.description || '';
  const typeMetadata = {
    workflow_type: toolType,
    pattern_label: label || null,
    step_count: extracted.stepCount,
    trigger_type: extracted.triggerType,
    components: extracted.components,
    component_count: extracted.components.length,
    top_level_keys: extracted.topLevelKeys,
    has_schedule: extracted.hasSchedule,
    has_webhook: extracted.hasWebhook,
    has_branches: extracted.hasBranches,
    is_structured: extracted.isStructured,
    line_count: content.split('\n').length,
  };

  return {
    id: randomUUID(),
    hash: generateContentHash(content, toolType),
    artifact_type: 'workflow',
    source: definition.name,
    source_url: searchResult?.html_url || '',
    source_id: searchResult?.sha || searchResult?.html_url || randomUUID(),
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    content: { source_code: content, filename },
    name: buildArtifactName(searchResult, filename),
    description,
    author: buildArtifactAuthor(searchResult),
    language: detectedLanguage,
    tool_type: toolType,
    tool_metadata: typeMetadata,
    tags: [],
    type_metadata: typeMetadata,
    quality: {
      score: 0,
      has_description: description.length > 0,
      has_documentation: content.length > 200,
      is_complete: extracted.stepCount > 0 || extracted.components.length > 0,
      validation_status: 'valid',
    },
  };
}

export function normalizeGenericInfraConfigArtifact(definition, rawData) {
  const { searchResult, content, filename, label, language } = rawData;
  const extracted = extractGenericInfraComponents(content, filename);
  const detectedLanguage = language || definition.language || detectLanguage(filename);
  const toolType = definition.tool_type || definition.metadata?.framework || definition.name;
  const description = searchResult?.repository?.description || definition.description || '';
  const typeMetadata = {
    config_type: toolType,
    pattern_label: label || null,
    provider_hints: extracted.providerHints,
    resource_hints: extracted.resourceHints,
    resource_count_hint: extracted.resourceCountHint,
    top_level_keys: extracted.topLevelKeys,
    has_variables: extracted.hasVariables,
    has_outputs: extracted.hasOutputs,
    has_secrets: extracted.hasSecrets,
    is_structured: extracted.isStructured,
    line_count: content.split('\n').length,
  };

  return {
    id: randomUUID(),
    hash: generateContentHash(content, toolType),
    artifact_type: 'infra_config',
    source: definition.name,
    source_url: searchResult?.html_url || '',
    source_id: searchResult?.sha || searchResult?.html_url || randomUUID(),
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    content: { source_code: content, filename },
    name: buildArtifactName(searchResult, filename),
    description,
    author: buildArtifactAuthor(searchResult),
    language: detectedLanguage,
    tool_type: toolType,
    tool_metadata: typeMetadata,
    tags: [],
    type_metadata: typeMetadata,
    quality: {
      score: 0,
      has_description: description.length > 0,
      has_documentation: content.length > 120,
      is_complete: extracted.resourceCountHint > 0 || extracted.providerHints.length > 0,
      validation_status: 'valid',
    },
  };
}

/**
 * Generic YAML-driven harvester.
 * Reads a YAML definition and executes GitHub code searches accordingly.
 */
export class YamlHarvester extends ArtifactBaseHarvester {
  /**
   * @param {object} definition - Parsed YAML definition
   */
  constructor(definition) {
    super(
      definition.name,
      definition.artifact_type,
      new RateLimiter({ maxTokens: 10, refillRate: 1, refillIntervalMs: 2500 })
    );
    this.definition = definition;
    this.seenUrls = new Set();
  }

  async _recordSourceDecision(searchResult, {
    decision,
    discardReason = null,
    summary = null,
    metadata = {},
  } = {}) {
    const filename = searchResult?.name || searchResult?.path?.split('/').pop() || null;
    const name = searchResult?.repository?.full_name && filename
      ? `${searchResult.repository.full_name}/${filename}`
      : filename;
    const defaultSummary = [
      name,
      searchResult?.repository?.description || null,
      searchResult?.html_url || null,
    ].filter(Boolean).join(' | ');

    await createSourceRecordSafely({
      source: this.definition.name,
      runId: this.runId,
      sourceUrl: searchResult?.html_url || null,
      sourceId: searchResult?.sha || searchResult?.html_url || null,
      itemName: name,
      itemKind: 'artifact',
      artifactType: this.definition.artifact_type,
      decision,
      summary: summary || defaultSummary,
      discardReason,
      metadata: {
        label: metadata.label || null,
        repository: searchResult?.repository?.full_name || null,
        filename,
        query_label: metadata.label || null,
        ...metadata,
      },
    });
  }

  _headers() {
    return {
      Authorization: `Bearer ${config.github.token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'KnowledgeHarvester/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  async _harvest(signal) {
    if (!config.github.token) {
      logger.warn(`No GITHUB_TOKEN set, skipping YAML harvester: ${this.definition.name}`);
      return;
    }

    for (const { query, label } of this.definition.queries) {
      if (signal.aborted) break;
      logger.info(`[${this.definition.name}] search: "${query}" [${label}]`);

      try {
        await this._searchAndProcess(query, label, signal);
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        logger.error(`[${this.definition.name}] search failed`, { query, error: err.message });
      }

      if (!signal.aborted) {
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  async _searchAndProcess(query, label, signal) {
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= MAX_PAGES_PER_QUERY && !signal.aborted) {
      await this.rateLimiter.acquire();

      const url = `${GITHUB_API}/search/code?q=${encodeURIComponent(query)}&per_page=100&page=${page}`;
      const res = await fetch(url, { headers: this._headers(), signal });

      await this._handleRateLimit(res);

      if (res.status === 403 || res.status === 429) {
        logger.warn('GitHub rate limited, pausing 60s');
        await new Promise(r => setTimeout(r, 60000));
        continue;
      }
      if (res.status === 422) break;
      if (!res.ok) break;

      const data = await res.json();
      const items = data.items || [];
      logger.info(`[${this.definition.name}] page ${page}: ${items.length} items`);

      const limit = pLimit(CONCURRENCY);
      const tasks = items
        .filter(item => !this.seenUrls.has(item.html_url))
        .map(item => limit(async () => {
          if (signal.aborted) return;
          this.seenUrls.add(item.html_url);
          await this.rateLimiter.acquire();
          try {
            await this._processFile(item, label, signal);
            this.resetConsecutiveErrors();
          } catch (err) {
            if (err.name === 'AbortError') throw err;
            this.recordError(err);
          }
        }));
      await Promise.all(tasks);

      hasMore = items.length === 100;
      page++;
      if (hasMore && !signal.aborted) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  async _handleRateLimit(res) {
    const remaining = parseInt(res.headers.get('x-ratelimit-remaining') || '999');
    if (remaining < 50) {
      const resetEpoch = parseInt(res.headers.get('x-ratelimit-reset') || '0') * 1000;
      const waitMs = Math.max(resetEpoch - Date.now() + 5000, 30000);
      logger.warn(`GitHub rate limit low (${remaining}), waiting ${Math.round(waitMs / 1000)}s`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }

  async _processFile(searchResult, label, signal) {
    if (!searchResult.download_url) {
      this.stats.invalid++;
      await this._recordSourceDecision(searchResult, {
        decision: 'discarded',
        discardReason: 'missing_download_url',
        metadata: { label },
      });
      return;
    }

    const res = await fetch(searchResult.download_url, {
      headers: this._headers(),
      signal,
    });
    if (!res.ok) {
      this.stats.invalid++;
      await this._recordSourceDecision(searchResult, {
        decision: 'discarded',
        discardReason: `download_failed_${res.status}`,
        metadata: { label, status: res.status },
      });
      return;
    }

    const text = await res.text();
    const validation = this.definition.validation || {};

    // Size validation
    if (text.length > (validation.max_size || 500000) || text.length < (validation.min_size || 50)) {
      this.stats.invalid++;
      await this._recordSourceDecision(searchResult, {
        decision: 'discarded',
        discardReason: 'failed_size_validation',
        metadata: { label, size: text.length },
      });
      return;
    }

    // Extension validation
    if (validation.extensions?.length) {
      const ext = searchResult.name?.split('.').pop()?.toLowerCase();
      if (!validation.extensions.includes(ext)) {
        this.stats.invalid++;
        await this._recordSourceDecision(searchResult, {
          decision: 'discarded',
          discardReason: 'failed_extension_validation',
          metadata: { label, extension: ext },
        });
        return;
      }
    }

    // Required patterns validation
    if (validation.required_patterns?.length) {
      const allMatch = validation.required_patterns.every(p => new RegExp(p).test(text));
      if (!allMatch) {
        this.stats.invalid++;
        await this._recordSourceDecision(searchResult, {
          decision: 'discarded',
          discardReason: 'failed_pattern_validation',
          metadata: { label },
        });
        return;
      }
    }

    this.stats.discovered++;

    // Normalize based on artifact type
    const normalized = this._normalize(searchResult, text, label);
    normalized.runId = this.runId;

    const { isDuplicate } = await checkArtifactDuplicate(
      normalized.hash, normalized.source, normalized.source_id
    );
    if (isDuplicate) {
      this.stats.duplicate++;
      await this._recordSourceDecision(searchResult, {
        decision: 'duplicate',
        discardReason: 'duplicate_artifact',
        summary: normalized.name,
        metadata: {
          label,
          content_hash: normalized.hash,
          normalized_name: normalized.name,
        },
      });
      return;
    }

    await storeArtifact(normalized);
    this.stats.new++;
    logger.debug(`[${this.definition.name}] stored`, {
      name: normalized.name,
      repo: searchResult.repository?.full_name,
    });
  }

  _normalize(searchResult, content, label) {
    const rawData = {
      searchResult,
      content,
      filename: searchResult.name || searchResult.path?.split('/').pop() || '',
      label,
      language: this.definition.language,
    };

    switch (this.definition.artifact_type) {
      case 'code_pattern':
        return normalizeCodePattern(this.definition.name, rawData);
      case 'ai_ml_asset':
        return normalizeAiMlAsset(this.definition.name, rawData);
      case 'api_spec':
        return normalizeApiSpec(this.definition.name, rawData);
      case 'data_asset':
        return normalizeDataAsset(this.definition.name, rawData);
      case 'documentation':
        return normalizeDocumentation(this.definition.name, rawData);
      case 'workflow':
        return normalizeGenericWorkflowArtifact(this.definition, rawData);
      case 'infra_config':
        return normalizeGenericInfraConfigArtifact(this.definition, rawData);
      default:
        return normalizeCodePattern(this.definition.name, rawData);
    }
  }
}

/**
 * Create YamlHarvester instances from all definitions in the definitions directory.
 * @returns {YamlHarvester[]}
 */
export function createYamlHarvesters() {
  const definitions = loadAllDefinitions();
  return definitions.map(def => new YamlHarvester(def));
}
