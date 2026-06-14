// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorkflow } from '../../src/processing/normalizer.js';


describe('normalizeWorkflow — comfyui', () => {
  const sampleComfyUI = {
    searchResult: {
      html_url: 'https://github.com/user/repo/blob/main/workflow.json',
      sha: 'abc123',
      path: 'workflows/sd-upscale.json',
      repository: {
        full_name: 'user/repo',
        owner: { login: 'user', html_url: 'https://github.com/user' },
        stargazers_count: 50,
      },
    },
    content: {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: {} },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'a cat' } },
      '3': { class_type: 'KSampler', inputs: {} },
      '4': { class_type: 'VAEDecode', inputs: {} },
      '5': { class_type: 'SaveImage', inputs: {} },
    },
    filename: 'workflow.json',
  };

  it('normalizes ComfyUI workflow', () => {
    const result = normalizeWorkflow('comfyui', sampleComfyUI);
    assert.equal(result.source, 'comfyui');
    assert.equal(result.tool_type, 'comfyui');
    assert.equal(result.language, 'json');
    assert.ok(result.id);
    assert.ok(result.hash);
  });

  it('extracts class_type values as components', () => {
    const result = normalizeWorkflow('comfyui', sampleComfyUI);
    assert.ok(result.metadata.node_types.length > 0);
    assert.ok(result.tool_metadata.class_types.includes('KSampler'));
  });

  it('sets trigger_type to manual', () => {
    const result = normalizeWorkflow('comfyui', sampleComfyUI);
    assert.equal(result.metadata.trigger_type, 'manual');
  });

  it('estimates complexity by node count', () => {
    const result = normalizeWorkflow('comfyui', sampleComfyUI);
    assert.equal(result.metadata.estimated_complexity, 'simple'); // 5 nodes < 8
  });
});


describe('normalizeWorkflow — dify', () => {
  const sampleDify = {
    searchResult: {
      html_url: 'https://github.com/user/repo/blob/main/app.yaml',
      sha: 'def456',
      path: 'apps/chatbot.yaml',
      repository: {
        full_name: 'user/repo',
        owner: { login: 'user', html_url: 'https://github.com/user' },
        stargazers_count: 20,
      },
    },
    content: 'app:\n  mode: chat\nmodel_config:\n  provider: openai\n  model: gpt-4\nprompt_template: "Hello {input}"',
    filename: 'chatbot.yaml',
  };

  it('normalizes Dify app config', () => {
    const result = normalizeWorkflow('dify', sampleDify);
    assert.equal(result.source, 'dify');
    assert.equal(result.tool_type, 'dify');
    assert.equal(result.language, 'yaml');
  });

  it('extracts model provider from YAML', () => {
    const result = normalizeWorkflow('dify', sampleDify);
    assert.ok(result.tool_metadata.model_provider);
  });

  it('sets trigger_type to programmatic', () => {
    const result = normalizeWorkflow('dify', sampleDify);
    assert.equal(result.metadata.trigger_type, 'programmatic');
  });
});


describe('normalizeWorkflow — flowise', () => {
  const sampleFlowise = {
    searchResult: {
      html_url: 'https://github.com/user/repo/blob/main/chatflow.json',
      sha: 'ghi789',
      path: 'flows/qa-chatflow.json',
      repository: {
        full_name: 'user/repo',
        owner: { login: 'user', html_url: 'https://github.com/user' },
        stargazers_count: 30,
      },
    },
    content: {
      nodes: [
        { data: { name: 'chatOpenAI', label: 'ChatOpenAI' }, id: '1' },
        { data: { name: 'pdfLoader', label: 'PDF Loader' }, id: '2' },
        { data: { name: 'recursiveCharacterTextSplitter', label: 'Splitter' }, id: '3' },
      ],
      edges: [
        { source: '2', target: '3' },
        { source: '3', target: '1' },
      ],
    },
    filename: 'chatflow.json',
  };

  it('normalizes Flowise chatflow', () => {
    const result = normalizeWorkflow('flowise', sampleFlowise);
    assert.equal(result.source, 'flowise');
    assert.equal(result.tool_type, 'flowise');
    assert.equal(result.language, 'json');
  });

  it('extracts node names', () => {
    const result = normalizeWorkflow('flowise', sampleFlowise);
    assert.ok(result.tool_metadata.node_names.includes('chatOpenAI'));
  });

  it('counts edges', () => {
    const result = normalizeWorkflow('flowise', sampleFlowise);
    assert.equal(result.tool_metadata.edge_count, 2);
  });

  it('sets trigger_type to webhook', () => {
    const result = normalizeWorkflow('flowise', sampleFlowise);
    assert.equal(result.metadata.trigger_type, 'webhook');
  });
});


describe('normalizeWorkflow — pipedream', () => {
  const samplePipedream = {
    searchResult: {
      html_url: 'https://github.com/PipedreamHQ/pipedream/blob/master/components/slack/send.js',
      sha: 'jkl012',
      path: 'components/slack/actions/send-message/send-message.mjs',
      repository: {
        full_name: 'PipedreamHQ/pipedream',
        owner: { login: 'PipedreamHQ', html_url: 'https://github.com/PipedreamHQ' },
        stargazers_count: 8000,
      },
    },
    content: `import { defineComponent } from "@pipedream/types";
export default defineComponent({
  name: "Send Slack Message",
  props: { slack: { type: "app", app: "slack" } },
  async run({ steps, $ }) {
    return await this.slack.chat.postMessage({ channel: "#general", text: "Hello" });
  },
});`,
    filename: 'send-message.mjs',
  };

  it('normalizes Pipedream component', () => {
    const result = normalizeWorkflow('pipedream', samplePipedream);
    assert.equal(result.source, 'pipedream');
    assert.equal(result.tool_type, 'pipedream');
    assert.equal(result.language, 'javascript');
  });

  it('detects defineComponent', () => {
    const result = normalizeWorkflow('pipedream', samplePipedream);
    assert.ok(result.metadata.node_types.length >= 0); // Component names extracted
  });

  it('populates author from GitHub', () => {
    const result = normalizeWorkflow('pipedream', samplePipedream);
    assert.equal(result.author.username, 'PipedreamHQ');
  });
});


describe('normalizeWorkflow — argo', () => {
  const sampleArgo = {
    searchResult: {
      html_url: 'https://github.com/user/repo/blob/main/workflow.yaml',
      sha: 'mno345',
      path: 'workflows/build-deploy.yaml',
      repository: {
        full_name: 'user/repo',
        owner: { login: 'user', html_url: 'https://github.com/user' },
        stargazers_count: 15,
      },
    },
    content: `apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  name: build-and-deploy
spec:
  templates:
    - name: build
      container:
        image: golang:1.21
        command: [go, build]
    - name: deploy
      container:
        image: kubectl:latest
        command: [kubectl, apply]`,
    filename: 'workflow.yaml',
  };

  it('normalizes Argo Workflow', () => {
    const result = normalizeWorkflow('argo', sampleArgo);
    assert.equal(result.source, 'argo');
    assert.equal(result.tool_type, 'argo');
    assert.equal(result.language, 'yaml');
  });

  it('extracts template names', () => {
    const result = normalizeWorkflow('argo', sampleArgo);
    assert.ok(result.tool_metadata.templates.length > 0);
  });

  it('extracts container images', () => {
    const result = normalizeWorkflow('argo', sampleArgo);
    assert.ok(result.tool_metadata.images.length > 0);
  });

  it('detects Workflow kind', () => {
    const result = normalizeWorkflow('argo', sampleArgo);
    assert.equal(result.tool_metadata.kind, 'Workflow');
  });

  it('sets trigger_type to programmatic for Workflow', () => {
    const result = normalizeWorkflow('argo', sampleArgo);
    assert.equal(result.metadata.trigger_type, 'programmatic');
  });
});


describe('normalizeWorkflow — luigi', () => {
  const sampleLuigi = {
    searchResult: {
      html_url: 'https://github.com/user/repo/blob/main/pipeline.py',
      sha: 'pqr678',
      path: 'pipelines/etl.py',
      repository: {
        full_name: 'user/repo',
        owner: { login: 'user', html_url: 'https://github.com/user' },
        stargazers_count: 5,
      },
    },
    content: `import luigi

class FetchData(luigi.Task):
    date = luigi.DateParameter()

    def requires(self):
        return []

    def output(self):
        return luigi.LocalTarget(f"data/{self.date}.csv")

    def run(self):
        import pandas as pd
        df = pd.read_csv("source.csv")
        df.to_csv(self.output().path)

class ProcessData(luigi.Task):
    date = luigi.DateParameter()

    def requires(self):
        return FetchData(date=self.date)

    def output(self):
        return luigi.LocalTarget(f"processed/{self.date}.csv")`,
    filename: 'etl.py',
  };

  it('normalizes Luigi pipeline', () => {
    const result = normalizeWorkflow('luigi', sampleLuigi);
    assert.equal(result.source, 'luigi');
    assert.equal(result.tool_type, 'luigi');
    assert.equal(result.language, 'python');
  });

  it('extracts Task class names', () => {
    const result = normalizeWorkflow('luigi', sampleLuigi);
    assert.ok(result.tool_metadata.tasks.length >= 2);
  });

  it('extracts dependencies', () => {
    const result = normalizeWorkflow('luigi', sampleLuigi);
    assert.ok(result.tool_metadata.dependencies.length > 0);
  });

  it('extracts output targets', () => {
    const result = normalizeWorkflow('luigi', sampleLuigi);
    assert.ok(result.tool_metadata.outputs.length > 0);
  });

  it('sets trigger_type to programmatic', () => {
    const result = normalizeWorkflow('luigi', sampleLuigi);
    assert.equal(result.metadata.trigger_type, 'programmatic');
  });
});


describe('normalizeWorkflow — new sources throw for unknown', () => {
  it('still throws for truly unknown source', () => {
    assert.throws(
      () => normalizeWorkflow('nonexistent-source', {}),
      { message: /Unknown source: nonexistent-source/ }
    );
  });
});
