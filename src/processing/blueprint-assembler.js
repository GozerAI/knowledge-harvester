// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Goal-driven multi-artifact assembly into runnable project blueprints.
 *
 * Parses a natural-language goal, searches artifacts by keyword,
 * scores fit, and generates scaffold + deploy manifests + README.
 */

import { db } from '../db/client.js';

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'must', 'to', 'of', 'in',
  'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'and', 'but', 'or', 'not',
  'that', 'this', 'these', 'those', 'i', 'me', 'my', 'we', 'our', 'you', 'your',
  'it', 'its', 'they', 'them', 'their', 'what', 'which', 'who', 'whom', 'how',
  'when', 'where', 'why', 'build', 'create', 'make', 'want', 'using', 'use',
]);

export function parseGoal(goal) {
  if (!goal || typeof goal !== 'string') return [];
  return goal.toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    .slice(0, 15);
}

export function scoreArtifactFit(artifact, keywords) {
  let score = 0;
  const name = (artifact.name || '').toLowerCase();
  const description = (artifact.description || '').toLowerCase();
  const tags = (artifact.tags || []).map(t => t.toLowerCase());
  const understanding = artifact.type_metadata?.understanding || {};

  for (const kw of keywords) {
    if (name.includes(kw)) score += 3;
    if (description.includes(kw)) score += 2;
    if (tags.some(t => t.includes(kw))) score += 2;

    const allUnderstanding = [
      ...(understanding.cloud_services || []),
      ...(understanding.integrations || []),
      ...(understanding.problems_solved || []),
      ...(understanding.prerequisites || []),
      understanding.architecture_pattern || '',
    ].map(s => s.toLowerCase());

    if (allUnderstanding.some(u => u.includes(kw))) score += 1;
  }

  // Quality bonus
  score += (artifact.quality_score || 0) / 20;

  // Canonical bonus
  if (artifact.is_canonical) score += 2;

  return score;
}

export async function searchArtifacts(pool, keywords, maxArtifacts = 5) {
  const searchTerms = keywords.map(k => `%${k}%`);

  const conditions = searchTerms.map((_, i) =>
    `(LOWER(name) LIKE $${i + 1} OR LOWER(description) LIKE $${i + 1} OR EXISTS (SELECT 1 FROM unnest(tags) t WHERE LOWER(t) LIKE $${i + 1}))`
  ).join(' OR ');

  const result = await pool.query(
    `SELECT id, name, description, artifact_type, tags, type_metadata, quality_score, content
     FROM artifacts
     WHERE ${conditions}
     ORDER BY quality_score DESC NULLS LAST
     LIMIT $${searchTerms.length + 1}`,
    [...searchTerms, maxArtifacts * 3]
  );

  return result.rows.map(row => ({
    ...row,
    type_metadata: typeof row.type_metadata === 'string' ? JSON.parse(row.type_metadata) : (row.type_metadata || {}),
  }));
}

export function generateScaffold(artifacts) {
  const scaffold = {
    name: 'blueprint-project',
    structure: {
      'README.md': { type: 'file', generated: true },
      'docker-compose.yml': { type: 'file', generated: true },
      src: { type: 'directory', children: {} },
      config: { type: 'directory', children: {} },
      docs: { type: 'directory', children: {} },
    },
    artifacts: artifacts.map(a => ({
      id: a.id,
      name: a.name,
      type: a.artifact_type,
      path: `src/${a.artifact_type}/${a.name}`,
    })),
    dependencies: [],
    environment: {},
  };

  const deps = new Set();
  for (const artifact of artifacts) {
    const understanding = artifact.type_metadata?.understanding || {};
    for (const prereq of (understanding.prerequisites || [])) {
      deps.add(prereq);
    }
  }
  scaffold.dependencies = [...deps];

  return scaffold;
}

export function generateDeployManifest(artifacts, target = 'docker-compose') {
  if (target === 'docker-compose') {
    const services = {};
    for (const artifact of artifacts) {
      const safeName = (artifact.name || 'service').replace(/[^a-z0-9-]/gi, '-').toLowerCase();
      services[safeName] = {
        build: `./${artifact.artifact_type}/${artifact.name}`,
        restart: 'unless-stopped',
      };
    }
    return { version: '3.8', services };
  }

  if (target === 'kubernetes') {
    return {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'blueprint-deployment' },
      spec: {
        replicas: 1,
        template: {
          spec: {
            containers: artifacts.map(a => ({
              name: (a.name || 'app').replace(/[^a-z0-9-]/gi, '-').toLowerCase(),
              image: `blueprint/${a.name || 'app'}:latest`,
            })),
          },
        },
      },
    };
  }

  return {};
}

export function generateReadme(goal, artifacts) {
  const lines = [
    `# Blueprint: ${goal}`,
    '',
    `> Auto-assembled from ${artifacts.length} knowledge artifacts.`,
    '',
    '## Included Artifacts',
    '',
  ];

  for (const a of artifacts) {
    const understanding = a.type_metadata?.understanding || {};
    lines.push(`### ${a.name}`);
    lines.push(`- **Type:** ${a.artifact_type}`);
    if (a.description) lines.push(`- **Description:** ${a.description}`);
    if (understanding.architecture_pattern && understanding.architecture_pattern !== 'unknown') {
      lines.push(`- **Pattern:** ${understanding.architecture_pattern}`);
    }
    if (understanding.problems_solved?.length) {
      lines.push(`- **Solves:** ${understanding.problems_solved.join(', ')}`);
    }
    lines.push('');
  }

  lines.push('## Quick Start');
  lines.push('');
  lines.push('```bash');
  lines.push('docker-compose up -d');
  lines.push('```');

  return lines.join('\n');
}

export async function assembleBlueprint(pool, goal, maxArtifacts = 5) {
  const keywords = parseGoal(goal);

  if (keywords.length === 0) {
    return { error: 'Could not extract keywords from goal' };
  }

  const candidates = await searchArtifacts(pool, keywords, maxArtifacts);

  const scored = candidates.map(a => ({ ...a, fit_score: scoreArtifactFit(a, keywords) }));
  scored.sort((a, b) => b.fit_score - a.fit_score);

  const selected = scored.slice(0, maxArtifacts);

  if (selected.length === 0) {
    return { error: 'No matching artifacts found', keywords };
  }

  const scaffold = generateScaffold(selected);
  const deployManifests = {
    'docker-compose': generateDeployManifest(selected, 'docker-compose'),
    kubernetes: generateDeployManifest(selected, 'kubernetes'),
  };
  const readme = generateReadme(goal, selected);

  const result = await pool.query(
    `INSERT INTO blueprints (id, goal, parsed_keywords, artifact_ids, scaffold, deploy_manifests, combined_readme, status)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'ready')
     RETURNING id, created_at`,
    [
      goal,
      keywords,
      selected.map(a => a.id),
      JSON.stringify(scaffold),
      JSON.stringify(deployManifests),
      readme,
    ]
  );

  return {
    id: result.rows[0].id,
    goal,
    keywords,
    artifacts_selected: selected.length,
    artifact_ids: selected.map(a => a.id),
    scaffold,
    deploy_manifests: deployManifests,
    readme,
    created_at: result.rows[0].created_at,
  };
}
