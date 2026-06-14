// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * REST API server for Knowledge Harvester.
 *
 * Minimal HTTP server using Node.js built-in http module.
 * Internal tooling only — no auth/licensing.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { db } from './db/client.js';
import { migrate } from './db/migrate.js';
import { logger } from './utils/logger.js';
// ── Wave 3: API route modules ──
import { handleListArtifacts, handleGetArtifact, handleCreateArtifact, handleUpdateArtifact, handleDeleteArtifact } from './api/artifact-routes.js';
import { handleBatchImport, handleBatchExport } from './api/batch-routes.js';
import { handlePipelineRun, handlePipelineStatus } from './api/pipeline-routes.js';
import { handleRegisterWebhook, handleListWebhooks, handleDeleteWebhook, fireWebhookEvent } from './api/webhooks.js';
import { handleCreateReview, handleListReviews, handleDeleteReview, handleGetArtifactRating } from './api/review-routes.js';
import { handleForkArtifact, handleListForks } from './api/fork-routes.js';
import { handleListContributors, handleGetContributor, handleRefreshContributorStats } from './api/contributor-routes.js';
import { handleCreateCollection, handleListCollections, handleGetCollection, handleUpdateCollection, handleDeleteCollection, handleAddToCollection, handleRemoveFromCollection } from './api/collection-routes.js';
import { handleGitHubWebhook, getWatchedRepos, addWatchedRepo } from './api/github-webhooks.js';
import { handleCreateBlueprint, handleListBlueprints, handleGetBlueprint } from './api/blueprint-routes.js';
import { handleListClaims, handleGetClaim, handleClaimSummary, handleClaimQueue, handleCreateClaim, handleUpdateClaim, handleExtractClaims, handleAddClaimEvidence } from './api/claim-routes.js';
import { handleGraphQuery, handleBatchUpsertNodes, handleGraphMaterialize, handleGetNode } from './api/graph-routes.js';
import { handleResearchGaps } from './api/research-routes.js';
import { handleHarvestStatusPoll } from './api/long-polling.js';
import { handlePartialArtifact } from './api/partial-response.js';
import { handleSemanticSearch as handleSemanticSearchRoute } from './api/semantic-search.js';
import { handleListSourcingRequests, handleGetSourcingRequest, handleCreateSourcingRequest, handleDispatchSourcingRequest } from './api/sourcing-routes.js';
// ── Autonomy Expansion route modules ──
import { handleEventHistory, handleEventStream } from './api/event-routes.js';
import { handleListSchedules, handleCreateSchedule, handleUpdateSchedule, handleDeleteSchedule, handleRunSchedule } from './api/schedule-routes.js';
import { handleCreateSnapshot, handleListSnapshots, handleGetSnapshot, handleCompareSnapshots } from './api/snapshot-routes.js';
import { handleDiscoverRelated, handleDiscoverClusters, handleDiscoverBridges } from './api/discovery-routes.js';
import { handleGetCoverage, handleGetCoverageGaps } from './api/coverage-routes.js';
import { handleThisVsLast, handleVelocity } from './api/compare-routes.js';
import { handleFeed, handleFeedSummary } from './api/feed-routes.js';
import { handleAutonomyPulse, handleAutonomyTimeline } from './api/autonomy-routes.js';
import { refreshBatch, getRefreshHistory } from './processing/auto-refresh.js';
import { syncFromTrendscope } from './integrations/trendscope-sync.js';
import { WebhookDispatcher } from './integrations/webhook-dispatcher.js';
import { getMetrics } from './utils/metrics.js';
import { getEventBus } from './processing/event-bus.js';
import { getScheduler } from './processing/scheduler.js';
import { exportArtifactById } from './export/exporter.js';
import { scaffoldProject } from './export/scaffolder.js';
import { generateDeployManifest } from './export/deploy-generator.js';
import { trackEvent, getPopular, getTrends } from './db/analytics-store.js';
import { logOperationSafely } from './db/operation-log-store.js';
import { handleListErrors, handleErrorLogPage, handleErrorSummary, handleFailureInbox, handleListRuns, handleGetRun, handleSourceHealth, handleListSystemRuns, handleGetSystemRun, handleListSourceRecords, handleSourceRecordSummary } from './api/ops-routes.js';
import { generateRecommendations } from './processing/recommender.js';
import { getApiHarvesterFactories, dispatchHarvestSources } from './harvesters/source-catalog.js';

const PORT = parseInt(process.env.PORT || '8011', 10);
const CORS_ORIGINS = (process.env.KH_CORS_ORIGINS || 'http://localhost:3000').split(',').map(s => s.trim());

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}
const MAX_BODY_SIZE = parseInt(process.env.MAX_BODY_SIZE || '1048576', 10); // 1MB default

async function readBody(req) {
  const chunks = [];
  let totalSize = 0;
  for await (const chunk of req) {
    totalSize += chunk.length;
    if (totalSize > MAX_BODY_SIZE) {
      throw Object.assign(new Error('Request body too large'), { statusCode: 413 });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString();
}

// ── API Key Authentication ──────────────────────────────────────────────────────

const API_KEY = process.env.KH_API_KEY || '';

function requireAuth(req, res) {
  if (!API_KEY) {
    if (process.env.NODE_ENV === 'production') {
      json(res, 503, { error: 'API key not configured' });
      return false;
    }
    return true;
  }

  const provided = req.headers['x-api-key'] || '';
  if (!provided) {
    json(res, 401, { error: 'Missing API key' });
    return false;
  }

  try {
    const a = Buffer.from(provided);
    const b = Buffer.from(API_KEY);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      json(res, 401, { error: 'Invalid API key' });
      return false;
    }
  } catch {
    json(res, 401, { error: 'Invalid API key' });
    return false;
  }

  return true;
}

// ── Rate Limiting ──────────────────────────────────────────────────────────────

const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = parseInt(process.env.KH_RATE_LIMIT || '60', 10);
const _rateBuckets = new Map();

function checkRateLimit(req, res) {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let bucket = _rateBuckets.get(ip);

  if (!bucket || now - bucket.start > RATE_WINDOW_MS) {
    bucket = { start: now, count: 0 };
    _rateBuckets.set(ip, bucket);
  }

  bucket.count++;
  res.setHeader('X-RateLimit-Limit', String(RATE_MAX));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, RATE_MAX - bucket.count)));

  if (bucket.count > RATE_MAX) {
    json(res, 429, { error: 'Too many requests' });
    return false;
  }
  return true;
}

// Clean up stale rate-limit buckets every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS * 2;
  for (const [ip, bucket] of _rateBuckets) {
    if (bucket.start < cutoff) _rateBuckets.delete(ip);
  }
}, 5 * 60 * 1000).unref();

// ── Route handlers ──────────────────────────────────────────────────────────

async function handleHealth(_req, res) {
  let dbStatus = 'ok';
  try {
    await db.query('SELECT 1');
  } catch (err) {
    dbStatus = 'error';
    logger.error('Health check DB query failed', { error: err.message });
  }
  const overall = dbStatus === 'ok' ? 'ok' : 'degraded';
  json(res, overall === 'ok' ? 200 : 503, { status: overall, service: 'knowledge-harvester', db: dbStatus });
}

async function handleHealthReady(_req, res) {
  const checks = {};

  // DB connectivity check
  try {
    await db.query('SELECT 1');
    checks.db = true;
  } catch {
    checks.db = false;
  }

  // Scheduler running check
  try {
    const scheduler = getScheduler();
    checks.scheduler = scheduler && typeof scheduler.isRunning === 'function'
      ? scheduler.isRunning()
      : !!scheduler;
  } catch {
    checks.scheduler = false;
  }

  const allReady = Object.values(checks).every(Boolean);
  json(res, allReady ? 200 : 503, { ready: allReady, checks });
}

async function handleStats(_req, res) {
  const total = await db.query('SELECT COUNT(*) as count FROM workflows');
  const byTool = await db.query(
    'SELECT tool_type, COUNT(*) as count FROM workflows GROUP BY tool_type ORDER BY count DESC'
  );
  const bySource = await db.query(`
    SELECT source, tool_type, COUNT(*) as total,
           COUNT(*) FILTER (WHERE quality_score >= 70) as high_quality,
           ROUND(AVG(quality_score)) as avg_quality,
           COUNT(*) FILTER (WHERE primary_category IS NOT NULL) as classified
    FROM workflows GROUP BY source, tool_type ORDER BY total DESC
  `);
  const runs = await db.query(`
    SELECT source, status, items_discovered, items_new, items_duplicate,
           started_at, completed_at
    FROM harvest_runs ORDER BY started_at DESC LIMIT 10
  `);

  json(res, 200, {
    total_workflows: parseInt(total.rows[0].count, 10),
    by_tool_type: byTool.rows,
    by_source: bySource.rows,
    recent_runs: runs.rows,
  });
}

async function handleSearchWorkflows(_req, res, params) {
  const q = params.get('q') || '';
  const category = params.get('category') || '';
  const toolType = params.get('tool_type') || '';
  const qualityMin = parseInt(params.get('quality_min') || '0', 10);
  const limit = Math.min(parseInt(params.get('limit') || '20', 10), 100);
  const offset = parseInt(params.get('offset') || '0', 10);

  const conditions = [];
  const values = [];
  let idx = 1;

  if (q) {
    conditions.push(`search_vector @@ plainto_tsquery('english', $${idx})`);
    values.push(q);
    idx++;
  }
  if (category) {
    conditions.push(`primary_category = $${idx}`);
    values.push(category);
    idx++;
  }
  if (toolType) {
    conditions.push(`tool_type = $${idx}`);
    values.push(toolType);
    idx++;
  }
  if (qualityMin > 0) {
    conditions.push(`quality_score >= $${idx}`);
    values.push(qualityMin);
    idx++;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await db.query(`SELECT COUNT(*) as count FROM workflows ${where}`, values);
  const result = await db.query(
    `SELECT id, workflow_name, source, tool_type, primary_category, tags,
            quality_score, node_count, trigger_type, estimated_complexity,
            discovered_at, publishing_status
     FROM workflows ${where}
     ORDER BY quality_score DESC, discovered_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...values, limit, offset]
  );

  json(res, 200, {
    total: parseInt(countResult.rows[0].count, 10),
    limit,
    offset,
    workflows: result.rows,
  });
}

async function handleGetWorkflow(_req, res, _params, id) {
  const result = await db.query(
    `SELECT id, workflow_name, original_description, source, source_url,
            tool_type, primary_category, secondary_categories, tags,
            quality_score, node_count, node_types, trigger_type,
            estimated_complexity, credentials_required,
            has_code_node, has_description, has_documentation,
            workflow_json, author_username, author_profile_url,
            discovered_at, publishing_status
     FROM workflows WHERE id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    return json(res, 404, { error: 'Workflow not found' });
  }
  json(res, 200, result.rows[0]);
}

async function handleCategories(_req, res) {
  const result = await db.query(`
    SELECT primary_category as category, COUNT(*) as count
    FROM workflows
    WHERE primary_category IS NOT NULL
    GROUP BY primary_category
    ORDER BY count DESC
  `);
  json(res, 200, { categories: result.rows });
}

async function handleHarvest(req, res, params) {
  const harvesterMap = getApiHarvesterFactories();
  const source = params.get('source') || 'all';
  const sources = source === 'all' ? Object.keys(harvesterMap) : [source];

  for (const s of sources) {
    if (!harvesterMap[s]) {
      return json(res, 400, { error: `Unknown source: ${s}`, available: Object.keys(harvesterMap) });
    }
  }

  const dispatch = await dispatchHarvestSources({
    sources,
    trigger: 'api',
  });

  json(res, 202, {
    message: `Harvest started for: ${sources.join(', ')}`,
    sources: dispatch.sources,
    runs: dispatch.runs,
    run_id: dispatch.run_id,
  });
}

// ── Wave 3: Semantic Search ─────────────────────────────────────────────────

async function handleSemanticSearch(_req, res, params) {
  const q = params.get('q') || '';
  const limit = Math.min(parseInt(params.get('limit') || '10', 10), 50);

  if (!q) {
    return json(res, 400, { error: 'Query parameter "q" is required' });
  }

  // Use pgvector cosine distance for semantic search
  // First generate embedding for query (would need embedder), for now use text search fallback
  const escaped = q.replace(/%/g, '\%').replace(/_/g, '\_');
  const result = await db.query(
    `SELECT id, name, artifact_type, primary_category, quality_score, description,
            1 - (embedding <=> (SELECT embedding FROM artifacts WHERE name ILIKE $1 LIMIT 1)) AS score
     FROM artifacts
     WHERE embedding IS NOT NULL
     ORDER BY embedding <=> (SELECT embedding FROM artifacts WHERE name ILIKE $1 LIMIT 1)
     LIMIT $2`,
    [`%${escaped}%`, limit]
  );

  json(res, 200, { query: q, results: result.rows });
}

// ── Wave 3: Export/Scaffold/Deploy handlers ─────────────────────────────────

async function handleExport(_req, res, params, id) {
  const format = params.get('format') || 'json';
  try {
    const result = await exportArtifactById(db, id, format);
    if (!result) return json(res, 404, { error: 'Artifact not found' });
    if (format === 'tar.gz') {
      res.writeHead(200, {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="${id}.tar.gz"`,
      });
      res.end(result);
    } else {
      json(res, 200, typeof result === 'string' ? { content: result } : result);
    }
  } catch (err) {
    json(res, 400, { error: err.message });
  }
}

async function handleScaffold(_req, res, _params, id) {
  const result = await db.query('SELECT * FROM artifacts WHERE id = $1', [id]);
  if (result.rows.length === 0) return json(res, 404, { error: 'Artifact not found' });
  const scaffold = scaffoldProject(result.rows[0]);
  json(res, 200, scaffold);
}

async function handleDeployManifest(_req, res, params, id) {
  const target = params.get('target') || 'docker-compose';
  const result = await db.query('SELECT * FROM artifacts WHERE id = $1', [id]);
  if (result.rows.length === 0) return json(res, 404, { error: 'Artifact not found' });
  try {
    const manifest = generateDeployManifest(result.rows[0], target);
    json(res, 200, { target, manifest });
  } catch (err) {
    json(res, 400, { error: err.message });
  }
}

// ── F1: Predictive Quality Decay handler ─────────────────────────────────────

async function handleAtRiskArtifacts(_req, res, params) {
  try {
    const threshold = parseFloat(params.get('threshold') || '0.6');
    const limit = Math.min(parseInt(params.get('limit') || '50', 10), 200);
    const result = await db.query(
      `SELECT id, name, type_metadata, quality_score, updated_at
       FROM artifacts
       WHERE type_metadata IS NOT NULL
         AND type_metadata::jsonb -> 'decay_prediction' ->> 'decay_risk' IS NOT NULL
         AND (type_metadata::jsonb -> 'decay_prediction' ->> 'decay_risk')::float >= $1
       ORDER BY (type_metadata::jsonb -> 'decay_prediction' ->> 'decay_risk')::float DESC
       LIMIT $2`,
      [threshold, limit]
    );

    const artifacts = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      quality_score: row.quality_score,
      decay_prediction: (typeof row.type_metadata === 'string' ? JSON.parse(row.type_metadata) : row.type_metadata)?.decay_prediction,
      updated_at: row.updated_at,
    }));

    json(res, 200, { artifacts, total: artifacts.length, threshold });
  } catch (err) {
    logger.error('At-risk artifacts query failed', { error: err.message });
    json(res, 500, { error: 'Failed to get at-risk artifacts' });
  }
}

// ── F3: Semantic Dedup handlers ─────────────────────────────────────────────

async function handleArtifactDuplicates(_req, res, _params, id) {
  const result = await db.query(
    `SELECT ad.*, a.name, a.artifact_type, a.quality_score, a.primary_category
     FROM artifact_duplicates ad
     JOIN artifacts a ON a.id = CASE
       WHEN ad.original_id = $1 THEN ad.duplicate_id
       ELSE ad.original_id
     END
     WHERE ad.original_id = $1 OR ad.duplicate_id = $1`,
    [id]
  );
  json(res, 200, { artifact_id: id, duplicates: result.rows });
}

async function handleArtifactCanonical(_req, res, _params, id) {
  // Find the group_id for this artifact
  const groupResult = await db.query(
    `SELECT group_id, canonical_id FROM artifact_duplicates
     WHERE (original_id = $1 OR duplicate_id = $1) AND group_id IS NOT NULL
     LIMIT 1`,
    [id]
  );

  if (groupResult.rows.length === 0) {
    return json(res, 404, { error: 'No duplicate group found for this artifact' });
  }

  const { canonical_id } = groupResult.rows[0];
  if (!canonical_id) {
    return json(res, 404, { error: 'No canonical artifact selected for this group' });
  }

  const canonical = await db.query(
    'SELECT id, name, artifact_type, quality_score, primary_category, updated_at FROM artifacts WHERE id = $1',
    [canonical_id]
  );

  if (canonical.rows.length === 0) {
    return json(res, 404, { error: 'Canonical artifact not found' });
  }

  json(res, 200, { artifact_id: id, canonical: canonical.rows[0] });
}

// ── Wave 3: Recommendations handler ────────────────────────────────────────

async function handleRecommendations(_req, res, _params, id) {
  const result = await db.query('SELECT * FROM artifacts WHERE id = $1', [id]);
  if (result.rows.length === 0) return json(res, 404, { error: 'Artifact not found' });

  const artifact = result.rows[0];
  const recs = (artifact.type_metadata?.recommendations) || [];
  json(res, 200, { artifact_id: id, recommendations: recs });
}

// ── Wave 3: Analytics handlers ──────────────────────────────────────────────

async function handlePopular(_req, res, params) {
  const window = params.get('window') || '7d';
  const limit = Math.min(parseInt(params.get('limit') || '20', 10), 100);
  const results = await getPopular(db, window, limit);
  json(res, 200, { window, results });
}

// ── Trending Artifacts handler ──────────────────────────────────────────────

async function handleTrendingArtifacts(_req, res, params) {
  const limit = Math.min(parseInt(params.get('limit') || '20', 10), 100);
  const result = await db.query(
    `SELECT id, name, artifact_type, primary_category, quality_score, tags,
            marketplace_metadata->'trend_signals' AS trend_signals
     FROM artifacts
     WHERE marketplace_metadata ? 'trend_signals'
     ORDER BY quality_score DESC
     LIMIT $1`,
    [limit]
  );
  json(res, 200, { trending: result.rows });
}

async function handleTrends(_req, res, params) {
  const window = params.get('window') || '7d';
  const results = await getTrends(db, window);
  json(res, 200, { window, results });
}

// ── Wave 3: Package/Guide/Bundle list handlers ──────────────────────────────

async function handleListPackages(_req, res, params) {
  const limit = Math.min(parseInt(params.get('limit') || '20', 10), 100);
  const offset = parseInt(params.get('offset') || '0', 10);
  const result = await db.query(
    'SELECT * FROM artifact_packages ORDER BY created_at DESC LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  json(res, 200, { packages: result.rows });
}

async function handleListGuides(_req, res, params) {
  const limit = Math.min(parseInt(params.get('limit') || '20', 10), 100);
  const offset = parseInt(params.get('offset') || '0', 10);
  const result = await db.query(
    'SELECT * FROM artifact_guides ORDER BY created_at DESC LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  json(res, 200, { guides: result.rows });
}

async function handleListBundles(_req, res, params) {
  const limit = Math.min(parseInt(params.get('limit') || '20', 10), 100);
  const offset = parseInt(params.get('offset') || '0', 10);
  const result = await db.query(
    'SELECT * FROM artifact_bundles ORDER BY created_at DESC LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  json(res, 200, { bundles: result.rows });
}

// ── Router ──────────────────────────────────────────────────────────────────

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && CORS_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Service-Token, X-Service-Name');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  if (setCorsHeaders(req, res)) return;

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;

  try {
    if (method === 'GET' && path === '/health') {
      return await handleHealth(req, res);
    }

    if (method === 'GET' && path === '/health/ready') {
      return await handleHealthReady(req, res);
    }

    // Rate limiting for /api routes
    if (path.startsWith('/api') && !checkRateLimit(req, res)) return;

    // API key authentication for /api routes
    if (path.startsWith('/api') && !requireAuth(req, res)) return;

    // Track analytics events on API access
    if (path.startsWith('/api/artifacts/') && method === 'GET') {
      const idMatch = path.match(new RegExp(`^/api/artifacts/(${UUID_RE})$`));
      if (idMatch) {
        trackEvent(db, 'view', idMatch[1], {}).catch(() => {});
      }
    }

    // ── Health & Stats ──
    if (method === 'GET' && path === '/api/stats') {
      return await handleStats(req, res);
    }
    if (method === 'GET' && path === '/api/errors/view') {
      return await handleErrorLogPage(req, res, url.searchParams);
    }
    if (method === 'GET' && path === '/api/errors') {
      return await handleListErrors(req, res, url.searchParams);
    }
    if (method === 'GET' && path === '/api/errors/summary') {
      return await handleErrorSummary(req, res, url.searchParams);
    }
    if (method === 'GET' && path === '/api/errors/inbox') {
      return await handleFailureInbox(req, res, url.searchParams);
    }
    if (method === 'GET' && path === '/api/runs') {
      return await handleListRuns(req, res, url.searchParams);
    }
    const runMatch = path.match(new RegExp(`^/api/runs/(${UUID_RE})$`));
    if (method === 'GET' && runMatch) {
      return await handleGetRun(req, res, url.searchParams, runMatch[1]);
    }
    if (method === 'GET' && path === '/api/source-health') {
      return await handleSourceHealth(req, res, url.searchParams);
    }
    if (method === 'GET' && path === '/api/source-records') {
      return await handleListSourceRecords(req, res, url.searchParams);
    }
    if (method === 'GET' && path === '/api/source-records/summary') {
      return await handleSourceRecordSummary(req, res, url.searchParams);
    }
    if (method === 'GET' && path === '/api/sourcing/requests') {
      return await handleListSourcingRequests(req, res, url.searchParams);
    }
    if (method === 'POST' && path === '/api/sourcing/requests') {
      return await handleCreateSourcingRequest(req, res, url.searchParams);
    }
    const sourcingRequestDispatchMatch = path.match(new RegExp(`^/api/sourcing/requests/(${UUID_RE})/dispatch$`));
    if (method === 'POST' && sourcingRequestDispatchMatch) {
      return await handleDispatchSourcingRequest(req, res, url.searchParams, sourcingRequestDispatchMatch[1]);
    }
    const sourcingRequestMatch = path.match(new RegExp(`^/api/sourcing/requests/(${UUID_RE})$`));
    if (method === 'GET' && sourcingRequestMatch) {
      return await handleGetSourcingRequest(req, res, url.searchParams, sourcingRequestMatch[1]);
    }
    if (method === 'GET' && path === '/api/system-runs') {
      return await handleListSystemRuns(req, res, url.searchParams);
    }
    const systemRunMatch = path.match(new RegExp(`^/api/system-runs/(${UUID_RE})$`));
    if (method === 'GET' && systemRunMatch) {
      return await handleGetSystemRun(req, res, url.searchParams, systemRunMatch[1]);
    }

    // ── Workflows (legacy) ──
    if (method === 'GET' && path === '/api/workflows') {
      return await handleSearchWorkflows(req, res, url.searchParams);
    }
    const workflowMatch = path.match(new RegExp(`^/api/workflows/(${UUID_RE})$`));
    if (method === 'GET' && workflowMatch) {
      return await handleGetWorkflow(req, res, url.searchParams, workflowMatch[1]);
    }
    if (method === 'GET' && path === '/api/categories') {
      return await handleCategories(req, res);
    }
    if (method === 'POST' && path === '/api/harvest') {
      return await handleHarvest(req, res, url.searchParams);
    }
    const harvestStatusMatch = path.match(new RegExp(`^/api/harvest/(${UUID_RE})/status$`));
    if (method === 'GET' && harvestStatusMatch) {
      return await handleHarvestStatusPoll(req, res, url.searchParams, harvestStatusMatch[1]);
    }

    // ── Artifacts CRUD (Wave 3) ──
    if (method === 'GET' && path === '/api/artifacts') {
      return await handleListArtifacts(req, res, url.searchParams);
    }
    if (method === 'POST' && path === '/api/artifacts') {
      const result = await handleCreateArtifact(req, res);
      // Fire webhook event for artifact creation (fire-and-forget)
      fireWebhookEvent(db, 'artifact.created', { path, timestamp: new Date().toISOString() });
      return result;
    }
    if (method === 'POST' && path === '/api/artifacts/batch') {
      return await handleBatchImport(req, res);
    }
    if (method === 'POST' && path === '/api/artifacts/batch/export') {
      return await handleBatchExport(req, res);
    }
    if (method === 'GET' && path === '/api/artifacts/search/semantic') {
      return await handleSemanticSearchRoute(req, res, url.searchParams);
    }
    if (method === 'GET' && path === '/api/artifacts/at-risk') {
      return await handleAtRiskArtifacts(req, res, url.searchParams);
    }

    const artifactMatch = path.match(new RegExp(`^/api/artifacts/(${UUID_RE})$`));
    if (artifactMatch) {
      const id = artifactMatch[1];
      if (method === 'GET') return await handleGetArtifact(req, res, url.searchParams, id);
      if (method === 'PUT') return await handleUpdateArtifact(req, res, url.searchParams, id);
      if (method === 'DELETE') return await handleDeleteArtifact(req, res, url.searchParams, id);
    }

    // ── Artifact sub-resources ──
    const artifactSubMatch = path.match(new RegExp(`^/api/artifacts/(${UUID_RE})/(\\w[\\w-]*)$`));
    if (artifactSubMatch) {
      const [, id, sub] = artifactSubMatch;
      if (method === 'GET' && sub === 'partial') return await handlePartialArtifact(req, res, url.searchParams, id);
      if (method === 'GET' && sub === 'recommendations') return await handleRecommendations(req, res, url.searchParams, id);
      if (method === 'GET' && sub === 'export') return await handleExport(req, res, url.searchParams, id);
      if (method === 'GET' && sub === 'scaffold') return await handleScaffold(req, res, url.searchParams, id);
      if (method === 'GET' && sub === 'deploy-manifest') return await handleDeployManifest(req, res, url.searchParams, id);
      if (method === 'GET' && sub === 'rating') return await handleGetArtifactRating(req, res, url.searchParams, id);
      if (method === 'GET' && sub === 'reviews') return await handleListReviews(req, res, url.searchParams, id);
      if (method === 'POST' && sub === 'reviews') return await handleCreateReview(req, res, url.searchParams, id);
      if (method === 'GET' && sub === 'forks') return await handleListForks(req, res, url.searchParams, id);
      if (method === 'POST' && sub === 'fork') return await handleForkArtifact(req, res, url.searchParams, id);
      if (method === 'GET' && sub === 'duplicates') return await handleArtifactDuplicates(req, res, url.searchParams, id);
      if (method === 'GET' && sub === 'canonical') return await handleArtifactCanonical(req, res, url.searchParams, id);
    }

    // ── Collection artifact management ──
    const collectionArtifactMatch = path.match(new RegExp(`^/api/collections/(${UUID_RE})/artifacts(?:/(${UUID_RE}))?$`));
    if (collectionArtifactMatch) {
      const [, collectionId, artifactId] = collectionArtifactMatch;
      if (method === 'POST') return await handleAddToCollection(req, res, url.searchParams, collectionId);
      if (method === 'DELETE' && artifactId) return await handleRemoveFromCollection(req, res, url.searchParams, collectionId, artifactId);
    }

    // ── Packages / Guides / Bundles ──
    if (method === 'GET' && path === '/api/packages') return await handleListPackages(req, res, url.searchParams);
    if (method === 'GET' && path === '/api/guides') return await handleListGuides(req, res, url.searchParams);
    if (method === 'GET' && path === '/api/bundles') return await handleListBundles(req, res, url.searchParams);

    // ── Pipeline Control ──
    if (method === 'POST' && path === '/api/pipeline/run') return await handlePipelineRun(req, res);
    if (method === 'GET' && path === '/api/pipeline/status') return await handlePipelineStatus(req, res);

    // ── Webhooks ──
    if (method === 'GET' && path === '/api/webhooks') return await handleListWebhooks(req, res);
    if (method === 'POST' && path === '/api/webhooks') return await handleRegisterWebhook(req, res);
    const webhookMatch = path.match(new RegExp(`^/api/webhooks/(${UUID_RE})$`));
    if (method === 'DELETE' && webhookMatch) return await handleDeleteWebhook(req, res, url.searchParams, webhookMatch[1]);

    // ── Reviews (delete by review ID) ──
    const reviewMatch = path.match(new RegExp(`^/api/reviews/(${UUID_RE})$`));
    if (method === 'DELETE' && reviewMatch) return await handleDeleteReview(req, res, url.searchParams, reviewMatch[1]);

    // ── Analytics ──
    if (method === 'GET' && path === '/api/analytics/popular') return await handlePopular(req, res, url.searchParams);
    if (method === 'GET' && path === '/api/analytics/trends') return await handleTrends(req, res, url.searchParams);

    // ── Contributors ──
    if (method === 'GET' && path === '/api/contributors') return await handleListContributors(req, res, url.searchParams);
    if (method === 'POST' && path === '/api/contributors/refresh') return await handleRefreshContributorStats(req, res);
    const contributorMatch = path.match(/^\/api\/contributors\/([a-zA-Z0-9_-]+)$/);
    if (method === 'GET' && contributorMatch) return await handleGetContributor(req, res, url.searchParams, contributorMatch[1]);

    // ── Collections ──
    if (method === 'GET' && path === '/api/collections') return await handleListCollections(req, res, url.searchParams);
    if (method === 'POST' && path === '/api/collections') return await handleCreateCollection(req, res);
    const collectionMatch = path.match(new RegExp(`^/api/collections/(${UUID_RE}|[a-z0-9-]+)$`));
    if (collectionMatch) {
      const idOrSlug = collectionMatch[1];
      if (method === 'GET') return await handleGetCollection(req, res, url.searchParams, idOrSlug);
      if (method === 'PUT') return await handleUpdateCollection(req, res, url.searchParams, idOrSlug);
      if (method === 'DELETE') return await handleDeleteCollection(req, res, url.searchParams, idOrSlug);
    }

    // ── Trending Artifacts ──
    if (method === 'GET' && path === '/api/artifacts/trending') {
      return await handleTrendingArtifacts(req, res, url.searchParams);
    }

    // ── Blueprints ──
    if (method === 'POST' && path === '/api/blueprints') {
      return await handleCreateBlueprint(req, res);
    }
    if (method === 'GET' && path === '/api/blueprints') {
      return await handleListBlueprints(req, res, url.searchParams);
    }
    const blueprintMatch = path.match(new RegExp(`^/api/blueprints/(${UUID_RE})$`));
    if (method === 'GET' && blueprintMatch) {
      return await handleGetBlueprint(req, res, url.searchParams, blueprintMatch[1]);
    }

    // ── Intelligence Graph ──
    if (method === 'GET' && path === '/api/claims') {
      return await handleListClaims(req, res, url.searchParams);
    }
    if (method === 'GET' && path === '/api/claims/summary') {
      return await handleClaimSummary(req, res, url.searchParams);
    }
    if (method === 'GET' && path === '/api/claims/queue') {
      return await handleClaimQueue(req, res, url.searchParams);
    }
    if (method === 'POST' && path === '/api/claims/extract') {
      return await handleExtractClaims(req, res, url.searchParams);
    }
    if (method === 'POST' && path === '/api/claims') {
      return await handleCreateClaim(req, res, url.searchParams);
    }
    const claimEvidenceMatch = path.match(new RegExp(`^/api/claims/(${UUID_RE})/evidence$`));
    if (method === 'POST' && claimEvidenceMatch) {
      return await handleAddClaimEvidence(req, res, url.searchParams, claimEvidenceMatch[1]);
    }
    const claimMatch = path.match(new RegExp(`^/api/claims/(${UUID_RE})$`));
    if (method === 'GET' && claimMatch) {
      return await handleGetClaim(req, res, url.searchParams, claimMatch[1]);
    }
    if (method === 'PATCH' && claimMatch) {
      return await handleUpdateClaim(req, res, url.searchParams, claimMatch[1]);
    }

    if (method === 'POST' && path === '/api/graph/query') {
      return await handleGraphQuery(req, res);
    }
    if (method === 'POST' && path === '/api/graph/materialize') {
      return await handleGraphMaterialize(req, res);
    }
    if (method === 'POST' && path === '/api/graph/nodes') {
      return await handleBatchUpsertNodes(req, res);
    }
    const graphNodeMatch = path.match(/^\/api\/graph\/nodes\/([a-zA-Z_-]+)\/(.+)$/);
    if (method === 'GET' && graphNodeMatch) {
      return await handleGetNode(req, res, url.searchParams, graphNodeMatch[1], graphNodeMatch[2]);
    }

    // ── Research Gaps ──
    if (method === 'POST' && path === '/api/research/gaps') {
      return await handleResearchGaps(req, res);
    }

    // ── GitHub Webhooks ──
    if (method === 'POST' && path === '/api/webhooks/github') {
      return await handleGitHubWebhook(req, res, db);
    }

    // ── Watched Repos ──
    if (method === 'GET' && path === '/api/watched-repos') {
      const repos = await getWatchedRepos(db);
      return json(res, 200, { repos });
    }
    if (method === 'POST' && path === '/api/watched-repos') {
      const body = JSON.parse(await readBody(req));
      if (!body.owner || !body.repo) {
        return json(res, 400, { error: 'Missing required fields: owner, repo' });
      }
      const repo = await addWatchedRepo(db, body.owner, body.repo);
      return json(res, 201, repo);
    }

    // ── Event Bus ──
    if (method === 'GET' && path === '/api/events/history') return await handleEventHistory(req, res, url.searchParams);
    if (method === 'GET' && path === '/api/events/stream') return await handleEventStream(req, res, url.searchParams);

    // ── Schedules ──
    if (method === 'GET' && path === '/api/schedules') return await handleListSchedules(req, res);
    if (method === 'POST' && path === '/api/schedules') return await handleCreateSchedule(req, res);
    const scheduleMatch = path.match(/^\/api\/schedules\/([a-zA-Z0-9_-]+)$/);
    if (scheduleMatch) {
      const name = scheduleMatch[1];
      if (method === 'PUT') return await handleUpdateSchedule(req, res, url.searchParams, name);
      if (method === 'DELETE') return await handleDeleteSchedule(req, res, url.searchParams, name);
    }
    const scheduleRunMatch = path.match(/^\/api\/schedules\/([a-zA-Z0-9_-]+)\/run$/);
    if (method === 'POST' && scheduleRunMatch) return await handleRunSchedule(req, res, url.searchParams, scheduleRunMatch[1]);

    // ── Snapshots ──
    if (method === 'POST' && path === '/api/snapshots') return await handleCreateSnapshot(req, res);
    if (method === 'GET' && path === '/api/snapshots') return await handleListSnapshots(req, res);
    if (method === 'GET' && path === '/api/snapshots/compare') return await handleCompareSnapshots(req, res, url.searchParams);
    const snapshotMatch = path.match(new RegExp(`^/api/snapshots/(${UUID_RE})$`));
    if (method === 'GET' && snapshotMatch) return await handleGetSnapshot(req, res, url.searchParams, snapshotMatch[1]);

    // ── Discovery ──
    const discoverRelatedMatch = path.match(new RegExp(`^/api/discover/related/(${UUID_RE})$`));
    if (method === 'GET' && discoverRelatedMatch) return await handleDiscoverRelated(req, res, url.searchParams, discoverRelatedMatch[1]);
    if (method === 'GET' && path === '/api/discover/clusters') return await handleDiscoverClusters(req, res, url.searchParams);
    if (method === 'GET' && path === '/api/discover/bridges') return await handleDiscoverBridges(req, res);

    // ── Coverage ──
    if (method === 'GET' && path === '/api/coverage') return await handleGetCoverage(req, res);
    if (method === 'GET' && path === '/api/coverage/gaps') return await handleGetCoverageGaps(req, res, url.searchParams);

    // ── Time Compare ──
    if (method === 'GET' && path === '/api/compare/this-vs-last') return await handleThisVsLast(req, res, url.searchParams);
    if (method === 'GET' && path === '/api/compare/velocity') return await handleVelocity(req, res, url.searchParams);

    // ── Auto-Refresh ──
    if (method === 'POST' && path === '/api/auto-refresh/run') {
      try {
        const result = await refreshBatch(db);
        return json(res, 200, result);
      } catch (err) {
        return json(res, 500, { error: err.message });
      }
    }
    if (method === 'GET' && path === '/api/auto-refresh/history') {
      const result = await getRefreshHistory(db);
      return json(res, 200, { history: result });
    }

    // ── Feed ──
    if (method === 'GET' && path === '/api/feed') return await handleFeed(req, res);
    if (method === 'GET' && path === '/api/feed/summary') return await handleFeedSummary(req, res);

    // ── Cross-System Sync ──
    if (method === 'POST' && path === '/api/sync/trendscope') {
      try {
        const result = await syncFromTrendscope(db);
        return json(res, 200, result);
      } catch (err) {
        return json(res, 500, { error: err.message });
      }
    }

    // ── Autonomy Dashboard ──
    if (method === 'GET' && path === '/api/autonomy/pulse') return await handleAutonomyPulse(req, res);
    if (method === 'GET' && path === '/api/autonomy/timeline') return await handleAutonomyTimeline(req, res);

    // ── C-Suite Priority Queue ──
    if (method === 'POST' && path === '/api/priority/run') {
      try {
        const body = JSON.parse(await readBody(req));
        if (!body.job) {
          return json(res, 400, { error: 'Missing required field: job' });
        }
        const scheduler = getScheduler(db);
        const result = await scheduler.runNow(body.job);
        if (result.status === 'not_found') {
          return json(res, 404, { error: `Unknown job: ${body.job}` });
        }
        return json(res, 200, result);
      } catch (err) {
        return json(res, 500, { error: err.message });
      }
    }

    if (method === 'POST' && path === '/api/priority/harvest') {
      try {
        const sources = await dispatchHarvestSources({ db, logger });
        const result = await refreshBatch(db, { threshold: 0.4, limit: 100 });
        return json(res, 200, { status: 'success', sources, refresh: result });
      } catch (err) {
        return json(res, 500, { error: err.message });
      }
    }

    // ── Metrics ──
    if (method === 'GET' && path === '/metrics') {
      const metrics = getMetrics();
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(metrics.toPrometheus());
    }

    // ── Detailed Health ──
    if (method === 'GET' && path === '/health/detailed') {
      const eventBus = getEventBus();
      const recent = eventBus.history(null, 100);
      const metrics = getMetrics();
      return json(res, 200, {
        status: 'ok',
        service: 'knowledge-harvester',
        subsystems: {
          event_bus: { recent_events: recent.length },
          metrics: { counters: metrics.getCounter('events_emitted_total') },
        },
      });
    }

    json(res, 404, { error: 'Not found' });
  } catch (err) {
    logger.error('Request error', { path, error: err.message });
    await logOperationSafely({
      level: 'error',
      category: 'request',
      eventType: 'request.failed',
      message: `${method} ${path} failed`,
      requestPath: path,
      error: err,
      metadata: {
        method,
        query: url.search,
      },
    });
    const status = err.statusCode || 500;
    json(res, status, { error: status === 500 ? 'Internal server error' : err.message });
  }
});

// ── Startup ─────────────────────────────────────────────────────────────────

server.listen(PORT, async () => {
  logger.info(`Knowledge Harvester API listening on port ${PORT}`);

  try {
    // ── Run database migrations on startup ──
    await migrate();
    logger.info('Migrations complete');

    const tsWebhookUrl = process.env.TRENDSCOPE_WEBHOOK_URL || '';
    const khWebhookSecret = process.env.KH_WEBHOOK_SECRET || '';
    if (tsWebhookUrl) {
      const dispatcher = new WebhookDispatcher(tsWebhookUrl, khWebhookSecret);
      dispatcher.start();
      logger.info(`Webhook dispatcher active → ${tsWebhookUrl}`);
    }

    // ── Autonomous Scheduler ──
    const scheduler = getScheduler(db);
    await scheduler.register('auto_refresh', 4 * 60 * 60 * 1000, () => refreshBatch(db, { threshold: 0.6, limit: 50 }));
    await scheduler.register('sync_trendscope', 2 * 60 * 60 * 1000, () => syncFromTrendscope(db));
    await scheduler.register('generate_recommendations', 6 * 60 * 60 * 1000, () => generateRecommendations(db, { limit: 100 }));
    await scheduler.start();
    logger.info('Scheduler started');
  } catch (err) {
    logger.error('Startup failed:', err);
    process.exit(1);
  }
});

process.on('SIGINT', () => {
  logger.info('Shutting down...');
  const scheduler = getScheduler(db);
  scheduler.stop();
  server.close(() => db.end().then(() => process.exit(0)));
});

process.on('SIGTERM', () => {
  logger.info('Shutting down...');
  const scheduler = getScheduler(db);
  scheduler.stop();
  server.close(() => db.end().then(() => process.exit(0)));
});
