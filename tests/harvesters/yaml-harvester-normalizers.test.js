// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeGenericWorkflowArtifact,
  normalizeGenericInfraConfigArtifact,
} from '../../src/harvesters/yaml-harvester.js';

describe('yaml harvester generic normalizers', () => {
  it('normalizes generic workflow artifacts for structured orchestration sources', () => {
    const definition = {
      name: 'aws-step-functions',
      description: 'AWS state machines',
      artifact_type: 'workflow',
      tool_type: 'step-functions',
      language: 'json',
      metadata: { framework: 'step-functions' },
    };
    const artifact = normalizeGenericWorkflowArtifact(definition, {
      searchResult: {
        html_url: 'https://github.com/acme/orders/blob/main/workflow.json',
        sha: 'abc123',
        repository: {
          full_name: 'acme/orders',
          description: 'Order automation',
          owner: { login: 'acme', html_url: 'https://github.com/acme' },
        },
      },
      content: JSON.stringify({
        StartAt: 'FetchOrder',
        States: {
          FetchOrder: { Type: 'Task', Next: 'PersistOrder' },
          PersistOrder: { Type: 'Task', End: true },
        },
      }, null, 2),
      filename: 'workflow.json',
      label: 'step-functions-task',
      language: 'json',
    });

    assert.equal(artifact.artifact_type, 'workflow');
    assert.equal(artifact.source, 'aws-step-functions');
    assert.equal(artifact.tool_type, 'step-functions');
    assert.equal(artifact.type_metadata.step_count, 2);
    assert.equal(artifact.type_metadata.trigger_type, 'programmatic');
    assert.ok(artifact.type_metadata.components.includes('Task'));
    assert.ok(artifact.name.includes('acme/orders'));
  });

  it('normalizes generic infra artifacts for programmable cloud sources', () => {
    const definition = {
      name: 'pulumi-programs',
      description: 'Pulumi cloud programs',
      artifact_type: 'infra_config',
      tool_type: 'pulumi',
      language: 'typescript',
      metadata: { framework: 'pulumi' },
    };
    const artifact = normalizeGenericInfraConfigArtifact(definition, {
      searchResult: {
        html_url: 'https://github.com/acme/platform/blob/main/index.ts',
        sha: 'def456',
        repository: {
          full_name: 'acme/platform',
          description: 'Platform infrastructure',
          owner: { login: 'acme', html_url: 'https://github.com/acme' },
        },
      },
      content: [
        'import * as pulumi from "@pulumi/pulumi";',
        'import * as aws from "@pulumi/aws";',
        'const bucket = new aws.s3.Bucket("assets");',
        'export const bucketName = bucket.id;',
      ].join('\n'),
      filename: 'index.ts',
      label: 'pulumi-aws',
      language: 'typescript',
    });

    assert.equal(artifact.artifact_type, 'infra_config');
    assert.equal(artifact.source, 'pulumi-programs');
    assert.equal(artifact.tool_type, 'pulumi');
    assert.ok(artifact.type_metadata.provider_hints.includes('pulumi'));
    assert.ok(artifact.type_metadata.resource_hints.includes('bucket'));
    assert.equal(artifact.type_metadata.has_outputs, true);
    assert.ok(artifact.name.includes('acme/platform'));
  });
});
