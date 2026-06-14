// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * AI/ML Asset Classifier — Classifies AI/ML artifacts into
 * subcategories via Ollama.
 */

import { db } from '../../../db/client.js';
import { config } from '../../../config.js';
import { logger } from '../../../utils/logger.js';

const ML_CATEGORIES = [
  'nlp-text',
  'computer-vision',
  'generative-ai',
  'tabular-ml',
  'reinforcement-learning',
  'recommendation',
  'audio-speech',
  'time-series',
  'mlops-experiment',
  'data-preprocessing',
  'model-serving',
  'general-ml',
];

const PROMPT_TEMPLATE = `Classify this AI/ML asset into ONE primary category and up to 2 secondary categories.

CATEGORIES:
- nlp-text: Text classification, NER, summarization, translation, Q&A, embeddings
- computer-vision: Image classification, object detection, segmentation, OCR
- generative-ai: LLMs, text generation, image generation, diffusion models, GANs
- tabular-ml: Classification/regression on structured data, feature engineering
- reinforcement-learning: RL agents, reward shaping, environment configs
- recommendation: Collaborative filtering, content-based, ranking models
- audio-speech: ASR, TTS, audio classification, music generation
- time-series: Forecasting, anomaly detection on temporal data
- mlops-experiment: Training configs, experiment tracking, hyperparameter sweeps
- data-preprocessing: Feature pipelines, data cleaning, augmentation
- model-serving: Inference configs, model export, deployment manifests
- general-ml: General machine learning utilities and helpers

FRAMEWORK: {framework}
ML TYPE: {mlType}
Name: {name}
Description: {description}
Datasets: {datasets}

Respond in JSON format ONLY:
{
  "primary_category": "category-slug",
  "secondary_categories": ["category-slug"],
  "tags": ["relevant", "specific", "tags"]
}`;

/**
 * Classify unclassified ai_ml_asset artifacts.
 */
export async function classifyAiMlAssets(limit = 50) {
  const result = await db.query(
    `SELECT id, name, description, tool_type, type_metadata
     FROM artifacts
     WHERE artifact_type = 'ai_ml_asset' AND primary_category IS NULL
       AND publishing_status = 'raw'
     ORDER BY discovered_at DESC
     LIMIT $1`,
    [limit]
  );

  if (result.rows.length === 0) {
    logger.info('No AI/ML assets to classify');
    return { success: 0, failed: 0 };
  }

  logger.info(`Classifying ${result.rows.length} AI/ML assets`);
  let success = 0;
  let failed = 0;

  for (const row of result.rows) {
    try {
      const classification = await classifySingle(row);
      if (classification) {
        await db.query(
          `UPDATE artifacts SET
            primary_category = $1,
            secondary_categories = $2,
            tags = $3,
            publishing_status = 'enriched',
            enriched_at = NOW()
          WHERE id = $4`,
          [
            classification.primary_category,
            classification.secondary_categories || [],
            classification.tags || [],
            row.id,
          ]
        );
        success++;
      } else {
        failed++;
      }
    } catch (err) {
      logger.error('AI/ML classification failed', { id: row.id, error: err.message });
      failed++;
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  logger.info('AI/ML asset classification complete', { success, failed });
  return { success, failed };
}

async function classifySingle(row) {
  const meta = typeof row.type_metadata === 'string'
    ? JSON.parse(row.type_metadata) : (row.type_metadata || {});

  const prompt = PROMPT_TEMPLATE
    .replace('{framework}', meta.framework || row.tool_type || 'unknown')
    .replace('{mlType}', meta.ml_type || 'generic')
    .replace('{name}', row.name || 'Untitled')
    .replace('{description}', (row.description || '').slice(0, 500))
    .replace('{datasets}', (meta.dataset_refs || meta.datasets || []).slice(0, 10).join(', ') || 'none');

  const response = await fetch(`${config.ollama.host}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollama.model,
      prompt,
      stream: false,
      options: { temperature: 0.1 },
      format: 'json',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  try {
    const parsed = JSON.parse(data.response || '');

    if (!ML_CATEGORIES.includes(parsed.primary_category)) {
      parsed.primary_category = getDefaultMLCategory(meta);
    }

    if (Array.isArray(parsed.secondary_categories)) {
      parsed.secondary_categories = parsed.secondary_categories
        .filter(c => ML_CATEGORIES.includes(c));
    } else {
      parsed.secondary_categories = [];
    }

    if (!Array.isArray(parsed.tags)) parsed.tags = [];

    return parsed;
  } catch {
    logger.warn('Failed to parse AI/ML classification', { id: row.id });
    return null;
  }
}

export function getDefaultMLCategory(meta) {
  const framework = meta?.framework;
  if (!framework) return 'general-ml';

  const frameworkDefaults = {
    transformers: 'nlp-text',
    pytorch: 'general-ml',
    tensorflow: 'general-ml',
    keras: 'general-ml',
    'scikit-learn': 'tabular-ml',
    xgboost: 'tabular-ml',
    lightgbm: 'tabular-ml',
    spacy: 'nlp-text',
    langchain: 'generative-ai',
    llamaindex: 'generative-ai',
    huggingface: 'generative-ai',
    fastai: 'computer-vision',
    mlflow: 'mlops-experiment',
    ray: 'mlops-experiment',
  };

  return frameworkDefaults[framework] || 'general-ml';
}
