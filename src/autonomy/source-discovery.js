// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #697 — Autonomous Source Discovery
 *
 * Discovers new potential harvesting sources by analyzing existing artifacts,
 * finding related repositories, registries, and communities that could yield
 * valuable knowledge artifacts.
 */

const DISCOVERY_STRATEGIES = ['reference_mining', 'dependency_tracing', 'community_mapping', 'registry_scan'];

/**
 * @typedef {object} DiscoveredSource
 * @property {string} name
 * @property {string} url
 * @property {string} strategy - how it was discovered
 * @property {string} type - 'repository' | 'registry' | 'community' | 'api'
 * @property {number} relevance_score - 0-1
 * @property {string[]} related_categories
 * @property {string} discovered_at
 */

/**
 * Run autonomous source discovery across all strategies.
 * @param {object} db
 * @param {object} [options]
 * @param {string[]} [options.strategies]
 * @param {number} [options.limit]
 * @returns {Promise<{ sources: DiscoveredSource[], summary: object }>}
 */
export async function discoverSources(db, options = {}) {
  const strategies = options.strategies || DISCOVERY_STRATEGIES;
  const limit = options.limit || 50;
  const allSources = [];

  for (const strategy of strategies) {
    const discovered = await runStrategy(db, strategy, limit);
    allSources.push(...discovered);
  }

  // Deduplicate by URL
  const seen = new Set();
  const unique = allSources.filter(s => {
    const key = s.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by relevance
  unique.sort((a, b) => b.relevance_score - a.relevance_score);
  const trimmed = unique.slice(0, limit);

  return {
    sources: trimmed,
    summary: {
      total_discovered: trimmed.length,
      by_strategy: countByField(trimmed, 'strategy'),
      by_type: countByField(trimmed, 'type'),
      discovered_at: new Date().toISOString(),
    },
  };
}

/**
 * Run a single discovery strategy.
 */
async function runStrategy(db, strategy, limit) {
  switch (strategy) {
    case 'reference_mining': return mineReferences(db, limit);
    case 'dependency_tracing': return traceDependencies(db, limit);
    case 'community_mapping': return mapCommunities(db, limit);
    case 'registry_scan': return scanRegistries(db, limit);
    default: return [];
  }
}

/**
 * Mine references from artifact metadata (source URLs, dependencies, links).
 */
async function mineReferences(db, limit) {
  const result = await db.query(
    `SELECT DISTINCT source_url, primary_category, artifact_type
     FROM artifacts
     WHERE source_url IS NOT NULL
     ORDER BY quality_score DESC NULLS LAST
     LIMIT $1`,
    [limit * 2]
  );

  const discovered = [];
  for (const row of result.rows) {
    const derived = deriveRelatedSources(row.source_url, row.primary_category);
    for (const src of derived) {
      discovered.push({
        name: src.name,
        url: src.url,
        strategy: 'reference_mining',
        type: src.type,
        relevance_score: src.relevance,
        related_categories: [row.primary_category || 'unknown'],
        discovered_at: new Date().toISOString(),
      });
    }
  }
  return discovered;
}

/**
 * Trace dependency references to discover upstream/downstream sources.
 */
async function traceDependencies(db, limit) {
  const result = await db.query(
    `SELECT id, name, type_metadata
     FROM artifacts
     WHERE type_metadata IS NOT NULL
     ORDER BY quality_score DESC NULLS LAST
     LIMIT $1`,
    [limit]
  );

  const discovered = [];
  for (const row of result.rows) {
    const meta = typeof row.type_metadata === 'string'
      ? JSON.parse(row.type_metadata) : row.type_metadata;
    const deps = extractDependencies(meta);
    for (const dep of deps) {
      discovered.push({
        name: dep.name,
        url: dep.url,
        strategy: 'dependency_tracing',
        type: 'repository',
        relevance_score: 0.6,
        related_categories: [row.primary_category || 'tooling'],
        discovered_at: new Date().toISOString(),
      });
    }
  }
  return discovered;
}

/**
 * Map communities related to existing knowledge domains.
 */
async function mapCommunities(db, limit) {
  const result = await db.query(
    `SELECT primary_category, COUNT(*)::int AS cnt
     FROM artifacts
     WHERE primary_category IS NOT NULL
     GROUP BY primary_category
     ORDER BY cnt DESC
     LIMIT $1`,
    [limit]
  );

  const discovered = [];
  for (const row of result.rows) {
    const communities = getCommunityMappings(row.primary_category);
    for (const c of communities) {
      discovered.push({
        name: c.name,
        url: c.url,
        strategy: 'community_mapping',
        type: 'community',
        relevance_score: c.relevance,
        related_categories: [row.primary_category],
        discovered_at: new Date().toISOString(),
      });
    }
  }
  return discovered;
}

/**
 * Scan known registries for new source candidates.
 */
async function scanRegistries(db, limit) {
  const result = await db.query(
    `SELECT DISTINCT source
     FROM artifacts
     WHERE source IS NOT NULL`
  );

  const existingSources = new Set(result.rows.map(r => r.source));
  const registries = getKnownRegistries();

  return registries
    .filter(r => !existingSources.has(r.source_name))
    .slice(0, limit)
    .map(r => ({
      name: r.name,
      url: r.url,
      strategy: 'registry_scan',
      type: 'registry',
      relevance_score: r.relevance,
      related_categories: r.categories,
      discovered_at: new Date().toISOString(),
    }));
}

/**
 * Derive related source URLs from a known URL pattern.
 */
function deriveRelatedSources(sourceUrl, category) {
  const sources = [];
  if (!sourceUrl) return sources;

  // If it's a GitHub repo, suggest the org's other repos
  const ghMatch = sourceUrl.match(/github\.com\/([^/]+)\//);
  if (ghMatch) {
    sources.push({
      name: `${ghMatch[1]}-org`,
      url: `https://github.com/${ghMatch[1]}`,
      type: 'repository',
      relevance: 0.7,
    });
  }

  return sources;
}

/**
 * Extract dependency references from artifact metadata.
 */
function extractDependencies(metadata) {
  const deps = [];
  if (!metadata) return deps;

  const depFields = ['dependencies', 'requires', 'imports', 'packages'];
  for (const field of depFields) {
    const val = metadata[field];
    if (Array.isArray(val)) {
      for (const d of val) {
        if (typeof d === 'string' && d.includes('/')) {
          deps.push({ name: d, url: `https://github.com/${d}` });
        }
      }
    } else if (typeof val === 'object' && val !== null) {
      for (const key of Object.keys(val)) {
        if (key.includes('/')) {
          deps.push({ name: key, url: `https://github.com/${key}` });
        }
      }
    }
  }
  return deps;
}

/**
 * Map categories to known communities.
 */
function getCommunityMappings(category) {
  const mappings = {
    automation: [
      { name: 'n8n-community', url: 'https://community.n8n.io', relevance: 0.9 },
      { name: 'make-community', url: 'https://community.make.com', relevance: 0.7 },
    ],
    'ai-agents': [
      { name: 'langchain-discord', url: 'https://discord.gg/langchain', relevance: 0.8 },
      { name: 'huggingface-hub', url: 'https://huggingface.co', relevance: 0.85 },
    ],
    devops: [
      { name: 'cncf-landscape', url: 'https://landscape.cncf.io', relevance: 0.8 },
      { name: 'awesome-devops', url: 'https://github.com/wmariuss/awesome-devops', relevance: 0.7 },
    ],
    'data-engineering': [
      { name: 'dbt-community', url: 'https://community.getdbt.com', relevance: 0.8 },
      { name: 'airbyte-community', url: 'https://community.airbyte.com', relevance: 0.7 },
    ],
  };
  return mappings[category] || [];
}

/**
 * Known registries that could be new harvesting sources.
 */
function getKnownRegistries() {
  return [
    { name: 'Terraform Registry', source_name: 'terraform-registry', url: 'https://registry.terraform.io', relevance: 0.85, categories: ['infra_config'] },
    { name: 'Helm Hub', source_name: 'helm-hub', url: 'https://artifacthub.io', relevance: 0.8, categories: ['infra_config'] },
    { name: 'Docker Hub', source_name: 'docker-hub', url: 'https://hub.docker.com', relevance: 0.75, categories: ['infra_config'] },
    { name: 'PyPI', source_name: 'pypi', url: 'https://pypi.org', relevance: 0.6, categories: ['code_pattern'] },
    { name: 'npm Registry', source_name: 'npm', url: 'https://www.npmjs.com', relevance: 0.6, categories: ['code_pattern'] },
    { name: 'Awesome Lists', source_name: 'awesome-lists', url: 'https://github.com/sindresorhus/awesome', relevance: 0.7, categories: ['documentation'] },
  ];
}

function countByField(arr, field) {
  const counts = {};
  for (const item of arr) {
    const val = item[field];
    counts[val] = (counts[val] || 0) + 1;
  }
  return counts;
}

/**
 * Persist discovered sources for later harvester bootstrapping.
 * @param {object} db
 * @param {DiscoveredSource[]} sources
 */
export async function persistDiscoveredSources(db, sources) {
  let inserted = 0;
  for (const src of sources) {
    try {
      await db.query(
        `INSERT INTO discovered_sources (name, url, strategy, type, relevance_score, related_categories, discovered_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (url) DO UPDATE SET relevance_score = GREATEST(discovered_sources.relevance_score, EXCLUDED.relevance_score)`,
        [src.name, src.url, src.strategy, src.type, src.relevance_score, JSON.stringify(src.related_categories), src.discovered_at]
      );
      inserted++;
    } catch {
      // Table may not exist — graceful degradation
    }
  }
  return { inserted };
}
