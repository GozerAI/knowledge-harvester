// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';


// ============================================================
// ComfyUI Harvester — _validateComfyUI (reimplemented)
// ============================================================

function isComfyUIWorkflow(obj) {
  if (!obj || typeof obj !== 'object') return false;
  // ComfyUI workflows have numbered keys with class_type
  const values = Array.isArray(obj) ? obj : Object.values(obj);
  return values.some(v => v && typeof v === 'object' && v.class_type);
}

describe('ComfyUIHarvester — validation', () => {
  it('returns true for workflow with class_type nodes', () => {
    assert.ok(isComfyUIWorkflow({
      '1': { class_type: 'KSampler', inputs: {} },
      '2': { class_type: 'CLIPTextEncode', inputs: {} },
    }));
  });

  it('returns true for array-based workflow', () => {
    assert.ok(isComfyUIWorkflow([
      { class_type: 'CheckpointLoaderSimple' },
      { class_type: 'KSampler' },
    ]));
  });

  it('returns false for null input', () => {
    assert.equal(isComfyUIWorkflow(null), false);
  });

  it('returns false for object without class_type', () => {
    assert.equal(isComfyUIWorkflow({ '1': { type: 'something' } }), false);
  });

  it('returns false for empty object', () => {
    assert.equal(isComfyUIWorkflow({}), false);
  });

  it('returns false for primitive', () => {
    assert.equal(isComfyUIWorkflow('string'), false);
  });
});


// ============================================================
// Dify Harvester — _validateDify (reimplemented)
// ============================================================

function isDifyConfig(content) {
  if (!content || typeof content !== 'string') return false;
  const hasApp = content.includes('app');
  const hasModelConfig = content.includes('model_config') || content.includes('app_mode');
  return hasApp && hasModelConfig;
}

describe('DifyHarvester — validation', () => {
  it('returns true for content with app and model_config', () => {
    assert.ok(isDifyConfig('app:\n  model_config:\n    provider: openai'));
  });

  it('returns true for content with app and app_mode', () => {
    assert.ok(isDifyConfig('app:\n  app_mode: chat'));
  });

  it('returns false for content without app', () => {
    assert.equal(isDifyConfig('model_config:\n  provider: openai'), false);
  });

  it('returns false for null', () => {
    assert.equal(isDifyConfig(null), false);
  });

  it('returns false for empty string', () => {
    assert.equal(isDifyConfig(''), false);
  });
});


// ============================================================
// Flowise Harvester — _validateFlowise (reimplemented)
// ============================================================

function isFlowiseChatflow(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const nodes = obj.nodes || [];
  if (!Array.isArray(nodes) || nodes.length === 0) return false;
  return nodes.some(n => n && n.data && n.data.name);
}

describe('FlowiseHarvester — validation', () => {
  it('returns true for chatflow with data.name nodes', () => {
    assert.ok(isFlowiseChatflow({
      nodes: [
        { data: { name: 'chatOpenAI', label: 'ChatOpenAI' } },
        { data: { name: 'pdfLoader', label: 'PDF Loader' } },
      ],
    }));
  });

  it('returns false for empty nodes array', () => {
    assert.equal(isFlowiseChatflow({ nodes: [] }), false);
  });

  it('returns false for nodes without data.name', () => {
    assert.equal(isFlowiseChatflow({ nodes: [{ type: 'something' }] }), false);
  });

  it('returns false for null', () => {
    assert.equal(isFlowiseChatflow(null), false);
  });

  it('returns false for non-object', () => {
    assert.equal(isFlowiseChatflow('string'), false);
  });
});


// ============================================================
// Pipedream Harvester — _validatePipedream (reimplemented)
// ============================================================

function isPipedreamComponent(content) {
  if (!content || typeof content !== 'string') return false;
  return content.includes('defineComponent') || (content.includes('steps') && content.includes('trigger'));
}

describe('PipedreamHarvester — validation', () => {
  it('returns true for defineComponent code', () => {
    assert.ok(isPipedreamComponent('export default defineComponent({ props: {} })'));
  });

  it('returns true for steps+trigger code', () => {
    assert.ok(isPipedreamComponent('const trigger = {};\nconst steps = {};'));
  });

  it('returns false for regular JS without pipedream patterns', () => {
    assert.equal(isPipedreamComponent('function hello() { return true; }'), false);
  });

  it('returns false for null', () => {
    assert.equal(isPipedreamComponent(null), false);
  });

  it('returns false for empty string', () => {
    assert.equal(isPipedreamComponent(''), false);
  });
});


// ============================================================
// Argo Harvester — _validateArgo (reimplemented)
// ============================================================

function isArgoWorkflow(content) {
  if (!content || typeof content !== 'string') return false;
  return content.includes('apiVersion') && content.includes('argoproj.io');
}

describe('ArgoHarvester — validation', () => {
  it('returns true for Argo Workflow YAML', () => {
    assert.ok(isArgoWorkflow('apiVersion: argoproj.io/v1alpha1\nkind: Workflow'));
  });

  it('returns true for CronWorkflow', () => {
    assert.ok(isArgoWorkflow('apiVersion: argoproj.io/v1alpha1\nkind: CronWorkflow'));
  });

  it('returns false for non-Argo YAML', () => {
    assert.equal(isArgoWorkflow('apiVersion: apps/v1\nkind: Deployment'), false);
  });

  it('returns false for content without apiVersion', () => {
    assert.equal(isArgoWorkflow('kind: Workflow\nargoproj.io'), false);
  });

  it('returns false for null', () => {
    assert.equal(isArgoWorkflow(null), false);
  });
});


// ============================================================
// Luigi Harvester — _validateLuigi (reimplemented)
// ============================================================

function isLuigiCode(content) {
  if (!content || typeof content !== 'string') return false;
  return (
    content.includes('luigi.Task') ||
    content.includes('luigi.WrapperTask') ||
    content.includes('luigi.ExternalTask') ||
    content.includes('import luigi')
  );
}

describe('LuigiHarvester — validation', () => {
  it('returns true for luigi.Task code', () => {
    assert.ok(isLuigiCode('class MyTask(luigi.Task):\n    def requires(self):'));
  });

  it('returns true for import luigi', () => {
    assert.ok(isLuigiCode('import luigi\n\nclass Foo(luigi.Task):'));
  });

  it('returns true for WrapperTask', () => {
    assert.ok(isLuigiCode('class AllTasks(luigi.WrapperTask):'));
  });

  it('returns true for ExternalTask', () => {
    assert.ok(isLuigiCode('class Input(luigi.ExternalTask):'));
  });

  it('returns false for non-Luigi Python', () => {
    assert.equal(isLuigiCode('import pandas\ndf = pandas.read_csv("data.csv")'), false);
  });

  it('returns false for null', () => {
    assert.equal(isLuigiCode(null), false);
  });
});
