// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { randomUUID } from 'node:crypto';
import { generateContentHash } from '../../../utils/hash.js';
import { extractNameFromPath } from '../../../utils/helpers.js';

/**
 * Normalize raw API spec data into the unified artifact schema.
 *
 * @param {string} source - Source identifier
 * @param {object} rawData - { searchResult, content, filename, label, language }
 * @returns {object} Normalized artifact for storeArtifact()
 */
export function normalizeApiSpec(source, rawData) {
  const { searchResult, content, filename } = rawData;
  const specType = detectSpecType(content, filename);

  let components;
  switch (specType) {
    case 'openapi':  components = extractOpenApiComponents(content); break;
    case 'graphql':  components = extractGraphQLComponents(content); break;
    case 'grpc':     components = extractGrpcComponents(content); break;
    case 'asyncapi': components = extractAsyncApiComponents(content); break;
    default:         components = extractGenericApiComponents(content); break;
  }

  const name = searchResult?.repository?.full_name
    ? `${searchResult.repository.full_name}/${filename}`
    : extractNameFromPath(filename);
  const description = searchResult?.repository?.description || '';

  return {
    id: randomUUID(),
    hash: generateContentHash(content, 'api_spec'),
    artifact_type: 'api_spec',
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
    language: specType === 'grpc' ? 'protobuf' : specType === 'graphql' ? 'graphql' : 'yaml',
    tool_type: specType,
    tool_metadata: { spec_type: specType },
    tags: [],
    type_metadata: {
      spec_type: specType,
      ...components,
    },
    quality: {
      score: 0,
      has_description: description.length > 0,
      has_documentation: components.hasDescriptions || false,
      is_complete: true,
      validation_status: 'valid',
    },
  };
}

/**
 * Detect the API specification type from content and filename.
 */
export function detectSpecType(content, filename) {
  const name = (filename || '').toLowerCase();

  if (name.endsWith('.proto')) return 'grpc';
  if (name.endsWith('.graphql') || name.endsWith('.gql')) return 'graphql';

  if (/openapi['":\s]+['"]*3\./i.test(content) || /swagger['":\s]+['"]*2\./i.test(content)) {
    return 'openapi';
  }
  if (/asyncapi['":\s]+['"]*[23]\./i.test(content)) return 'asyncapi';
  if (/\btype\s+Query\b/.test(content) || /\bschema\s*\{/.test(content)) return 'graphql';
  if (/\bsyntax\s*=\s*"proto[23]"/.test(content)) return 'grpc';
  if (/\bpaths:/.test(content) && /\binfo:/.test(content)) return 'openapi';

  return 'unknown';
}

/**
 * Extract OpenAPI/Swagger components.
 */
export function extractOpenApiComponents(content) {
  const version = content.match(/openapi['":\s]+['"]*(\d+\.\d+)/i)?.[1]
    || content.match(/swagger['":\s]+['"]*(\d+\.\d+)/i)?.[1]
    || 'unknown';

  const title = content.match(/title:\s*['"]?([^'"\n]+)/)?.[1]?.trim() || null;

  // Extract paths/endpoints
  const endpoints = [];
  const pathMatches = content.match(/^\s{2}\/[^\s:]+:/gm) || [];
  for (const p of pathMatches) {
    endpoints.push(p.trim().replace(':', ''));
  }

  // HTTP methods
  const methods = new Set();
  const methodMatches = content.match(/^\s{4}(get|post|put|patch|delete|head|options):/gm) || [];
  for (const m of methodMatches) {
    methods.add(m.trim().replace(':', ''));
  }

  // Schemas/components
  const schemas = [];
  const schemaMatches = content.match(/^\s{4}(\w+):\s*$/gm) || [];
  // Only count if we're in a schemas section
  if (/\bschemas:/.test(content)) {
    const schemaSection = content.match(/schemas:\s*\n([\s\S]*?)(?=\n\s{2}\w|\Z)/);
    if (schemaSection) {
      const names = schemaSection[1].match(/^\s{4}(\w+):/gm) || [];
      for (const n of names) {
        schemas.push(n.trim().replace(':', ''));
      }
    }
  }

  // Security schemes
  const securitySchemes = [];
  if (/securitySchemes:/.test(content)) {
    const secMatches = content.match(/^\s{6}(\w+):/gm) || [];
    for (const s of secMatches) {
      securitySchemes.push(s.trim().replace(':', ''));
    }
  }

  // Check for descriptions
  const hasDescriptions = /description:\s*\S/.test(content);

  return {
    api_version: version,
    api_title: title,
    endpoints: [...new Set(endpoints)].slice(0, 50),
    endpoint_count: endpoints.length,
    methods: [...methods],
    method_count: methods.size,
    schemas: [...new Set(schemas)].slice(0, 50),
    schema_count: schemas.length,
    security_schemes: securitySchemes,
    has_security: securitySchemes.length > 0,
    hasDescriptions,
    has_examples: /example[s]?:/i.test(content),
    has_parameters: /parameters:/i.test(content),
  };
}

/**
 * Extract GraphQL schema components.
 */
export function extractGraphQLComponents(content) {
  const types = [];
  const typeMatches = content.match(/\btype\s+(\w+)/g) || [];
  for (const m of typeMatches) {
    const t = m.match(/type\s+(\w+)/)?.[1];
    if (t && !['Query', 'Mutation', 'Subscription'].includes(t)) types.push(t);
  }

  const queries = [];
  const querySection = content.match(/type\s+Query\s*\{([\s\S]*?)\}/);
  if (querySection) {
    const qMatches = querySection[1].match(/^\s+(\w+)/gm) || [];
    for (const q of qMatches) {
      queries.push(q.trim());
    }
  }

  const mutations = [];
  const mutationSection = content.match(/type\s+Mutation\s*\{([\s\S]*?)\}/);
  if (mutationSection) {
    const mMatches = mutationSection[1].match(/^\s+(\w+)/gm) || [];
    for (const m of mMatches) {
      mutations.push(m.trim());
    }
  }

  const subscriptions = [];
  const subSection = content.match(/type\s+Subscription\s*\{([\s\S]*?)\}/);
  if (subSection) {
    const sMatches = subSection[1].match(/^\s+(\w+)/gm) || [];
    for (const s of sMatches) {
      subscriptions.push(s.trim());
    }
  }

  const inputs = [];
  const inputMatches = content.match(/\binput\s+(\w+)/g) || [];
  for (const m of inputMatches) {
    const i = m.match(/input\s+(\w+)/)?.[1];
    if (i) inputs.push(i);
  }

  const enums = [];
  const enumMatches = content.match(/\benum\s+(\w+)/g) || [];
  for (const m of enumMatches) {
    const e = m.match(/enum\s+(\w+)/)?.[1];
    if (e) enums.push(e);
  }

  const hasDescriptions = /"""[\s\S]*?"""/.test(content) || /#\s+\w/.test(content);

  return {
    types: [...new Set(types)].slice(0, 50),
    type_count: types.length,
    queries: queries.slice(0, 30),
    query_count: queries.length,
    mutations: mutations.slice(0, 30),
    mutation_count: mutations.length,
    subscriptions: subscriptions.slice(0, 10),
    subscription_count: subscriptions.length,
    inputs: [...new Set(inputs)].slice(0, 30),
    enums: [...new Set(enums)].slice(0, 20),
    has_directives: /@\w+/.test(content),
    hasDescriptions,
  };
}

/**
 * Extract gRPC proto components.
 */
export function extractGrpcComponents(content) {
  const syntax = content.match(/syntax\s*=\s*"(proto\d)"/)?.[1] || 'proto3';
  const packageName = content.match(/package\s+([\w.]+)/)?.[1] || null;

  const services = [];
  const serviceMatches = content.match(/\bservice\s+(\w+)/g) || [];
  for (const m of serviceMatches) {
    const s = m.match(/service\s+(\w+)/)?.[1];
    if (s) services.push(s);
  }

  const rpcs = [];
  const rpcMatches = content.match(/\brpc\s+(\w+)/g) || [];
  for (const m of rpcMatches) {
    const r = m.match(/rpc\s+(\w+)/)?.[1];
    if (r) rpcs.push(r);
  }

  const messages = [];
  const msgMatches = content.match(/\bmessage\s+(\w+)/g) || [];
  for (const m of msgMatches) {
    const msg = m.match(/message\s+(\w+)/)?.[1];
    if (msg) messages.push(msg);
  }

  const enums = [];
  const enumMatches = content.match(/\benum\s+(\w+)/g) || [];
  for (const m of enumMatches) {
    const e = m.match(/enum\s+(\w+)/)?.[1];
    if (e) enums.push(e);
  }

  const imports = [];
  const importMatches = content.match(/import\s+"([^"]+)"/g) || [];
  for (const m of importMatches) {
    const i = m.match(/"([^"]+)"/)?.[1];
    if (i) imports.push(i);
  }

  const hasDescriptions = /\/\/\s+\w/.test(content);
  const hasStreaming = /\bstream\s+\w/.test(content);

  return {
    syntax,
    package: packageName,
    services: [...new Set(services)],
    service_count: services.length,
    rpcs: rpcs.slice(0, 50),
    rpc_count: rpcs.length,
    messages: [...new Set(messages)].slice(0, 50),
    message_count: messages.length,
    enums: [...new Set(enums)],
    imports,
    has_streaming: hasStreaming,
    hasDescriptions,
  };
}

/**
 * Extract AsyncAPI components.
 */
export function extractAsyncApiComponents(content) {
  const version = content.match(/asyncapi['":\s]+['"]*(\d+\.\d+)/i)?.[1] || 'unknown';
  const title = content.match(/title:\s*['"]?([^'"\n]+)/)?.[1]?.trim() || null;

  const channels = [];
  const channelSection = content.match(/channels:\s*\n([\s\S]*?)(?=\n\w|\Z)/);
  if (channelSection) {
    const chMatches = channelSection[1].match(/^\s{2}[\w/]+:/gm) || [];
    for (const c of chMatches) {
      channels.push(c.trim().replace(':', ''));
    }
  }

  const hasPublish = /publish:/i.test(content);
  const hasSubscribe = /subscribe:/i.test(content);
  const hasDescriptions = /description:\s*\S/.test(content);

  return {
    api_version: version,
    api_title: title,
    channels: channels.slice(0, 30),
    channel_count: channels.length,
    has_publish: hasPublish,
    has_subscribe: hasSubscribe,
    hasDescriptions,
  };
}

/**
 * Extract generic API components.
 */
function extractGenericApiComponents(content) {
  return {
    hasDescriptions: /description:\s*\S/.test(content),
  };
}
