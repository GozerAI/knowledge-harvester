// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { randomUUID } from 'node:crypto';
import { generateContentHash } from '../../../utils/hash.js';
import { extractNameFromPath } from '../../../utils/helpers.js';

/**
 * Normalize raw AI/ML asset data into the unified artifact schema.
 *
 * @param {string} source - Source identifier
 * @param {object} rawData - { searchResult, content, filename, label }
 * @returns {object} Normalized artifact for storeArtifact()
 */
export function normalizeAiMlAsset(source, rawData) {
  switch (source) {
    case 'ml-configs':       return normalizeMLConfig(rawData);
    case 'jupyter-notebooks': return normalizeNotebook(rawData);
    case 'model-cards':      return normalizeModelCard(rawData);
    default:                 return normalizeGenericML(source, rawData);
  }
}

// ── ML Config (training configs, hyperparameters) ──

function normalizeMLConfig(data) {
  const { searchResult, content, filename } = data;
  const components = extractMLConfigComponents(content, filename);

  return buildMLArtifact({
    source: 'ml-configs',
    searchResult,
    content,
    filename,
    language: detectMLLanguage(filename),
    components,
    typeMetadata: {
      ml_type: 'training-config',
      framework: components.framework,
      model_type: components.modelType,
      optimizer: components.optimizer,
      loss_function: components.lossFunction,
      metrics: components.metrics,
      hyperparameters: components.hyperparameters,
      dataset_refs: components.datasetRefs,
      has_gpu_config: components.hasGpuConfig,
      has_wandb: components.hasWandb,
      has_mlflow: components.hasMlflow,
    },
  });
}

/**
 * Extract ML training config components.
 */
export function extractMLConfigComponents(content, filename) {
  const framework = detectMLFramework(content);
  const modelType = detectModelType(content);
  const optimizer = detectOptimizer(content);
  const lossFunction = detectLoss(content);
  const metrics = extractMetrics(content);
  const hyperparameters = extractHyperparameters(content);
  const datasetRefs = extractDatasetRefs(content);
  const hasGpuConfig = /\bcuda\b|\bgpu\b|\bdevice\s*[=:]\s*['"]?cuda/i.test(content);
  const hasWandb = /\bwandb\b|\bweights.*biases\b/i.test(content);
  const hasMlflow = /\bmlflow\b/i.test(content);

  return {
    framework, modelType, optimizer, lossFunction,
    metrics, hyperparameters, datasetRefs,
    hasGpuConfig, hasWandb, hasMlflow,
  };
}

// ── Jupyter Notebook ──

function normalizeNotebook(data) {
  const { searchResult, content, filename } = data;
  const components = extractNotebookComponents(content);

  return buildMLArtifact({
    source: 'jupyter-notebooks',
    searchResult,
    content,
    filename,
    language: 'python',
    components,
    typeMetadata: {
      ml_type: 'notebook',
      framework: components.framework,
      cell_count: components.cellCount,
      code_cell_count: components.codeCellCount,
      markdown_cell_count: components.markdownCellCount,
      imports: components.imports,
      has_visualizations: components.hasVisualizations,
      has_model_training: components.hasModelTraining,
      has_data_loading: components.hasDataLoading,
      dataset_refs: components.datasetRefs,
    },
  });
}

/**
 * Extract Jupyter notebook components from JSON content.
 */
export function extractNotebookComponents(content) {
  let notebook;
  try {
    notebook = typeof content === 'string' ? JSON.parse(content) : content;
  } catch {
    return emptyNotebookComponents();
  }

  const cells = notebook.cells || [];
  const codeCells = cells.filter(c => c.cell_type === 'code');
  const markdownCells = cells.filter(c => c.cell_type === 'markdown');

  // Combine all code cell source text
  const codeText = codeCells
    .map(c => (Array.isArray(c.source) ? c.source.join('') : c.source || ''))
    .join('\n');

  const imports = extractPythonImports(codeText);
  const framework = detectMLFramework(codeText);
  const hasVisualizations = /\bmatplotlib\b|\bseaborn\b|\bplotly\b|\bplt\.\b/.test(codeText);
  const hasModelTraining = /\.fit\(|\.train\(|trainer\.|\.backward\(\)/.test(codeText);
  const hasDataLoading = /pd\.read_|\.load_dataset\(|DataLoader\(|\.from_csv\(/.test(codeText);
  const datasetRefs = extractDatasetRefs(codeText);

  return {
    framework,
    cellCount: cells.length,
    codeCellCount: codeCells.length,
    markdownCellCount: markdownCells.length,
    imports,
    hasVisualizations,
    hasModelTraining,
    hasDataLoading,
    datasetRefs,
  };
}

function emptyNotebookComponents() {
  return {
    framework: null, cellCount: 0, codeCellCount: 0, markdownCellCount: 0,
    imports: [], hasVisualizations: false, hasModelTraining: false,
    hasDataLoading: false, datasetRefs: [],
  };
}

// ── Model Card ──

function normalizeModelCard(data) {
  const { searchResult, content, filename } = data;
  const components = extractModelCardComponents(content);

  return buildMLArtifact({
    source: 'model-cards',
    searchResult,
    content,
    filename,
    language: 'yaml',
    components,
    typeMetadata: {
      ml_type: 'model-card',
      model_name: components.modelName,
      base_model: components.baseModel,
      task: components.task,
      license: components.license,
      datasets: components.datasets,
      languages: components.languages,
      library: components.library,
      pipeline_tag: components.pipelineTag,
      tags: components.tags,
    },
  });
}

/**
 * Extract model card components from YAML/Markdown front matter.
 */
export function extractModelCardComponents(content) {
  const modelName = content.match(/^#\s+(.+)/m)?.[1]?.trim()
    || content.match(/model_name:\s*(.+)/)?.[1]?.trim()
    || null;
  const baseModel = content.match(/base_model:\s*(.+)/)?.[1]?.trim() || null;
  const task = content.match(/(?:task|pipeline_tag):\s*(.+)/)?.[1]?.trim() || null;
  const license = content.match(/license:\s*(.+)/)?.[1]?.trim() || null;
  const pipelineTag = content.match(/pipeline_tag:\s*(.+)/)?.[1]?.trim() || null;
  const library = content.match(/library_name:\s*(.+)/)?.[1]?.trim() || null;

  const datasets = [];
  const dsMatches = content.match(/^\s*-\s+(\S+\/\S+)/gm) || [];
  for (const m of dsMatches) {
    const ds = m.trim().replace(/^-\s+/, '');
    if (ds.includes('/')) datasets.push(ds);
  }

  const languages = [];
  const langMatches = content.match(/language:\s*\n([\s\S]*?)(?=\n\w|\n---)/);
  if (langMatches) {
    const langs = langMatches[1].match(/^\s*-\s+(\w+)/gm) || [];
    for (const l of langs) {
      languages.push(l.trim().replace(/^-\s+/, ''));
    }
  }
  // Single language line
  const singleLang = content.match(/^language:\s*(\w+)/m)?.[1];
  if (singleLang && !languages.length) languages.push(singleLang);

  const tags = [];
  const tagSection = content.match(/tags:\s*\n([\s\S]*?)(?=\n\w|\n---)/);
  if (tagSection) {
    const tagLines = tagSection[1].match(/^\s*-\s+(.+)/gm) || [];
    for (const t of tagLines) {
      tags.push(t.trim().replace(/^-\s+/, ''));
    }
  }

  return {
    modelName, baseModel, task, license,
    datasets: [...new Set(datasets)].slice(0, 20),
    languages,
    library,
    pipelineTag,
    tags: tags.slice(0, 20),
  };
}

// ── Generic ML ──

function normalizeGenericML(source, data) {
  const { searchResult, content, filename } = data;
  const framework = detectMLFramework(content);

  return buildMLArtifact({
    source,
    searchResult,
    content,
    filename,
    language: detectMLLanguage(filename),
    components: { framework },
    typeMetadata: {
      ml_type: 'generic',
      framework,
    },
  });
}

// ── Shared Helpers ──

function buildMLArtifact({ source, searchResult, content, filename, language, components, typeMetadata }) {
  const name = searchResult?.repository?.full_name
    ? `${searchResult.repository.full_name}/${filename}`
    : extractNameFromPath(filename);
  const description = searchResult?.repository?.description || '';

  return {
    id: randomUUID(),
    hash: generateContentHash(typeof content === 'string' ? content : JSON.stringify(content), 'ai_ml_asset'),
    artifact_type: 'ai_ml_asset',
    source,
    source_url: searchResult?.html_url || '',
    source_id: searchResult?.sha || searchResult?.html_url || randomUUID(),
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    content: { source_code: typeof content === 'string' ? content : JSON.stringify(content), filename },
    name,
    description,
    author: {
      username: searchResult?.repository?.owner?.login || null,
      profile_url: searchResult?.repository?.owner?.html_url || null,
    },
    language,
    tool_type: components.framework || 'ml',
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

/**
 * Detect ML/AI framework from content.
 */
export function detectMLFramework(content) {
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

/**
 * Detect model type from content.
 */
function detectModelType(content) {
  const types = [
    ['transformer', /\bTransformer\b|attention_head|self_attention/],
    ['cnn', /\bConv2d\b|\bConv1d\b|convolution|CNN/],
    ['rnn', /\bLSTM\b|\bGRU\b|\bRNN\b/],
    ['gan', /\bGenerator\b.*\bDiscriminator\b|\bGAN\b/],
    ['diffusion', /\bdiffusion\b|UNet2DConditionModel|noise_scheduler/],
    ['vae', /\bVAE\b|variational_autoencoder/],
    ['bert', /\bBert\b|\bbert\b/],
    ['gpt', /\bGPT\b|\bgpt\b|causal.*language/i],
    ['llm', /\bLLM\b|language_model|text-generation/],
    ['embedding', /\bembedding\b.*model|SentenceTransformer/i],
    ['classification', /\bclassif/i],
    ['regression', /\bregress/i],
  ];

  for (const [name, pattern] of types) {
    if (pattern.test(content)) return name;
  }
  return null;
}

function detectOptimizer(content) {
  const optimizers = [
    ['adam', /\bAdam\b|\badam\b/],
    ['adamw', /\bAdamW\b/],
    ['sgd', /\bSGD\b/],
    ['rmsprop', /\bRMSprop\b/],
    ['adagrad', /\bAdagrad\b/],
  ];
  for (const [name, pattern] of optimizers) {
    if (pattern.test(content)) return name;
  }
  return null;
}

function detectLoss(content) {
  const losses = [
    ['cross-entropy', /CrossEntropy|cross_entropy/],
    ['mse', /\bMSELoss\b|mean_squared_error/],
    ['bce', /\bBCELoss\b|binary_crossentropy/],
    ['nll', /\bNLLLoss\b/],
    ['huber', /\bHuberLoss\b/],
    ['contrastive', /\bContrastiveLoss\b|contrastive_loss/],
    ['triplet', /\bTripletLoss\b|triplet_loss/],
  ];
  for (const [name, pattern] of losses) {
    if (pattern.test(content)) return name;
  }
  return null;
}

function extractMetrics(content) {
  const metrics = new Set();
  const patterns = [
    [/\baccuracy\b/i, 'accuracy'],
    [/\bf1[_-]?score\b/i, 'f1-score'],
    [/\bprecision\b/i, 'precision'],
    [/\brecall\b/i, 'recall'],
    [/\bauc\b|\broc\b/i, 'auc-roc'],
    [/\bbleu\b/i, 'bleu'],
    [/\brouge\b/i, 'rouge'],
    [/\bperplexity\b/i, 'perplexity'],
    [/\bmae\b|mean_absolute/i, 'mae'],
    [/\brmse\b|root_mean/i, 'rmse'],
  ];
  for (const [pattern, name] of patterns) {
    if (pattern.test(content)) metrics.add(name);
  }
  return [...metrics];
}

function extractHyperparameters(content) {
  const params = {};
  const patterns = [
    [/learning_rate\s*[=:]\s*([\d.e-]+)/, 'learning_rate'],
    [/batch_size\s*[=:]\s*(\d+)/, 'batch_size'],
    [/epochs?\s*[=:]\s*(\d+)/, 'epochs'],
    [/num_epochs?\s*[=:]\s*(\d+)/, 'epochs'],
    [/dropout\s*[=:]\s*([\d.]+)/, 'dropout'],
    [/weight_decay\s*[=:]\s*([\d.e-]+)/, 'weight_decay'],
    [/warmup_steps?\s*[=:]\s*(\d+)/, 'warmup_steps'],
    [/max_seq_len(?:gth)?\s*[=:]\s*(\d+)/, 'max_seq_length'],
    [/hidden_size\s*[=:]\s*(\d+)/, 'hidden_size'],
    [/num_layers?\s*[=:]\s*(\d+)/, 'num_layers'],
  ];
  for (const [pattern, name] of patterns) {
    const m = content.match(pattern);
    if (m) params[name] = m[1];
  }
  return Object.keys(params).length > 0 ? params : {};
}

function extractDatasetRefs(content) {
  const refs = new Set();
  // HuggingFace dataset references
  const hfMatches = content.match(/load_dataset\(\s*['"]([^'"]+)['"]/g) || [];
  for (const m of hfMatches) {
    const ds = m.match(/['"]([^'"]+)['"]/)?.[1];
    if (ds) refs.add(ds);
  }
  // Common dataset names
  const named = [
    'mnist', 'cifar10', 'cifar100', 'imagenet', 'coco',
    'squad', 'glue', 'wikitext', 'imdb', 'ag_news',
  ];
  for (const n of named) {
    if (new RegExp(`\\b${n}\\b`, 'i').test(content)) refs.add(n);
  }
  return [...refs].slice(0, 20);
}

function extractPythonImports(content) {
  const imports = new Set();
  const matches = content.match(/^(?:from\s+(\S+)\s+import|import\s+(\S+))/gm) || [];
  for (const m of matches) {
    const mod = m.match(/(?:from\s+(\S+)|import\s+(\S+))/);
    if (mod) imports.add(mod[1] || mod[2]);
  }
  return [...imports].slice(0, 50);
}

function detectMLLanguage(filename) {
  if (!filename) return 'python';
  const ext = filename.split('.').pop()?.toLowerCase();
  const map = {
    py: 'python', ipynb: 'python', yaml: 'yaml', yml: 'yaml',
    json: 'json', toml: 'toml', cfg: 'config', ini: 'config',
    md: 'markdown',
  };
  return map[ext] || 'python';
}
