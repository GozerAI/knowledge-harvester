// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { ArtifactBaseHarvester } from './artifact-base.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { storeArtifact, checkArtifactDuplicate } from '../db/artifact-store.js';
import { generateContentHash } from '../utils/hash.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { randomUUID } from 'node:crypto';
import { extractNameFromPath } from '../utils/helpers.js';
import pLimit from 'p-limit';

const SEARCH_QUERIES = [
  { query: 'filename:.github/workflows path:.github/workflows language:yaml', label: 'github-actions-workflow' },
  { query: 'filename:.gitlab-ci.yml language:yaml', label: 'gitlab-ci' },
  { query: 'filename:Jenkinsfile language:groovy', label: 'jenkinsfile' },
];

const GITHUB_API = 'https://api.github.com';
const CONCURRENCY = 5;
const MAX_PAGES_PER_QUERY = 5;

/**
 * Harvester for CI/CD configuration files on GitHub.
 * Covers GitHub Actions workflows, GitLab CI pipelines, and Jenkinsfiles.
 */
export class CIConfigsHarvester extends ArtifactBaseHarvester {
  constructor() {
    super(
      'ci-configs',
      'workflow',
      new RateLimiter({ maxTokens: 10, refillRate: 1, refillIntervalMs: 2500 })
    );
    this.seenUrls = new Set();
  }

  _headers() {
    return {
      Authorization: `Bearer ${config.github.token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'KnowledgeHarvester/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  async _harvest(signal) {
    if (!config.github.token) {
      logger.warn('No GITHUB_TOKEN set, skipping CI Configs harvester');
      return;
    }

    for (const { query, label } of SEARCH_QUERIES) {
      if (signal.aborted) break;
      logger.info(`CI Configs search: "${query}" [${label}]`);

      try {
        await this._searchAndProcess(query, label, signal);
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        logger.error('CI Configs search query failed', { query, error: err.message });
      }

      if (!signal.aborted) await new Promise(r => setTimeout(r, 5000));
    }
  }

  async _searchAndProcess(query, label, signal) {
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= MAX_PAGES_PER_QUERY && !signal.aborted) {
      await this.rateLimiter.acquire();
      const url = `${GITHUB_API}/search/code?q=${encodeURIComponent(query)}&per_page=100&page=${page}`;
      const res = await fetch(url, { headers: this._headers(), signal });

      await this._handleRateLimit(res);
      if (res.status === 403 || res.status === 429) {
        await new Promise(r => setTimeout(r, 60000));
        continue;
      }
      if (res.status === 422 || !res.ok) break;

      const data = await res.json();
      const items = data.items || [];
      logger.info(`CI Configs page ${page}: ${items.length} items`);

      const limit = pLimit(CONCURRENCY);
      const tasks = items
        .filter(item => !this.seenUrls.has(item.html_url))
        .map(item => limit(async () => {
          if (signal.aborted) return;
          this.seenUrls.add(item.html_url);
          await this.rateLimiter.acquire();
          try {
            await this._processFile(item, label, signal);
            this.resetConsecutiveErrors();
          } catch (err) {
            if (err.name === 'AbortError') throw err;
            this.recordError(err);
          }
        }));
      await Promise.all(tasks);

      hasMore = items.length === 100;
      page++;
      if (hasMore && !signal.aborted) await new Promise(r => setTimeout(r, 3000));
    }
  }

  async _handleRateLimit(res) {
    const remaining = parseInt(res.headers.get('x-ratelimit-remaining') || '999');
    if (remaining < 50) {
      const resetEpoch = parseInt(res.headers.get('x-ratelimit-reset') || '0') * 1000;
      const waitMs = Math.max(resetEpoch - Date.now() + 5000, 30000);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }

  async _processFile(searchResult, label, signal) {
    if (!searchResult.download_url) { this.stats.invalid++; return; }

    const res = await fetch(searchResult.download_url, { headers: this._headers(), signal });
    if (!res.ok) { this.stats.invalid++; return; }

    const text = await res.text();
    if (text.length > 500000 || text.length < 20) { this.stats.invalid++; return; }

    const filename = searchResult.name || searchResult.path?.split('/').pop() || '';
    const ciPlatform = this._detectPlatform(filename, label);
    if (!ciPlatform) { this.stats.invalid++; return; }

    this.stats.discovered++;

    const normalized = this._normalize(searchResult, text, filename, label, ciPlatform);

    const { isDuplicate } = await checkArtifactDuplicate(
      normalized.hash, normalized.source, normalized.source_id
    );
    if (isDuplicate) { this.stats.duplicate++; return; }

    await storeArtifact(normalized);
    this.stats.new++;
    logger.debug('Stored CI config', {
      id: normalized.id,
      platform: ciPlatform,
      repo: searchResult.repository?.full_name,
    });
  }

  _detectPlatform(filename, label) {
    if (label === 'jenkinsfile' || filename === 'Jenkinsfile') return 'jenkins';
    if (label === 'gitlab-ci' || filename === '.gitlab-ci.yml') return 'gitlab-ci';
    if (label === 'github-actions-workflow') return 'github-actions';
    const lname = filename.toLowerCase();
    if (lname.endsWith('.yml') || lname.endsWith('.yaml')) return 'github-actions';
    return null;
  }

  _normalize(searchResult, content, filename, label, ciPlatform) {
    const components = extractCIComponents(content, ciPlatform);
    const name = searchResult?.repository?.full_name
      ? `${searchResult.repository.full_name}/${filename}`
      : extractNameFromPath(filename);
    const description = searchResult?.repository?.description || '';

    const typeMetadata = {
      ci_platform: ciPlatform,
      jobs: components.jobs,
      stages: components.stages,
      has_matrix: components.hasMatrix,
      has_caching: components.hasCaching,
      has_artifacts: components.hasArtifacts,
      trigger_events: components.triggerEvents,
    };

    return {
      id: randomUUID(),
      hash: generateContentHash(content, 'ci-configs'),
      artifact_type: 'workflow',
      source: 'ci-configs',
      source_url: searchResult?.html_url || '',
      source_id: searchResult?.sha || searchResult?.html_url || randomUUID(),
      discovered_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      content: { source_code: content, filename },
      name,
      description,
      author: {
        username: searchResult?.repository?.owner?.login || null,
        profile_url: searchResult?.repository?.owner?.html_url || null,
      },
      language: ciPlatform === 'jenkins' ? 'groovy' : 'yaml',
      tool_type: ciPlatform,
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
}

/**
 * Extract structured components from CI config content.
 *
 * @param {string} content - Raw file content
 * @param {'github-actions'|'gitlab-ci'|'jenkins'} platform
 * @returns {object}
 */
export function extractCIComponents(content, platform) {
  if (platform === 'github-actions') return extractGitHubActionsComponents(content);
  if (platform === 'gitlab-ci') return extractGitLabCIComponents(content);
  if (platform === 'jenkins') return extractJenkinsfileComponents(content);
  return emptyComponents();
}

function extractGitHubActionsComponents(content) {
  // Jobs: top-level keys under jobs:
  const jobs = [];
  let inJobs = false;
  for (const line of content.split('\n')) {
    if (/^jobs:/.test(line)) { inJobs = true; continue; }
    if (inJobs && /^  (\w[\w-]*):/m.test(line)) {
      const m = line.match(/^  ([\w-]+):/);
      if (m) jobs.push(m[1]);
    }
    if (inJobs && /^\S/.test(line) && !line.startsWith('jobs:')) inJobs = false;
  }

  // Trigger events from 'on:' block
  const triggerEvents = [];
  const onMatch = content.match(/^on:\s*\n([\s\S]*?)(?=^\w)/m);
  if (onMatch) {
    const eventLines = onMatch[1].match(/^\s{2}(\w+):/gm) || [];
    for (const e of eventLines) triggerEvents.push(e.trim().replace(':', ''));
  }
  // Inline on: [push, pull_request]
  const inlineOn = content.match(/^on:\s*\[([^\]]+)\]/m);
  if (inlineOn) {
    for (const ev of inlineOn[1].split(',')) triggerEvents.push(ev.trim());
  }

  const hasMatrix = /\bmatrix:/m.test(content);
  const hasCaching = /\bactions\/cache\b/.test(content) || /\bcache:/m.test(content);
  const hasArtifacts = /\bactions\/upload-artifact\b/.test(content) || /\bactions\/download-artifact\b/.test(content);

  return {
    jobs: [...new Set(jobs)],
    stages: [],
    hasMatrix,
    hasCaching,
    hasArtifacts,
    triggerEvents: [...new Set(triggerEvents)],
  };
}

function extractGitLabCIComponents(content) {
  // Stages list
  const stages = [];
  const stagesBlock = content.match(/^stages:\s*\n([\s\S]*?)(?=^\w)/m);
  if (stagesBlock) {
    const stageLines = stagesBlock[1].match(/^\s+-\s+(\S+)/gm) || [];
    for (const s of stageLines) stages.push(s.trim().replace(/^-\s+/, ''));
  }

  // Jobs: top-level keys that are not reserved keywords
  const RESERVED = new Set(['stages', 'variables', 'include', 'workflow', 'default', 'image', 'services', 'before_script', 'after_script', 'cache', 'artifacts']);
  const jobs = [];
  for (const line of content.split('\n')) {
    const m = line.match(/^([\w-]+):\s*$/);
    if (m && !RESERVED.has(m[1])) jobs.push(m[1]);
  }

  const hasMatrix = /\bparallel:\s*\n\s+matrix:/m.test(content) || /\bparallel:\s*\d/m.test(content);
  const hasCaching = /\bcache:/m.test(content);
  const hasArtifacts = /\bartifacts:/m.test(content);

  // GitLab trigger events from workflow: rules or only/except
  const triggerEvents = [];
  if (/\bpush\b/.test(content)) triggerEvents.push('push');
  if (/\bmerge_request\b/.test(content)) triggerEvents.push('merge_request');
  if (/\bschedule\b/.test(content)) triggerEvents.push('schedule');
  if (/\bweb\b/.test(content)) triggerEvents.push('web');

  return {
    jobs: jobs.slice(0, 50),
    stages,
    hasMatrix,
    hasCaching,
    hasArtifacts,
    triggerEvents: [...new Set(triggerEvents)],
  };
}

function extractJenkinsfileComponents(content) {
  // Stages in declarative pipeline: stage('name') or stage "name"
  const stages = [];
  const stageMatches = content.match(/\bstage\s*\(\s*['"]([^'"]+)['"]\s*\)/g) || [];
  for (const m of stageMatches) {
    const name = m.match(/['"]([^'"]+)['"]/)?.[1];
    if (name) stages.push(name);
  }

  // Jenkins doesn't have "jobs" in the same sense — treat top-level stages as jobs
  const hasMatrix = /\bmatrix\s*\{/m.test(content) || /\baxes\s*\{/m.test(content);
  const hasCaching = false; // Jenkins caching is plugin-based
  const hasArtifacts = /\barchiveArtifacts\b/.test(content) || /\bjunit\b/.test(content);

  const triggerEvents = [];
  if (/\bcron\b/.test(content)) triggerEvents.push('cron');
  if (/\bpollSCM\b/.test(content)) triggerEvents.push('pollSCM');
  if (/\bGenericTrigger\b/.test(content)) triggerEvents.push('webhook');
  if (/\bupstream\b/.test(content)) triggerEvents.push('upstream');

  return {
    jobs: [],
    stages: [...new Set(stages)],
    hasMatrix,
    hasCaching,
    hasArtifacts,
    triggerEvents: [...new Set(triggerEvents)],
  };
}

function emptyComponents() {
  return { jobs: [], stages: [], hasMatrix: false, hasCaching: false, hasArtifacts: false, triggerEvents: [] };
}
