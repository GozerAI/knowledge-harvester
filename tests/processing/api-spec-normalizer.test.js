// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Re-implement pure extractors for testing ──

function detectSpecType(content, filename) {
  const name = (filename || '').toLowerCase();
  if (name.endsWith('.proto')) return 'grpc';
  if (name.endsWith('.graphql') || name.endsWith('.gql')) return 'graphql';
  if (/openapi['":\s]+['"]*3\./i.test(content) || /swagger['":\s]+['"]*2\./i.test(content)) return 'openapi';
  if (/asyncapi['":\s]+['"]*[23]\./i.test(content)) return 'asyncapi';
  if (/\btype\s+Query\b/.test(content) || /\bschema\s*\{/.test(content)) return 'graphql';
  if (/\bsyntax\s*=\s*"proto[23]"/.test(content)) return 'grpc';
  if (/\bpaths:/.test(content) && /\binfo:/.test(content)) return 'openapi';
  return 'unknown';
}

function extractOpenApiComponents(content) {
  const version = content.match(/openapi['":\s]+['"]*(\d+\.\d+)/i)?.[1]
    || content.match(/swagger['":\s]+['"]*(\d+\.\d+)/i)?.[1] || 'unknown';
  const title = content.match(/title:\s*['"]?([^'"\n]+)/)?.[1]?.trim() || null;
  const endpoints = [];
  const pathMatches = content.match(/^\s{2}\/[^\s:]+:/gm) || [];
  for (const p of pathMatches) endpoints.push(p.trim().replace(':', ''));
  const methods = new Set();
  const methodMatches = content.match(/^\s{4}(get|post|put|patch|delete|head|options):/gm) || [];
  for (const m of methodMatches) methods.add(m.trim().replace(':', ''));
  const hasDescriptions = /description:\s*\S/.test(content);
  const hasExamples = /example[s]?:/i.test(content);
  const hasParameters = /parameters:/i.test(content);
  return {
    api_version: version, api_title: title,
    endpoints: [...new Set(endpoints)], endpoint_count: endpoints.length,
    methods: [...methods], method_count: methods.size,
    hasDescriptions, has_examples: hasExamples, has_parameters: hasParameters,
  };
}

function extractGraphQLComponents(content) {
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
    for (const q of qMatches) queries.push(q.trim());
  }
  const mutations = [];
  const mutationSection = content.match(/type\s+Mutation\s*\{([\s\S]*?)\}/);
  if (mutationSection) {
    const mMatches = mutationSection[1].match(/^\s+(\w+)/gm) || [];
    for (const m of mMatches) mutations.push(m.trim());
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
  return {
    types, type_count: types.length, queries, query_count: queries.length,
    mutations, mutation_count: mutations.length, inputs, enums,
    has_directives: /@\w+/.test(content),
  };
}

function extractGrpcComponents(content) {
  const syntax = content.match(/syntax\s*=\s*"(proto\d)"/)?.[1] || 'proto3';
  const packageName = content.match(/package\s+([\w.]+)/)?.[1] || null;
  const services = [];
  const svcMatches = content.match(/\bservice\s+(\w+)/g) || [];
  for (const m of svcMatches) {
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
  const hasStreaming = /\bstream\s+\w/.test(content);
  return {
    syntax, package: packageName, services, service_count: services.length,
    rpcs, rpc_count: rpcs.length, messages, message_count: messages.length,
    has_streaming: hasStreaming,
  };
}

function calculateApiSpecScore(row, meta) {
  let score = 0;
  if (row.name && !row.name.includes('Untitled')) score += 8;
  if (row.description?.length > 20) score += 8;
  if (meta.api_title) score += 9;
  const eCount = meta.endpoint_count || meta.query_count || meta.rpc_count || 0;
  if (eCount >= 1) score += 5;
  if (eCount >= 5) score += 5;
  if (eCount >= 10) score += 5;
  if (eCount >= 20) score += 5;
  const sCount = meta.schema_count || meta.type_count || meta.message_count || 0;
  if (sCount >= 1) score += 5;
  if (sCount >= 5) score += 5;
  if (meta.has_security) score += 8;
  if (meta.has_examples) score += 5;
  if (meta.has_parameters) score += 4;
  if (meta.has_streaming) score += 4;
  if (meta.hasDescriptions) score += 10;
  const mCount = meta.method_count || 0;
  if (mCount >= 2) score += 5;
  if (mCount >= 4) score += 5;
  return Math.min(score, 100);
}

function getDefaultApiCategory(meta) {
  const defaults = { openapi: 'rest-api', graphql: 'graphql-api', grpc: 'grpc-api', asyncapi: 'event-driven-api' };
  return defaults[meta?.spec_type] || 'general-api';
}

// ── Tests ──

describe('detectSpecType', () => {
  it('detects OpenAPI from content', () => {
    assert.equal(detectSpecType('openapi: 3.0.0\ninfo:\n  title: Test', 'api.yaml'), 'openapi');
  });

  it('detects Swagger from content', () => {
    assert.equal(detectSpecType('swagger: 2.0\ninfo:', 'api.yaml'), 'openapi');
  });

  it('detects GraphQL from extension', () => {
    assert.equal(detectSpecType('type Query { users: [User] }', 'schema.graphql'), 'graphql');
    assert.equal(detectSpecType('type Query {}', 'schema.gql'), 'graphql');
  });

  it('detects GraphQL from content', () => {
    assert.equal(detectSpecType('type Query {\n  users: [User]\n}', 'schema.txt'), 'graphql');
  });

  it('detects gRPC from extension', () => {
    assert.equal(detectSpecType('syntax = "proto3";', 'service.proto'), 'grpc');
  });

  it('detects gRPC from content', () => {
    assert.equal(detectSpecType('syntax = "proto3";\npackage api;', 'api.txt'), 'grpc');
  });

  it('detects AsyncAPI', () => {
    assert.equal(detectSpecType('asyncapi: 2.0.0\ninfo:', 'api.yaml'), 'asyncapi');
  });

  it('detects OpenAPI from paths+info', () => {
    assert.equal(detectSpecType('info:\n  title: API\npaths:\n  /users:', 'spec.yaml'), 'openapi');
  });

  it('returns unknown for unrecognized', () => {
    assert.equal(detectSpecType('just some text', 'readme.md'), 'unknown');
  });
});

describe('extractOpenApiComponents', () => {
  it('extracts API version and title', () => {
    const content = `openapi: 3.0.0
info:
  title: User API
  description: User management
paths:
  /users:
    get:
      description: List users
    post:
      description: Create user
  /users/{id}:
    get:
      description: Get user
    put:
      description: Update user
    delete:
      description: Delete user`;
    const result = extractOpenApiComponents(content);
    assert.equal(result.api_version, '3.0');
    assert.equal(result.api_title, 'User API');
    assert.equal(result.endpoint_count, 2);
    assert.ok(result.methods.includes('get'));
    assert.ok(result.methods.includes('post'));
    assert.ok(result.hasDescriptions);
  });

  it('detects examples and parameters', () => {
    const content = `openapi: 3.0.0
info:
  title: API
paths:
  /items:
    get:
      parameters:
        - name: limit
      examples:
        default:
          value: 10`;
    const result = extractOpenApiComponents(content);
    assert.ok(result.has_examples);
    assert.ok(result.has_parameters);
  });
});

describe('extractGraphQLComponents', () => {
  it('extracts types, queries, and mutations', () => {
    const content = `
type User {
  id: ID!
  name: String!
}

type Post {
  title: String!
}

input CreateUserInput {
  name: String!
}

enum Role {
  ADMIN
  USER
}

type Query {
  users: [User]
  user(id: ID!): User
}

type Mutation {
  createUser(input: CreateUserInput!): User
}`;
    const result = extractGraphQLComponents(content);
    assert.ok(result.types.includes('User'));
    assert.ok(result.types.includes('Post'));
    assert.ok(!result.types.includes('Query'));
    assert.equal(result.query_count, 2);
    assert.equal(result.mutation_count, 1);
    assert.ok(result.inputs.includes('CreateUserInput'));
    assert.ok(result.enums.includes('Role'));
  });
});

describe('extractGrpcComponents', () => {
  it('extracts services, rpcs, and messages', () => {
    const content = `
syntax = "proto3";
package user.v1;

service UserService {
  rpc GetUser(GetUserRequest) returns (User);
  rpc ListUsers(ListUsersRequest) returns (stream User);
  rpc CreateUser(CreateUserRequest) returns (User);
}

message User {
  string id = 1;
  string name = 2;
}

message GetUserRequest {
  string id = 1;
}`;
    const result = extractGrpcComponents(content);
    assert.equal(result.syntax, 'proto3');
    assert.equal(result.package, 'user.v1');
    assert.ok(result.services.includes('UserService'));
    assert.equal(result.rpc_count, 3);
    assert.ok(result.messages.includes('User'));
    assert.ok(result.messages.includes('GetUserRequest'));
    assert.ok(result.has_streaming);
  });
});

describe('calculateApiSpecScore', () => {
  it('scores high for comprehensive OpenAPI spec', () => {
    const row = { name: 'user-api', description: 'Complete user management API with auth and CRUD' };
    const meta = {
      api_title: 'User API', endpoint_count: 15, schema_count: 8,
      method_count: 5, has_security: true, has_examples: true,
      has_parameters: true, hasDescriptions: true,
    };
    const score = calculateApiSpecScore(row, meta);
    assert.ok(score >= 80, `Expected >= 80, got ${score}`);
  });

  it('scores low for minimal spec', () => {
    const row = { name: 'Untitled', description: '' };
    const meta = { endpoint_count: 0 };
    const score = calculateApiSpecScore(row, meta);
    assert.ok(score < 15, `Expected < 15, got ${score}`);
  });
});

describe('getDefaultApiCategory', () => {
  it('maps spec types to categories', () => {
    assert.equal(getDefaultApiCategory({ spec_type: 'openapi' }), 'rest-api');
    assert.equal(getDefaultApiCategory({ spec_type: 'graphql' }), 'graphql-api');
    assert.equal(getDefaultApiCategory({ spec_type: 'grpc' }), 'grpc-api');
    assert.equal(getDefaultApiCategory({ spec_type: 'asyncapi' }), 'event-driven-api');
  });

  it('defaults to general-api', () => {
    assert.equal(getDefaultApiCategory({}), 'general-api');
  });
});
