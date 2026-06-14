// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Bundler — Groups related artifacts into curated marketplace bundles.
 *
 * Bundle strategies:
 *   1. Category bundles: All high-quality artifacts in the same category
 *   2. Stack bundles: Cross-type artifacts that form a complete stack
 *   3. Framework bundles: All assets for a specific framework
 *   4. Tool bundles: All artifacts for a specific tool_type
 *
 * Each bundle gets a slug, description, suggested price (discounted),
 * and quality metrics.
 */

import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';

// ── Bundle Pricing (discount from sum of individual prices) ──

const BUNDLE_DISCOUNT = 0.30; // 30% off individual prices

// ── Minimum Requirements ──

const MIN_BUNDLE_SIZE = 3;
const MIN_QUALITY = 40;

// ── Stack Definitions (cross-type bundles) ──

const STACK_DEFINITIONS = [
  {
    name: 'FastAPI Production Stack',
    slug: 'fastapi-production-stack',
    description: 'Complete FastAPI production setup: code patterns, Docker configs, K8s manifests, and CI/CD pipelines.',
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
    description: 'End-to-end ML training setup: model configs, experiment tracking, GPU infrastructure, and deployment.',
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
    description: 'Complete K8s deployment bundle: manifests, Helm charts, Terraform modules, and monitoring configs.',
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
    description: 'Production React patterns: hooks, state management, performance optimization, and testing.',
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
    description: 'Ready-to-deploy automation workflows across n8n, Airflow, and GitHub Actions.',
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
    description: 'AI agent implementations: LangChain, LangGraph, CrewAI, and custom agent patterns.',
    filters: {
      types: ['workflow', 'code_pattern', 'ai_ml_asset'],
      keywords: ['langchain', 'langgraph', 'crewai', 'agent', 'llm'],
      categories: ['ai-agent', 'generative-ai'],
    },
    tags: ['ai', 'agents', 'llm', 'langchain'],
    category: 'generative-ai',
  },
];

/**
 * Generate curated bundles from high-quality artifacts.
 *
 * @returns {{ created: number, updated: number, bundles: object[] }}
 */
export async function generateBundles() {
  logger.info('Generating artifact bundles');
  let created = 0;
  let updated = 0;
  const bundles = [];

  // Strategy 1: Stack-based bundles (curated definitions)
  for (const def of STACK_DEFINITIONS) {
    try {
      const result = await generateStackBundle(def);
      if (result) {
        bundles.push(result);
        if (result.isNew) created++;
        else updated++;
      }
    } catch (err) {
      logger.error('Stack bundle generation failed', { slug: def.slug, error: err.message });
    }
  }

  // Strategy 2: Category auto-bundles
  const categoryBundles = await generateCategoryBundles();
  for (const cb of categoryBundles) {
    bundles.push(cb);
    if (cb.isNew) created++;
    else updated++;
  }

  // Strategy 3: Framework auto-bundles
  const frameworkBundles = await generateFrameworkBundles();
  for (const fb of frameworkBundles) {
    bundles.push(fb);
    if (fb.isNew) created++;
    else updated++;
  }

  logger.info('Bundle generation complete', { created, updated, total: bundles.length });
  return { created, updated, bundles };
}

/**
 * Generate a stack-based bundle from a curated definition.
 */
async function generateStackBundle(def) {
  // Search for matching artifacts
  const typeList = def.filters.types.map((_, i) => `$${i + 2}`).join(', ');
  const result = await db.query(
    `SELECT id, artifact_type, quality_score, price_tier,
            marketplace_metadata
     FROM artifacts
     WHERE quality_score >= $1
       AND artifact_type IN (${typeList})
       AND (
         primary_category = ANY($${def.filters.types.length + 2})
         OR tags && $${def.filters.types.length + 3}
         OR name ILIKE ANY($${def.filters.types.length + 4})
       )
     ORDER BY quality_score DESC
     LIMIT 50`,
    [
      MIN_QUALITY,
      ...def.filters.types,
      def.filters.categories || [],
      def.filters.keywords || [],
      (def.filters.keywords || []).map(k => `%${k}%`),
    ]
  );

  if (result.rows.length < MIN_BUNDLE_SIZE) {
    logger.debug(`Skipping stack bundle ${def.slug}: only ${result.rows.length} artifacts`);
    return null;
  }

  const artifactIds = result.rows.map(r => r.id);
  const avgQuality = Math.round(
    result.rows.reduce((sum, r) => sum + r.quality_score, 0) / result.rows.length
  );

  // Calculate bundle price
  const totalIndividualPrice = result.rows.reduce((sum, r) => {
    const meta = typeof r.marketplace_metadata === 'string'
      ? JSON.parse(r.marketplace_metadata) : (r.marketplace_metadata || {});
    return sum + (meta.suggested_price || 0);
  }, 0);
  const suggestedPrice = Math.round(totalIndividualPrice * (1 - BUNDLE_DISCOUNT) * 100) / 100;

  const artifactTypes = [...new Set(result.rows.map(r => r.artifact_type))];

  return await upsertBundle({
    name: def.name,
    slug: def.slug,
    description: def.description,
    artifactIds,
    artifactCount: artifactIds.length,
    artifactTypes,
    category: def.category,
    tags: def.tags,
    priceTier: avgQuality >= 80 ? 'enterprise' : avgQuality >= 55 ? 'pro' : 'starter',
    suggestedPrice,
    avgQualityScore: avgQuality,
  });
}

/**
 * Auto-generate bundles by grouping artifacts with the same primary_category.
 */
async function generateCategoryBundles() {
  const result = await db.query(
    `SELECT primary_category, artifact_type, COUNT(*) as cnt
     FROM artifacts
     WHERE quality_score >= $1
       AND primary_category IS NOT NULL
       AND price_tier IS NOT NULL
       AND price_tier != 'free'
     GROUP BY primary_category, artifact_type
     HAVING COUNT(*) >= $2
     ORDER BY cnt DESC
     LIMIT 20`,
    [MIN_QUALITY, MIN_BUNDLE_SIZE]
  );

  const bundles = [];
  for (const row of result.rows) {
    const slug = `${row.primary_category}-${row.artifact_type}-bundle`;
    const name = `${formatTitle(row.primary_category)} ${formatTitle(row.artifact_type)} Bundle`;

    const artifacts = await db.query(
      `SELECT id, quality_score, marketplace_metadata
       FROM artifacts
       WHERE primary_category = $1 AND artifact_type = $2
         AND quality_score >= $3 AND price_tier != 'free'
       ORDER BY quality_score DESC
       LIMIT 25`,
      [row.primary_category, row.artifact_type, MIN_QUALITY]
    );

    if (artifacts.rows.length < MIN_BUNDLE_SIZE) continue;

    const artifactIds = artifacts.rows.map(r => r.id);
    const avgQuality = Math.round(
      artifacts.rows.reduce((sum, r) => sum + r.quality_score, 0) / artifacts.rows.length
    );
    const totalPrice = artifacts.rows.reduce((sum, r) => {
      const meta = typeof r.marketplace_metadata === 'string'
        ? JSON.parse(r.marketplace_metadata) : (r.marketplace_metadata || {});
      return sum + (meta.suggested_price || 0);
    }, 0);

    const bundle = await upsertBundle({
      name,
      slug,
      description: `Curated collection of ${artifacts.rows.length} ${formatTitle(row.primary_category)} ${row.artifact_type} assets.`,
      artifactIds,
      artifactCount: artifactIds.length,
      artifactTypes: [row.artifact_type],
      category: row.primary_category,
      tags: [row.primary_category, row.artifact_type],
      priceTier: avgQuality >= 80 ? 'enterprise' : avgQuality >= 55 ? 'pro' : 'starter',
      suggestedPrice: Math.round(totalPrice * (1 - BUNDLE_DISCOUNT) * 100) / 100,
      avgQualityScore: avgQuality,
    });

    if (bundle) bundles.push(bundle);
  }

  return bundles;
}

/**
 * Auto-generate bundles by framework (from type_metadata.framework or tool_type).
 */
async function generateFrameworkBundles() {
  const result = await db.query(
    `SELECT COALESCE(type_metadata->>'framework', tool_type) as framework,
            COUNT(*) as cnt
     FROM artifacts
     WHERE quality_score >= $1
       AND price_tier IS NOT NULL
       AND price_tier != 'free'
       AND (type_metadata->>'framework' IS NOT NULL OR tool_type IS NOT NULL)
     GROUP BY COALESCE(type_metadata->>'framework', tool_type)
     HAVING COUNT(*) >= $2
     ORDER BY cnt DESC
     LIMIT 15`,
    [MIN_QUALITY, MIN_BUNDLE_SIZE]
  );

  const bundles = [];
  for (const row of result.rows) {
    if (!row.framework) continue;
    const slug = `${row.framework}-essentials-bundle`;
    const name = `${formatTitle(row.framework)} Essentials`;

    const artifacts = await db.query(
      `SELECT id, artifact_type, quality_score, marketplace_metadata
       FROM artifacts
       WHERE (type_metadata->>'framework' = $1 OR tool_type = $1)
         AND quality_score >= $2 AND price_tier != 'free'
       ORDER BY quality_score DESC
       LIMIT 25`,
      [row.framework, MIN_QUALITY]
    );

    if (artifacts.rows.length < MIN_BUNDLE_SIZE) continue;

    const artifactIds = artifacts.rows.map(r => r.id);
    const artifactTypes = [...new Set(artifacts.rows.map(r => r.artifact_type))];
    const avgQuality = Math.round(
      artifacts.rows.reduce((sum, r) => sum + r.quality_score, 0) / artifacts.rows.length
    );
    const totalPrice = artifacts.rows.reduce((sum, r) => {
      const meta = typeof r.marketplace_metadata === 'string'
        ? JSON.parse(r.marketplace_metadata) : (r.marketplace_metadata || {});
      return sum + (meta.suggested_price || 0);
    }, 0);

    const bundle = await upsertBundle({
      name,
      slug,
      description: `Essential ${formatTitle(row.framework)} assets: ${artifactTypes.join(', ')} for production use.`,
      artifactIds,
      artifactCount: artifactIds.length,
      artifactTypes,
      category: null,
      tags: [row.framework, 'essentials'],
      priceTier: avgQuality >= 80 ? 'enterprise' : avgQuality >= 55 ? 'pro' : 'starter',
      suggestedPrice: Math.round(totalPrice * (1 - BUNDLE_DISCOUNT) * 100) / 100,
      avgQualityScore: avgQuality,
    });

    if (bundle) bundles.push(bundle);
  }

  return bundles;
}

/**
 * Upsert a bundle record.
 */
async function upsertBundle(data) {
  const existing = await db.query(
    'SELECT id FROM artifact_bundles WHERE slug = $1',
    [data.slug]
  );

  if (existing.rows.length > 0) {
    await db.query(
      `UPDATE artifact_bundles SET
        name = $1, description = $2, artifact_ids = $3,
        artifact_count = $4, artifact_types = $5,
        category = $6, tags = $7, price_tier = $8,
        suggested_price = $9, avg_quality_score = $10,
        updated_at = NOW()
      WHERE slug = $11`,
      [
        data.name, data.description, data.artifactIds,
        data.artifactCount, data.artifactTypes,
        data.category, data.tags, data.priceTier,
        data.suggestedPrice, data.avgQualityScore,
        data.slug,
      ]
    );
    return { ...data, id: existing.rows[0].id, isNew: false };
  }

  const result = await db.query(
    `INSERT INTO artifact_bundles (
      name, slug, description, artifact_ids,
      artifact_count, artifact_types, category, tags,
      price_tier, suggested_price, avg_quality_score
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING id`,
    [
      data.name, data.slug, data.description, data.artifactIds,
      data.artifactCount, data.artifactTypes, data.category, data.tags,
      data.priceTier, data.suggestedPrice, data.avgQualityScore,
    ]
  );

  return { ...data, id: result.rows[0].id, isNew: true };
}

/**
 * Format a slug or identifier as a title.
 */
export function formatTitle(str) {
  if (!str) return '';
  return str
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}
