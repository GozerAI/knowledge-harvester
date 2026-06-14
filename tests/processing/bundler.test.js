// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Re-implement pure functions for testing ──

const BUNDLE_DISCOUNT = 0.30;
const MIN_BUNDLE_SIZE = 3;
const MIN_QUALITY = 40;

const STACK_DEFINITIONS = [
  {
    name: 'FastAPI Production Stack',
    slug: 'fastapi-production-stack',
    filters: {
      types: ['code_pattern', 'infra_config'],
      keywords: ['fastapi', 'python', 'docker', 'kubernetes'],
      categories: ['api-pattern', 'infrastructure-as-code', 'ci-cd-pipeline', 'orchestration'],
    },
    tags: ['fastapi', 'python', 'production', 'full-stack'],
    category: 'api-pattern',
  },
  {
    name: 'ML Training Pipeline',
    slug: 'ml-training-pipeline',
    filters: {
      types: ['ai_ml_asset', 'infra_config', 'code_pattern'],
      keywords: ['pytorch', 'tensorflow', 'training', 'gpu', 'mlflow', 'wandb'],
      categories: ['mlops-experiment', 'generative-ai', 'nlp-text', 'computer-vision'],
    },
    tags: ['ml', 'training', 'pipeline', 'gpu'],
    category: 'mlops-experiment',
  },
  {
    name: 'Kubernetes Deployment Kit',
    slug: 'kubernetes-deployment-kit',
    filters: {
      types: ['infra_config'],
      keywords: ['kubernetes', 'k8s', 'helm', 'terraform', 'docker'],
      categories: ['orchestration', 'infrastructure-as-code', 'devops-monitoring'],
    },
    tags: ['kubernetes', 'devops', 'infrastructure', 'deployment'],
    category: 'orchestration',
  },
  {
    name: 'React Frontend Patterns',
    slug: 'react-frontend-patterns',
    filters: {
      types: ['code_pattern'],
      keywords: ['react', 'typescript', 'nextjs', 'hooks'],
      categories: ['design-pattern', 'testing-pattern'],
    },
    tags: ['react', 'typescript', 'frontend', 'patterns'],
    category: 'design-pattern',
  },
  {
    name: 'Automation Starter Pack',
    slug: 'automation-starter-pack',
    filters: {
      types: ['workflow'],
      keywords: ['n8n', 'airflow', 'github-actions', 'automation'],
      categories: ['multi-step-automation', 'data-pipeline', 'ci-cd-pipeline'],
    },
    tags: ['automation', 'workflows', 'starter-pack'],
    category: 'multi-step-automation',
  },
  {
    name: 'AI Agent Collection',
    slug: 'ai-agent-collection',
    filters: {
      types: ['workflow', 'code_pattern', 'ai_ml_asset'],
      keywords: ['langchain', 'langgraph', 'crewai', 'agent', 'llm'],
      categories: ['ai-agent', 'generative-ai'],
    },
    tags: ['ai', 'agents', 'llm', 'langchain'],
    category: 'generative-ai',
  },
];

function formatTitle(str) {
  if (!str) return '';
  return str.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function calculateBundlePrice(individualPrices) {
  const total = individualPrices.reduce((sum, p) => sum + p, 0);
  return Math.round(total * (1 - BUNDLE_DISCOUNT) * 100) / 100;
}

function determineBundleTier(avgQuality) {
  if (avgQuality >= 80) return 'enterprise';
  if (avgQuality >= 55) return 'pro';
  return 'starter';
}

function generateSlug(category, artifactType) {
  return `${category}-${artifactType}-bundle`;
}

function generateBundleName(category, artifactType) {
  return `${formatTitle(category)} ${formatTitle(artifactType)} Bundle`;
}

// ── Tests ──

describe('Stack Definitions', () => {
  it('has 6 curated stack definitions', () => {
    assert.equal(STACK_DEFINITIONS.length, 6);
  });

  it('all have required fields', () => {
    for (const def of STACK_DEFINITIONS) {
      assert.ok(def.name, `${def.slug} missing name`);
      assert.ok(def.slug, 'missing slug');
      assert.ok(def.filters.types.length > 0, `${def.slug} missing types`);
      assert.ok(def.filters.keywords.length > 0, `${def.slug} missing keywords`);
      assert.ok(def.filters.categories.length > 0, `${def.slug} missing categories`);
      assert.ok(def.tags.length > 0, `${def.slug} missing tags`);
      assert.ok(def.category, `${def.slug} missing category`);
    }
  });

  it('all slugs are unique', () => {
    const slugs = STACK_DEFINITIONS.map(d => d.slug);
    const unique = [...new Set(slugs)];
    assert.equal(slugs.length, unique.length);
  });

  it('FastAPI stack spans code and infra types', () => {
    const fastapi = STACK_DEFINITIONS.find(d => d.slug === 'fastapi-production-stack');
    assert.ok(fastapi.filters.types.includes('code_pattern'));
    assert.ok(fastapi.filters.types.includes('infra_config'));
  });

  it('ML pipeline spans three artifact types', () => {
    const ml = STACK_DEFINITIONS.find(d => d.slug === 'ml-training-pipeline');
    assert.equal(ml.filters.types.length, 3);
    assert.ok(ml.filters.types.includes('ai_ml_asset'));
    assert.ok(ml.filters.types.includes('infra_config'));
    assert.ok(ml.filters.types.includes('code_pattern'));
  });

  it('AI Agent collection spans workflows and ML', () => {
    const agents = STACK_DEFINITIONS.find(d => d.slug === 'ai-agent-collection');
    assert.ok(agents.filters.types.includes('workflow'));
    assert.ok(agents.filters.types.includes('code_pattern'));
    assert.ok(agents.filters.types.includes('ai_ml_asset'));
  });
});

describe('calculateBundlePrice', () => {
  it('applies 30% discount', () => {
    const price = calculateBundlePrice([10, 10, 10]);
    assert.equal(price, 21);
  });

  it('handles single item', () => {
    const price = calculateBundlePrice([9.99]);
    assert.equal(price, 6.99);
  });

  it('handles empty list', () => {
    const price = calculateBundlePrice([]);
    assert.equal(price, 0);
  });

  it('rounds to 2 decimal places', () => {
    const price = calculateBundlePrice([3.33, 4.44, 5.55]);
    const str = price.toString();
    const decimals = str.includes('.') ? str.split('.')[1].length : 0;
    assert.ok(decimals <= 2, `Price ${price} should have <= 2 decimals`);
  });
});

describe('determineBundleTier', () => {
  it('assigns enterprise for high quality', () => {
    assert.equal(determineBundleTier(85), 'enterprise');
    assert.equal(determineBundleTier(80), 'enterprise');
  });

  it('assigns pro for medium quality', () => {
    assert.equal(determineBundleTier(65), 'pro');
    assert.equal(determineBundleTier(55), 'pro');
  });

  it('assigns starter for lower quality', () => {
    assert.equal(determineBundleTier(40), 'starter');
    assert.equal(determineBundleTier(54), 'starter');
  });
});

describe('generateSlug', () => {
  it('creates category-type slug', () => {
    assert.equal(generateSlug('api-pattern', 'code_pattern'), 'api-pattern-code_pattern-bundle');
  });

  it('handles hyphenated categories', () => {
    assert.equal(
      generateSlug('infrastructure-as-code', 'infra_config'),
      'infrastructure-as-code-infra_config-bundle'
    );
  });
});

describe('generateBundleName', () => {
  it('creates readable title', () => {
    assert.equal(
      generateBundleName('api-pattern', 'code_pattern'),
      'Api Pattern Code Pattern Bundle'
    );
  });

  it('handles single-word segments', () => {
    assert.equal(generateBundleName('orchestration', 'workflow'), 'Orchestration Workflow Bundle');
  });
});

describe('Bundle Constants', () => {
  it('discount is 30%', () => {
    assert.equal(BUNDLE_DISCOUNT, 0.30);
  });

  it('minimum bundle size is 3', () => {
    assert.equal(MIN_BUNDLE_SIZE, 3);
  });

  it('minimum quality is 40', () => {
    assert.equal(MIN_QUALITY, 40);
  });
});

describe('Bundle Filtering Logic', () => {
  it('filters artifacts by minimum quality', () => {
    const artifacts = [
      { quality_score: 80 },
      { quality_score: 30 },
      { quality_score: 60 },
      { quality_score: 20 },
    ];
    const eligible = artifacts.filter(a => a.quality_score >= MIN_QUALITY);
    assert.equal(eligible.length, 2);
  });

  it('requires minimum bundle size', () => {
    const small = [{ id: 1 }, { id: 2 }];
    const large = [{ id: 1 }, { id: 2 }, { id: 3 }];
    assert.ok(small.length < MIN_BUNDLE_SIZE);
    assert.ok(large.length >= MIN_BUNDLE_SIZE);
  });

  it('averages quality scores correctly', () => {
    const scores = [80, 60, 70, 90];
    const avg = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
    assert.equal(avg, 75);
  });

  it('deduplicates artifact types', () => {
    const types = ['code_pattern', 'infra_config', 'code_pattern', 'ai_ml_asset', 'infra_config'];
    const unique = [...new Set(types)];
    assert.equal(unique.length, 3);
  });
});
