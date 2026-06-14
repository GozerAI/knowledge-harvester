// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Re-implement pure extractors for testing (no DB deps) ──

function detectMLFramework(content) {
  const frameworks = [
    ['pytorch', /\btorch\b|import torch|from torch/],
    ['tensorflow', /\btensorflow\b|import tensorflow|from tensorflow/],
    ['keras', /\bkeras\b|from keras/],
    ['transformers', /\btransformers\b|from transformers|AutoModel|AutoTokenizer/],
    ['scikit-learn', /\bsklearn\b|from sklearn/],
    ['xgboost', /\bxgboost\b|import xgboost/],
    ['lightgbm', /\blightgbm\b|import lightgbm/],
    ['jax', /\bjax\b|import jax/],
    ['fastai', /\bfastai\b|from fastai/],
    ['spacy', /\bspacy\b|import spacy/],
    ['huggingface', /\bhuggingface\b|huggingface_hub/],
    ['langchain', /\blangchain\b|from langchain/],
    ['llamaindex', /\bllama_index\b|from llama_index/],
    ['onnx', /\bonnx\b|import onnx/],
    ['mlflow', /\bmlflow\b|import mlflow/],
    ['ray', /\bray\b|import ray/],
  ];
  for (const [name, pattern] of frameworks) {
    if (pattern.test(content)) return name;
  }
  return null;
}

function extractMLConfigComponents(content) {
  const framework = detectMLFramework(content);

  const detectModelType = (c) => {
    const types = [
      ['transformer', /\bTransformer\b|attention_head|self_attention/],
      ['cnn', /\bConv2d\b|\bConv1d\b|convolution|CNN/],
      ['rnn', /\bLSTM\b|\bGRU\b|\bRNN\b/],
      ['gan', /\bGenerator\b.*\bDiscriminator\b|\bGAN\b/],
      ['diffusion', /\bdiffusion\b|UNet2DConditionModel|noise_scheduler/],
      ['bert', /\bBert\b|\bbert\b/],
      ['gpt', /\bGPT\b|\bgpt\b|causal.*language/i],
      ['llm', /\bLLM\b|language_model|text-generation/],
      ['embedding', /\bembedding\b.*model|SentenceTransformer/i],
    ];
    for (const [name, pattern] of types) {
      if (pattern.test(c)) return name;
    }
    return null;
  };

  const detectOptimizer = (c) => {
    const opts = [['adam', /\bAdam\b|\badam\b/], ['adamw', /\bAdamW\b/], ['sgd', /\bSGD\b/]];
    for (const [name, pattern] of opts) {
      if (pattern.test(c)) return name;
    }
    return null;
  };

  const detectLoss = (c) => {
    const losses = [
      ['cross-entropy', /CrossEntropy|cross_entropy/],
      ['mse', /\bMSELoss\b|mean_squared_error/],
      ['bce', /\bBCELoss\b|binary_crossentropy/],
    ];
    for (const [name, pattern] of losses) {
      if (pattern.test(c)) return name;
    }
    return null;
  };

  const extractMetrics = (c) => {
    const metrics = new Set();
    const patterns = [
      [/\baccuracy\b/i, 'accuracy'], [/\bf1[_-]?score\b/i, 'f1-score'],
      [/\bprecision\b/i, 'precision'], [/\brecall\b/i, 'recall'],
      [/\bbleu\b/i, 'bleu'], [/\bperplexity\b/i, 'perplexity'],
    ];
    for (const [pattern, name] of patterns) {
      if (pattern.test(c)) metrics.add(name);
    }
    return [...metrics];
  };

  const extractHyperparameters = (c) => {
    const params = {};
    const patterns = [
      [/learning_rate\s*[=:]\s*([\d.e-]+)/, 'learning_rate'],
      [/batch_size\s*[=:]\s*(\d+)/, 'batch_size'],
      [/epochs?\s*[=:]\s*(\d+)/, 'epochs'],
      [/dropout\s*[=:]\s*([\d.]+)/, 'dropout'],
    ];
    for (const [pattern, name] of patterns) {
      const m = c.match(pattern);
      if (m) params[name] = m[1];
    }
    return params;
  };

  const extractDatasetRefs = (c) => {
    const refs = new Set();
    const hfMatches = c.match(/load_dataset\(\s*['"]([^'"]+)['"]/g) || [];
    for (const m of hfMatches) {
      const ds = m.match(/['"]([^'"]+)['"]/)?.[1];
      if (ds) refs.add(ds);
    }
    const named = ['mnist', 'cifar10', 'imagenet', 'squad'];
    for (const n of named) {
      if (new RegExp(`\\b${n}\\b`, 'i').test(c)) refs.add(n);
    }
    return [...refs];
  };

  return {
    framework,
    modelType: detectModelType(content),
    optimizer: detectOptimizer(content),
    lossFunction: detectLoss(content),
    metrics: extractMetrics(content),
    hyperparameters: extractHyperparameters(content),
    datasetRefs: extractDatasetRefs(content),
    hasGpuConfig: /\bcuda\b|\bgpu\b|\bdevice\s*[=:]\s*['"]?cuda/i.test(content),
    hasWandb: /\bwandb\b|\bweights.*biases\b/i.test(content),
    hasMlflow: /\bmlflow\b/i.test(content),
  };
}

function extractNotebookComponents(content) {
  let notebook;
  try {
    notebook = typeof content === 'string' ? JSON.parse(content) : content;
  } catch {
    return {
      framework: null, cellCount: 0, codeCellCount: 0, markdownCellCount: 0,
      imports: [], hasVisualizations: false, hasModelTraining: false,
      hasDataLoading: false, datasetRefs: [],
    };
  }

  const cells = notebook.cells || [];
  const codeCells = cells.filter(c => c.cell_type === 'code');
  const markdownCells = cells.filter(c => c.cell_type === 'markdown');
  const codeText = codeCells
    .map(c => (Array.isArray(c.source) ? c.source.join('') : c.source || ''))
    .join('\n');

  return {
    framework: detectMLFramework(codeText),
    cellCount: cells.length,
    codeCellCount: codeCells.length,
    markdownCellCount: markdownCells.length,
    imports: [],
    hasVisualizations: /\bmatplotlib\b|\bseaborn\b|\bplotly\b|\bplt\.\b/.test(codeText),
    hasModelTraining: /\.fit\(|\.train\(|trainer\.|\.backward\(\)/.test(codeText),
    hasDataLoading: /pd\.read_|\.load_dataset\(|DataLoader\(|\.from_csv\(/.test(codeText),
    datasetRefs: [],
  };
}

function extractModelCardComponents(content) {
  const modelName = content.match(/^#\s+(.+)/m)?.[1]?.trim()
    || content.match(/model_name:\s*(.+)/)?.[1]?.trim()
    || null;
  const baseModel = content.match(/base_model:\s*(.+)/)?.[1]?.trim() || null;
  const task = content.match(/(?:task|pipeline_tag):\s*(.+)/)?.[1]?.trim() || null;
  const license = content.match(/license:\s*(.+)/)?.[1]?.trim() || null;
  const pipelineTag = content.match(/pipeline_tag:\s*(.+)/)?.[1]?.trim() || null;
  const library = content.match(/library_name:\s*(.+)/)?.[1]?.trim() || null;

  return { modelName, baseModel, task, license, pipelineTag, library };
}

function calculateAiMlScore(row, meta) {
  let score = 0;
  if (row.name && !row.name.includes('Untitled')) score += 8;
  if (row.description?.length > 20) score += 8;
  if (row.description?.length > 100) score += 9;
  if (meta.framework) score += 8;
  if (meta.model_type) score += 5;
  if (meta.optimizer) score += 4;
  if (meta.loss_function) score += 4;
  const metrics = meta.metrics || [];
  if (metrics.length >= 1) score += 3;
  if (metrics.length >= 3) score += 3;
  const hpCount = Object.keys(meta.hyperparameters || {}).length;
  if (hpCount >= 1) score += 3;
  const dsCount = (meta.dataset_refs || meta.datasets || []).length;
  if (dsCount >= 1) score += 5;
  if (dsCount >= 3) score += 3;
  if (meta.has_gpu_config) score += 4;
  if (meta.has_wandb) score += 5;
  if (meta.hasMlflow || meta.has_mlflow) score += 5;
  if (meta.base_model) score += 3;
  if (meta.ml_type === 'notebook') {
    if ((meta.code_cell_count || 0) >= 5) score += 5;
    if ((meta.markdown_cell_count || 0) >= 3) score += 5;
    if (meta.has_visualizations) score += 5;
    if (meta.has_data_loading) score += 5;
  } else if (meta.ml_type === 'model-card') {
    if (meta.license) score += 5;
    if (meta.pipeline_tag) score += 5;
    if ((meta.languages || []).length > 0) score += 5;
    if ((meta.tags || []).length >= 3) score += 5;
  } else {
    const importCount = (meta.imports || []).length;
    if (importCount >= 3) score += 5;
    if (importCount >= 5) score += 5;
    if (meta.has_model_training) score += 5;
    if (hpCount >= 3) score += 5;
  }
  return Math.min(score, 100);
}

function getDefaultMLCategory(meta) {
  const framework = meta?.framework;
  if (!framework) return 'general-ml';
  const frameworkDefaults = {
    transformers: 'nlp-text', pytorch: 'general-ml', tensorflow: 'general-ml',
    'scikit-learn': 'tabular-ml', xgboost: 'tabular-ml', spacy: 'nlp-text',
    langchain: 'generative-ai', llamaindex: 'generative-ai',
    mlflow: 'mlops-experiment', ray: 'mlops-experiment', fastai: 'computer-vision',
  };
  return frameworkDefaults[framework] || 'general-ml';
}

// ── Tests ──

describe('detectMLFramework', () => {
  it('detects PyTorch', () => {
    assert.equal(detectMLFramework('import torch\nfrom torch import nn'), 'pytorch');
  });

  it('detects TensorFlow', () => {
    assert.equal(detectMLFramework('import tensorflow as tf'), 'tensorflow');
  });

  it('detects HuggingFace Transformers', () => {
    assert.equal(detectMLFramework('from transformers import AutoModel'), 'transformers');
  });

  it('detects scikit-learn', () => {
    assert.equal(detectMLFramework('from sklearn.ensemble import RandomForestClassifier'), 'scikit-learn');
  });

  it('detects LangChain', () => {
    assert.equal(detectMLFramework('from langchain.chains import LLMChain'), 'langchain');
  });

  it('detects MLflow', () => {
    assert.equal(detectMLFramework('import mlflow\nmlflow.start_run()'), 'mlflow');
  });

  it('returns null for non-ML code', () => {
    assert.equal(detectMLFramework('print("hello")'), null);
  });
});

describe('extractMLConfigComponents', () => {
  it('extracts full training config', () => {
    const code = `
import torch
from torch import nn
model = nn.Transformer()
optimizer = torch.optim.AdamW(model.parameters(), lr=0.001)
loss = nn.CrossEntropyLoss()
learning_rate = 0.001
batch_size = 32
epochs = 10
dropout = 0.1
device = "cuda"
import wandb
from datasets import load_dataset
dataset = load_dataset("squad")
accuracy = compute_accuracy()
f1_score = compute_f1()
`;
    const result = extractMLConfigComponents(code);
    assert.equal(result.framework, 'pytorch');
    assert.equal(result.modelType, 'transformer');
    assert.equal(result.optimizer, 'adamw');
    assert.equal(result.lossFunction, 'cross-entropy');
    assert.ok(result.metrics.includes('accuracy'));
    assert.ok(result.metrics.includes('f1-score'));
    assert.equal(result.hyperparameters.learning_rate, '0.001');
    assert.equal(result.hyperparameters.batch_size, '32');
    assert.equal(result.hyperparameters.epochs, '10');
    assert.equal(result.hyperparameters.dropout, '0.1');
    assert.ok(result.hasGpuConfig);
    assert.ok(result.hasWandb);
    assert.ok(result.datasetRefs.includes('squad'));
  });

  it('detects CNN model type', () => {
    const code = 'nn.Conv2d(3, 64, kernel_size=3)';
    const result = extractMLConfigComponents(code);
    assert.equal(result.modelType, 'cnn');
  });

  it('detects RNN model type', () => {
    const code = 'model = nn.LSTM(input_size, hidden_size)';
    const result = extractMLConfigComponents(code);
    assert.equal(result.modelType, 'rnn');
  });

  it('detects diffusion model type', () => {
    const code = 'from diffusers import UNet2DConditionModel';
    const result = extractMLConfigComponents(code);
    assert.equal(result.modelType, 'diffusion');
  });

  it('detects known datasets in text', () => {
    const code = 'Trained on mnist and cifar10 datasets';
    const result = extractMLConfigComponents(code);
    assert.ok(result.datasetRefs.includes('mnist'));
    assert.ok(result.datasetRefs.includes('cifar10'));
  });

  it('returns empty for minimal code', () => {
    const result = extractMLConfigComponents('x = 1');
    assert.equal(result.framework, null);
    assert.equal(result.modelType, null);
    assert.equal(result.optimizer, null);
    assert.deepEqual(result.metrics, []);
  });
});

describe('extractNotebookComponents', () => {
  it('parses notebook with code and markdown cells', () => {
    const notebook = {
      cells: [
        { cell_type: 'markdown', source: ['# Training'] },
        { cell_type: 'code', source: ['import torch\n', 'model.fit(data)'] },
        { cell_type: 'code', source: ['import matplotlib\nplt.show()'] },
        { cell_type: 'code', source: ['pd.read_csv("data.csv")'] },
      ]
    };
    const result = extractNotebookComponents(notebook);
    assert.equal(result.cellCount, 4);
    assert.equal(result.codeCellCount, 3);
    assert.equal(result.markdownCellCount, 1);
    assert.equal(result.framework, 'pytorch');
    assert.ok(result.hasModelTraining);
    assert.ok(result.hasVisualizations);
    assert.ok(result.hasDataLoading);
  });

  it('handles string content', () => {
    const json = JSON.stringify({ cells: [
      { cell_type: 'code', source: ['import tensorflow'] }
    ]});
    const result = extractNotebookComponents(json);
    assert.equal(result.codeCellCount, 1);
    assert.equal(result.framework, 'tensorflow');
  });

  it('handles invalid JSON', () => {
    const result = extractNotebookComponents('not json');
    assert.equal(result.cellCount, 0);
    assert.equal(result.framework, null);
  });

  it('handles empty notebook', () => {
    const result = extractNotebookComponents({ cells: [] });
    assert.equal(result.cellCount, 0);
    assert.equal(result.codeCellCount, 0);
  });
});

describe('extractModelCardComponents', () => {
  it('extracts model card metadata', () => {
    const card = `---
base_model: meta-llama/Llama-2-7b
license: mit
pipeline_tag: text-generation
library_name: transformers
---

# My Fine-tuned LLM
`;
    const result = extractModelCardComponents(card);
    assert.equal(result.modelName, 'My Fine-tuned LLM');
    assert.equal(result.baseModel, 'meta-llama/Llama-2-7b');
    assert.equal(result.license, 'mit');
    assert.equal(result.pipelineTag, 'text-generation');
    assert.equal(result.library, 'transformers');
  });

  it('handles missing fields', () => {
    const card = '# Simple Model\nJust a model.';
    const result = extractModelCardComponents(card);
    assert.equal(result.modelName, 'Simple Model');
    assert.equal(result.baseModel, null);
    assert.equal(result.license, null);
  });
});

describe('calculateAiMlScore', () => {
  it('scores high for comprehensive training config', () => {
    const row = { name: 'bert-finetune', description: 'Fine-tuning BERT for text classification with comprehensive evaluation metrics and experiment tracking.' };
    const meta = {
      ml_type: 'training-config', framework: 'transformers',
      model_type: 'bert', optimizer: 'adamw', loss_function: 'cross-entropy',
      metrics: ['accuracy', 'f1-score', 'precision'],
      hyperparameters: { learning_rate: '2e-5', batch_size: '16', epochs: '3', dropout: '0.1' },
      dataset_refs: ['squad', 'glue', 'wikitext'],
      has_gpu_config: true, has_wandb: true,
      imports: ['torch', 'transformers', 'datasets', 'wandb', 'sklearn'],
      has_model_training: true,
    };
    const score = calculateAiMlScore(row, meta);
    assert.ok(score >= 75, `Expected >= 75, got ${score}`);
  });

  it('scores low for minimal config', () => {
    const row = { name: 'Untitled', description: '' };
    const meta = { ml_type: 'generic' };
    const score = calculateAiMlScore(row, meta);
    assert.ok(score < 15, `Expected < 15, got ${score}`);
  });

  it('scores model cards differently', () => {
    const row = { name: 'my-model', description: 'A fine-tuned model for classification tasks' };
    const meta = {
      ml_type: 'model-card', framework: 'transformers',
      license: 'mit', pipeline_tag: 'text-classification',
      languages: ['en'], tags: ['bert', 'classification', 'nlp'],
    };
    const score = calculateAiMlScore(row, meta);
    assert.ok(score >= 40, `Expected >= 40, got ${score}`);
  });

  it('scores notebooks with visualization bonus', () => {
    const row = { name: 'analysis', description: 'Data analysis notebook with charts' };
    const meta = {
      ml_type: 'notebook', framework: 'pytorch',
      code_cell_count: 10, markdown_cell_count: 5,
      has_visualizations: true, has_data_loading: true,
    };
    const score = calculateAiMlScore(row, meta);
    assert.ok(score >= 40, `Expected >= 40, got ${score}`);
  });
});

describe('getDefaultMLCategory', () => {
  it('returns correct defaults for known frameworks', () => {
    assert.equal(getDefaultMLCategory({ framework: 'transformers' }), 'nlp-text');
    assert.equal(getDefaultMLCategory({ framework: 'scikit-learn' }), 'tabular-ml');
    assert.equal(getDefaultMLCategory({ framework: 'langchain' }), 'generative-ai');
    assert.equal(getDefaultMLCategory({ framework: 'mlflow' }), 'mlops-experiment');
    assert.equal(getDefaultMLCategory({ framework: 'fastai' }), 'computer-vision');
  });

  it('returns general-ml for unknown framework', () => {
    assert.equal(getDefaultMLCategory({ framework: 'unknown-lib' }), 'general-ml');
  });

  it('returns general-ml when no framework', () => {
    assert.equal(getDefaultMLCategory({}), 'general-ml');
    assert.equal(getDefaultMLCategory(null), 'general-ml');
  });
});
