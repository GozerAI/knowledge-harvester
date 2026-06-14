// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// ── Reimplemented pure functions from blueprint-assembler.js ──

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

function parseGoal(goal) {
  if (!goal || typeof goal !== 'string') return [];
  return goal.toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    .slice(0, 15);
}

function scoreArtifactFit(artifact, keywords) {
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

  score += (artifact.quality_score || 0) / 20;
  if (artifact.is_canonical) score += 2;
  return score;
}

function generateScaffold(artifacts) {
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

function generateDeployManifest(artifacts, target = 'docker-compose') {
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

function generateReadme(goal, artifacts) {
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

// ── Mock artifact helper ──

function makeArtifact(overrides = {}) {
  return {
    id: randomUUID(),
    name: 'test-artifact',
    description: 'A test artifact for blueprint assembly',
    artifact_type: 'code_pattern',
    tags: ['python', 'fastapi'],
    type_metadata: {
      understanding: {
        cloud_services: ['aws-lambda'],
        integrations: ['postgresql'],
        problems_solved: ['api routing'],
        prerequisites: ['python3', 'pip'],
        architecture_pattern: 'microservice',
      },
    },
    quality_score: 80,
    is_canonical: false,
    ...overrides,
  };
}

// ── Mock DB helper ──

function mockDb(queryResponses = []) {
  let callIndex = 0;
  return {
    query: async (sql, params) => {
      if (callIndex < queryResponses.length) {
        const resp = queryResponses[callIndex++];
        if (typeof resp === 'function') return resp(sql, params);
        return resp;
      }
      return { rows: [] };
    },
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Blueprint Assembler', () => {

  // ── parseGoal ──

  describe('parseGoal', () => {
    it('extracts meaningful keywords', () => {
      const keywords = parseGoal('build a fastapi microservice with postgresql');
      assert.ok(keywords.includes('fastapi'));
      assert.ok(keywords.includes('microservice'));
      assert.ok(keywords.includes('postgresql'));
    });

    it('filters stop words', () => {
      const keywords = parseGoal('build a service with the best tools');
      assert.ok(!keywords.includes('build'));
      assert.ok(!keywords.includes('the'));
      assert.ok(!keywords.includes('with'));
    });

    it('handles empty string', () => {
      assert.deepEqual(parseGoal(''), []);
    });

    it('handles null/undefined', () => {
      assert.deepEqual(parseGoal(null), []);
      assert.deepEqual(parseGoal(undefined), []);
    });

    it('limits to 15 keywords', () => {
      const longGoal = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo';
      const keywords = parseGoal(longGoal);
      assert.ok(keywords.length <= 15);
    });

    it('lowercases all keywords', () => {
      const keywords = parseGoal('FastAPI Docker Kubernetes');
      for (const kw of keywords) {
        assert.equal(kw, kw.toLowerCase());
      }
    });

    it('handles special characters', () => {
      const keywords = parseGoal('build a service (with) @decorators & hooks!');
      for (const kw of keywords) {
        assert.ok(/^[\w-]+$/.test(kw), `keyword "${kw}" contains special chars`);
      }
    });

    it('filters short words (<=2 chars)', () => {
      const keywords = parseGoal('go to db via api now');
      assert.ok(!keywords.includes('go'));
      assert.ok(!keywords.includes('to'));
      assert.ok(!keywords.includes('db'));
      // 'via' and 'api' and 'now' are 3 chars — 'via' is not a stop word
      assert.ok(keywords.includes('via'));
      assert.ok(keywords.includes('api'));
    });
  });

  // ── scoreArtifactFit ──

  describe('scoreArtifactFit', () => {
    it('scores name matches highest (3 pts)', () => {
      const artifact = makeArtifact({ name: 'fastapi-service', description: '', tags: [], type_metadata: {} });
      const score = scoreArtifactFit(artifact, ['fastapi']);
      assert.ok(score >= 3, `Expected >=3, got ${score}`);
    });

    it('scores description matches (2 pts)', () => {
      const artifact = makeArtifact({ name: 'thing', description: 'uses fastapi framework', tags: [], type_metadata: {} });
      const score = scoreArtifactFit(artifact, ['fastapi']);
      assert.ok(score >= 2, `Expected >=2, got ${score}`);
    });

    it('scores tag matches (2 pts)', () => {
      const artifact = makeArtifact({ name: 'thing', description: '', tags: ['fastapi'], type_metadata: {} });
      const score = scoreArtifactFit(artifact, ['fastapi']);
      assert.ok(score >= 2, `Expected >=2, got ${score}`);
    });

    it('scores understanding fields (1 pt)', () => {
      const artifact = makeArtifact({
        name: 'thing', description: '', tags: [],
        type_metadata: { understanding: { cloud_services: ['aws-lambda'] } },
      });
      const score = scoreArtifactFit(artifact, ['aws-lambda']);
      assert.ok(score >= 1, `Expected >=1, got ${score}`);
    });

    it('adds quality bonus', () => {
      const high = makeArtifact({ name: 'x', description: '', tags: [], type_metadata: {}, quality_score: 100 });
      const low = makeArtifact({ name: 'x', description: '', tags: [], type_metadata: {}, quality_score: 0 });
      const highScore = scoreArtifactFit(high, ['unrelated']);
      const lowScore = scoreArtifactFit(low, ['unrelated']);
      assert.ok(highScore > lowScore);
    });

    it('adds canonical bonus', () => {
      const canonical = makeArtifact({ name: 'x', description: '', tags: [], type_metadata: {}, is_canonical: true, quality_score: 0 });
      const regular = makeArtifact({ name: 'x', description: '', tags: [], type_metadata: {}, is_canonical: false, quality_score: 0 });
      const canonScore = scoreArtifactFit(canonical, ['unrelated']);
      const regScore = scoreArtifactFit(regular, ['unrelated']);
      assert.ok(canonScore > regScore);
    });

    it('handles missing fields gracefully', () => {
      const artifact = { id: randomUUID() }; // minimal
      const score = scoreArtifactFit(artifact, ['test']);
      assert.equal(typeof score, 'number');
    });

    it('returns 0 for no matches', () => {
      const artifact = makeArtifact({ name: 'thing', description: 'stuff', tags: ['misc'], type_metadata: {}, quality_score: 0 });
      const score = scoreArtifactFit(artifact, ['zzzznotfound']);
      assert.equal(score, 0);
    });
  });

  // ── generateScaffold ──

  describe('generateScaffold', () => {
    it('creates project structure', () => {
      const artifacts = [makeArtifact()];
      const scaffold = generateScaffold(artifacts);
      assert.ok(scaffold.structure);
      assert.ok(scaffold.structure['README.md']);
      assert.ok(scaffold.structure['docker-compose.yml']);
      assert.ok(scaffold.structure.src);
      assert.ok(scaffold.structure.config);
      assert.ok(scaffold.structure.docs);
    });

    it('includes all artifacts', () => {
      const artifacts = [makeArtifact({ name: 'a1' }), makeArtifact({ name: 'a2' })];
      const scaffold = generateScaffold(artifacts);
      assert.equal(scaffold.artifacts.length, 2);
      assert.equal(scaffold.artifacts[0].name, 'a1');
      assert.equal(scaffold.artifacts[1].name, 'a2');
    });

    it('extracts dependencies from understanding', () => {
      const artifacts = [makeArtifact({
        type_metadata: { understanding: { prerequisites: ['python3', 'pip'] } },
      })];
      const scaffold = generateScaffold(artifacts);
      assert.ok(scaffold.dependencies.includes('python3'));
      assert.ok(scaffold.dependencies.includes('pip'));
    });

    it('handles empty artifact list', () => {
      const scaffold = generateScaffold([]);
      assert.equal(scaffold.artifacts.length, 0);
      assert.equal(scaffold.dependencies.length, 0);
    });

    it('deduplicates dependencies', () => {
      const artifacts = [
        makeArtifact({ type_metadata: { understanding: { prerequisites: ['python3', 'docker'] } } }),
        makeArtifact({ type_metadata: { understanding: { prerequisites: ['python3', 'npm'] } } }),
      ];
      const scaffold = generateScaffold(artifacts);
      const python3Count = scaffold.dependencies.filter(d => d === 'python3').length;
      assert.equal(python3Count, 1);
    });
  });

  // ── generateDeployManifest ──

  describe('generateDeployManifest', () => {
    it('generates docker-compose format', () => {
      const artifacts = [makeArtifact({ name: 'my-service', artifact_type: 'code_pattern' })];
      const manifest = generateDeployManifest(artifacts, 'docker-compose');
      assert.equal(manifest.version, '3.8');
      assert.ok(manifest.services);
      assert.ok(manifest.services['my-service']);
      assert.equal(manifest.services['my-service'].restart, 'unless-stopped');
    });

    it('generates kubernetes format', () => {
      const artifacts = [makeArtifact({ name: 'my-service' })];
      const manifest = generateDeployManifest(artifacts, 'kubernetes');
      assert.equal(manifest.apiVersion, 'apps/v1');
      assert.equal(manifest.kind, 'Deployment');
      assert.ok(manifest.spec.template.spec.containers.length > 0);
    });

    it('returns empty for unknown target', () => {
      const manifest = generateDeployManifest([makeArtifact()], 'unknown-target');
      assert.deepEqual(manifest, {});
    });

    it('sanitizes service names', () => {
      const artifacts = [makeArtifact({ name: 'My Service (v2)' })];
      const manifest = generateDeployManifest(artifacts, 'docker-compose');
      const keys = Object.keys(manifest.services);
      for (const key of keys) {
        assert.ok(/^[a-z0-9-]+$/.test(key), `service name "${key}" not sanitized`);
      }
    });

    it('handles artifacts with special chars in name', () => {
      const artifacts = [makeArtifact({ name: 'test@artifact#1!' })];
      const manifest = generateDeployManifest(artifacts, 'kubernetes');
      const containerName = manifest.spec.template.spec.containers[0].name;
      assert.ok(/^[a-z0-9-]+$/.test(containerName), `container name "${containerName}" not sanitized`);
    });
  });

  // ── generateReadme ──

  describe('generateReadme', () => {
    it('includes goal in title', () => {
      const readme = generateReadme('deploy a fastapi app', []);
      assert.ok(readme.includes('deploy a fastapi app'));
    });

    it('lists all artifacts', () => {
      const artifacts = [
        makeArtifact({ name: 'artifact-alpha', artifact_type: 'code_pattern' }),
        makeArtifact({ name: 'artifact-beta', artifact_type: 'infra_config' }),
      ];
      const readme = generateReadme('test goal', artifacts);
      assert.ok(readme.includes('artifact-alpha'));
      assert.ok(readme.includes('artifact-beta'));
    });

    it('includes architecture patterns', () => {
      const artifacts = [makeArtifact({
        name: 'svc',
        type_metadata: { understanding: { architecture_pattern: 'event-driven' } },
      })];
      const readme = generateReadme('test', artifacts);
      assert.ok(readme.includes('event-driven'));
    });

    it('includes problems solved', () => {
      const artifacts = [makeArtifact({
        name: 'svc',
        type_metadata: { understanding: { problems_solved: ['api routing', 'auth'] } },
      })];
      const readme = generateReadme('test', artifacts);
      assert.ok(readme.includes('api routing'));
      assert.ok(readme.includes('auth'));
    });

    it('includes quick start section', () => {
      const readme = generateReadme('test', []);
      assert.ok(readme.includes('## Quick Start'));
      assert.ok(readme.includes('docker-compose up -d'));
    });
  });

  // ── assembleBlueprint (integration with mock DB) ──

  describe('assembleBlueprint', () => {
    // Reimplemented assembleBlueprint with mock DB
    async function assembleBlueprint(pool, goal, maxArtifacts = 5) {
      const keywords = parseGoal(goal);
      if (keywords.length === 0) {
        return { error: 'Could not extract keywords from goal' };
      }

      // Simulate searchArtifacts
      const searchResult = await pool.query('SEARCH', []);
      const candidates = searchResult.rows.map(row => ({
        ...row,
        type_metadata: typeof row.type_metadata === 'string' ? JSON.parse(row.type_metadata) : (row.type_metadata || {}),
      }));

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

      // Simulate INSERT
      const insertResult = await pool.query('INSERT', [goal]);
      return {
        id: insertResult.rows[0].id,
        goal,
        keywords,
        artifacts_selected: selected.length,
        artifact_ids: selected.map(a => a.id),
        scaffold,
        deploy_manifests: deployManifests,
        readme,
        created_at: insertResult.rows[0].created_at,
      };
    }

    it('full assembly with mock db', async () => {
      const a1 = makeArtifact({ name: 'fastapi-template', description: 'a fastapi starter' });
      const a2 = makeArtifact({ name: 'docker-setup', description: 'docker configuration' });
      const blueprintId = randomUUID();

      const db = mockDb([
        { rows: [a1, a2] },  // search
        { rows: [{ id: blueprintId, created_at: new Date().toISOString() }] },  // insert
      ]);

      const result = await assembleBlueprint(db, 'deploy a fastapi docker service');
      assert.ok(result.id);
      assert.ok(result.keywords.length > 0);
      assert.equal(result.artifacts_selected, 2);
      assert.ok(result.scaffold);
      assert.ok(result.deploy_manifests['docker-compose']);
      assert.ok(result.readme.includes('fastapi'));
    });

    it('returns error for empty goal (no keywords)', async () => {
      const db = mockDb();
      const result = await assembleBlueprint(db, 'the and but or');
      assert.ok(result.error);
      assert.ok(result.error.includes('keywords'));
    });

    it('returns error when no artifacts found', async () => {
      const db = mockDb([{ rows: [] }]);
      const result = await assembleBlueprint(db, 'quantum teleportation device');
      assert.ok(result.error);
      assert.ok(result.error.includes('No matching'));
    });

    it('respects maxArtifacts limit', async () => {
      const artifacts = Array.from({ length: 10 }, (_, i) =>
        makeArtifact({ name: `fastapi-${i}`, description: 'fastapi thing' })
      );
      const blueprintId = randomUUID();

      const db = mockDb([
        { rows: artifacts },
        { rows: [{ id: blueprintId, created_at: new Date().toISOString() }] },
      ]);

      const result = await assembleBlueprint(db, 'fastapi microservice', 3);
      assert.equal(result.artifacts_selected, 3);
    });

    it('stores blueprint in database', async () => {
      const a1 = makeArtifact({ name: 'fastapi-app' });
      const blueprintId = randomUUID();
      let insertCalled = false;

      const db = {
        query: async (sql) => {
          if (sql === 'SEARCH') return { rows: [a1] };
          insertCalled = true;
          return { rows: [{ id: blueprintId, created_at: new Date().toISOString() }] };
        },
      };

      await assembleBlueprint(db, 'fastapi service');
      assert.ok(insertCalled, 'INSERT should have been called');
    });

    it('ranks artifacts by fit score', async () => {
      const lowFit = makeArtifact({ name: 'unrelated-thing', description: 'nothing relevant', quality_score: 10 });
      const highFit = makeArtifact({ name: 'fastapi-server', description: 'a fastapi microservice', quality_score: 90 });
      const blueprintId = randomUUID();

      const db = mockDb([
        { rows: [lowFit, highFit] },
        { rows: [{ id: blueprintId, created_at: new Date().toISOString() }] },
      ]);

      const result = await assembleBlueprint(db, 'fastapi microservice', 1);
      assert.equal(result.artifact_ids[0], highFit.id);
    });
  });
});
