// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { randomUUID } from 'node:crypto';
import { N8nCommunityHarvester } from './n8n-community.js';
import { GitHubHarvester } from './github.js';
import { RedditHarvester } from './reddit.js';
import { GitHubAgentsHarvester } from './github-agents.js';
import { GitHubZapierMakeHarvester } from './github-zapier-make.js';
import { ActivepiecesHarvester } from './activepieces.js';
import { WindmillHarvester } from './windmill.js';
import { TemporalHarvester } from './temporal.js';
import { AirflowHarvester } from './airflow.js';
import { NodeRedHarvester } from './node-red.js';
import { PrefectHarvester } from './prefect.js';
import { DagsterHarvester } from './dagster.js';
import { LangGraphHarvester } from './langgraph.js';
import { YamlHarvester, loadAllDefinitions } from './yaml-harvester.js';
import { logger } from '../utils/logger.js';
import { logOperationSafely } from '../db/operation-log-store.js';

const BUILT_IN_FACTORIES = {
  'n8n-community': () => new N8nCommunityHarvester(),
  'github': () => new GitHubHarvester(),
  'reddit': () => new RedditHarvester(),
  'github-agents': () => new GitHubAgentsHarvester(),
  'github-zapier-make': () => new GitHubZapierMakeHarvester(),
  'activepieces': () => new ActivepiecesHarvester(),
  'windmill': () => new WindmillHarvester(),
  'temporal': () => new TemporalHarvester(),
  'airflow': () => new AirflowHarvester(),
  'node-red': () => new NodeRedHarvester(),
  'prefect': () => new PrefectHarvester(),
  'dagster': () => new DagsterHarvester(),
  'langgraph': () => new LangGraphHarvester(),
};

export function getApiHarvesterFactories() {
  const map = { ...BUILT_IN_FACTORIES };

  for (const definition of loadAllDefinitions()) {
    if (!map[definition.name]) {
      map[definition.name] = () => new YamlHarvester(definition);
    }
  }

  return map;
}

export function listAvailableHarvesterSources() {
  return Object.keys(getApiHarvesterFactories()).sort();
}

export async function dispatchHarvestSources({
  sources,
  trigger = 'api',
  sourcingRequestId = null,
  metadata = {},
  logOperation = logOperationSafely,
  onSourceSettled = null,
  onDispatchSettled = null,
} = {}) {
  const factories = getApiHarvesterFactories();
  const uniqueSources = [...new Set((sources || []).map((source) => String(source || '').trim()).filter(Boolean))];
  const invalidSources = uniqueSources.filter((source) => !factories[source]);

  if (uniqueSources.length === 0) {
    throw new Error('At least one source is required');
  }
  if (invalidSources.length > 0) {
    throw new Error(`Unknown sources: ${invalidSources.join(', ')}`);
  }

  const harvesters = [];
  const runs = [];

  for (const source of uniqueSources) {
    const harvester = factories[source]();
    harvester.runId ||= randomUUID();
    harvesters.push({ source, harvester });
    runs.push({ source, run_id: harvester.runId });
  }

  const dispatchSummary = {
    sources: uniqueSources,
    runs,
    total_sources: uniqueSources.length,
    completed_sources: 0,
    failed_sources: 0,
    source_results: [],
  };

  const safeInvoke = async (callback, payload) => {
    if (typeof callback !== 'function') return;
    try {
      await callback(payload);
    } catch (error) {
      logger.error('Dispatch callback failed', {
        trigger,
        sourcingRequestId,
        error: error.message,
      });
    }
  };

  (async () => {
    for (const { source, harvester } of harvesters) {
      try {
        logger.info(`Dispatching harvest for ${source}`, { trigger, sourcingRequestId });
        const stats = await harvester.run();
        const result = {
          source,
          run_id: harvester.runId,
          status: 'completed',
          stats,
        };
        dispatchSummary.completed_sources++;
        dispatchSummary.source_results.push(result);
        logger.info(`Harvest complete for ${source}`, { trigger, sourcingRequestId, ...stats });
        await logOperation({
          level: 'info',
          category: 'sourcing',
          eventType: 'sourcing.harvest.completed',
          message: `Dispatched harvest completed for ${source}`,
          source,
          runId: harvester.runId,
          metadata: {
            trigger,
            sourcing_request_id: sourcingRequestId,
            ...metadata,
          },
        });
        await safeInvoke(onSourceSettled, result);
      } catch (error) {
        const result = {
          source,
          run_id: harvester.runId,
          status: 'failed',
          error_message: error.message,
        };
        dispatchSummary.failed_sources++;
        dispatchSummary.source_results.push(result);
        logger.error(`Dispatched harvest failed for ${source}`, { trigger, sourcingRequestId, error: error.message });
        await logOperation({
          level: 'error',
          category: 'sourcing',
          eventType: 'sourcing.harvest.failed',
          message: `Dispatched harvest failed for ${source}`,
          source,
          runId: harvester.runId,
          error,
          metadata: {
            trigger,
            sourcing_request_id: sourcingRequestId,
            ...metadata,
          },
        });
        await safeInvoke(onSourceSettled, result);
      }
    }

    await safeInvoke(onDispatchSettled, dispatchSummary);
  })();

  return {
    sources: uniqueSources,
    runs,
    run_id: runs.length === 1 ? runs[0].run_id : null,
  };
}
