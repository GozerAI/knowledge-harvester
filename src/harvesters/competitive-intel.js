// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Competitive Intelligence Harvester
 *
 * Monitors Hacker News and GitHub for newly released tools, libraries,
 * and products in adjacent spaces (AI agents, automation, orchestration,
 * knowledge management, browser automation). Stores findings as
 * `documentation` artifacts tagged for competitive review.
 *
 * Sources:
 *  - HN Algolia API (no auth, free)
 *  - GitHub Search API (recent repos, requires GITHUB_TOKEN for higher rate limits)
 */

import { createHash, randomUUID } from 'node:crypto';
import { ArtifactBaseHarvester } from './artifact-base.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { checkArtifactDuplicate, storeArtifact } from '../db/artifact-store.js';
import { createSourceRecordSafely } from '../db/source-record-store.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

// Keyword clusters to monitor — grouped by strategic theme
const KEYWORD_CLUSTERS = {
  ai_agents:        ['autonomous agent', 'multi-agent', 'AI agent framework', 'agentic AI'],
  orchestration:    ['LLM orchestration', 'AI orchestration', 'agent orchestration'],
  browser_auto:     ['browser automation AI', 'web agent', 'browser use LLM'],
  knowledge:        ['knowledge graph AI', 'knowledge base LLM', 'AI knowledge management'],
  workflow:         ['AI workflow automation', 'workflow AI', 'AI pipeline orchestration'],
  incubator:        ['AI startup incubator', 'AI accelerator', 'AI venture studio'],
};

// All unique query strings for API calls
const HN_QUERIES = Object.values(KEYWORD_CLUSTERS).flat();

// GitHub topics to scan for recently-created, fast-growing repos
const GITHUB_QUERIES = [
  'autonomous-agent LLM',
  'multi-agent framework AI',
  'browser-use AI agent',
  'LLM orchestration framework',
  'AI workflow automation',
  'knowledge-graph LLM',
];

const HN_MIN_POINTS  = 10;   // Ignore low-signal posts
const GH_MIN_STARS   = 5;    // Ignore brand-new repos with no traction
const LOOKBACK_HOURS = 48;   // How far back to search

export class CompetitiveIntelHarvester extends ArtifactBaseHarvester {
  constructor() {
    super(
      'competitive-intel',
      'documentation',
      new RateLimiter({ maxTokens: 3, refillRate: 1, refillIntervalMs: 2000 }),
    );
    this._githubToken = config.github?.token || process.env.GITHUB_TOKEN || '';
  }

  async _harvest(signal) {
    const cutoff = Math.floor((Date.now() - LOOKBACK_HOURS * 3600 * 1000) / 1000);

    await this._harvestHN(cutoff, signal);
    await this._harvestGitHub(cutoff, signal);
  }

  // ---------------------------------------------------------------------------
  // Hacker News via Algolia
  // ---------------------------------------------------------------------------

  async _harvestHN(cutoffUnix, signal) {
    for (const query of HN_QUERIES) {
      if (signal.aborted) return;
      await this.rateLimiter.acquire();

      try {
        const url = new URL('https://hn.algolia.com/api/v1/search');
        url.searchParams.set('query', query);
        url.searchParams.set('tags', 'story');
        url.searchParams.set('numericFilters', `created_at_i>${cutoffUnix},points>=${HN_MIN_POINTS}`);
        url.searchParams.set('hitsPerPage', '20');

        const res = await fetch(url.toString(), { signal });
        if (!res.ok) {
          logger.warn('HN fetch failed', { query, status: res.status });
          continue;
        }

        const data = await res.json();
        for (const hit of data.hits ?? []) {
          if (signal.aborted) return;
          this.stats.discovered++;

          const sourceId = `hn-${hit.objectID}`;
          const itemUrl  = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
          const content  = {
            title:            hit.title,
            url:              itemUrl,
            hn_url:           `https://news.ycombinator.com/item?id=${hit.objectID}`,
            points:           hit.points || 0,
            num_comments:     hit.num_comments || 0,
            author:           hit.author,
            created_at:       hit.created_at,
            platform:         'hackernews',
            query_matched:    query,
            cluster:          this._clusterForQuery(query),
          };
          const hash = this._hash(itemUrl);

          const { isDuplicate } = await checkArtifactDuplicate(hash, this.source, sourceId);
          if (isDuplicate) {
            this.stats.duplicate++;
            this.resetConsecutiveErrors();
            continue;
          }

          await storeArtifact({
            id:           randomUUID(),
            hash,
            artifact_type: this.artifactType,
            source:       this.source,
            source_url:   itemUrl,
            source_id:    sourceId,
            discovered_at: new Date(),
            updated_at:   new Date(),
            content,
            name:         hit.title,
            description:  `HN: ${hit.points} pts, ${hit.num_comments} comments — matched "${query}"`,
            author:       { username: hit.author, profile_url: null },
            tags:         ['competitive-intel', 'hackernews', content.cluster],
            tool_metadata: {},
            type_metadata: { platform: 'hackernews', points: hit.points },
            quality: {
              score:             Math.min(1, (hit.points || 0) / 200),
              has_description:   true,
              has_documentation: false,
              is_complete:       true,
              validation_status: 'valid',
            },
            runId: this.runId,
          });

          this.stats.new++;
          this.resetConsecutiveErrors();
          logger.debug('Stored HN competitive-intel item', { title: hit.title });
        }
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        this.recordError(err);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // GitHub Search — recently created repos
  // ---------------------------------------------------------------------------

  async _harvestGitHub(cutoffUnix, signal) {
    if (!this._githubToken) {
      logger.warn('No GITHUB_TOKEN — GitHub competitive-intel harvesting skipped');
      return;
    }

    const cutoffDate = new Date(cutoffUnix * 1000).toISOString().split('T')[0];
    const headers = {
      Authorization: `Bearer ${this._githubToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    for (const query of GITHUB_QUERIES) {
      if (signal.aborted) return;
      await this.rateLimiter.acquire();

      try {
        const q   = `${query} created:>=${cutoffDate}`;
        const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=10`;

        const res = await fetch(url, { headers, signal });
        if (res.status === 403) {
          logger.warn('GitHub rate limited in competitive-intel harvester');
          break;
        }
        if (!res.ok) {
          logger.warn('GitHub search failed', { query, status: res.status });
          continue;
        }

        const data = await res.json();
        for (const repo of data.items ?? []) {
          if (signal.aborted) return;
          if ((repo.stargazers_count || 0) < GH_MIN_STARS) continue;

          this.stats.discovered++;

          const sourceId = `gh-${repo.id}`;
          const itemUrl  = repo.html_url;
          const content  = {
            title:         repo.full_name,
            url:           itemUrl,
            description:   repo.description || '',
            stars:         repo.stargazers_count,
            language:      repo.language,
            topics:        repo.topics || [],
            created_at:    repo.created_at,
            pushed_at:     repo.pushed_at,
            platform:      'github',
            query_matched: query,
            cluster:       this._clusterForQuery(query),
          };
          const hash = this._hash(itemUrl);

          const { isDuplicate } = await checkArtifactDuplicate(hash, this.source, sourceId);
          if (isDuplicate) {
            this.stats.duplicate++;
            this.resetConsecutiveErrors();
            continue;
          }

          await storeArtifact({
            id:            randomUUID(),
            hash,
            artifact_type: this.artifactType,
            source:        this.source,
            source_url:    itemUrl,
            source_id:     sourceId,
            discovered_at: new Date(),
            updated_at:    new Date(),
            content,
            name:          repo.full_name,
            description:   repo.description || `GitHub repo — ${repo.stargazers_count} stars, matched "${query}"`,
            author:        { username: repo.owner?.login || null, profile_url: repo.owner?.html_url || null },
            tags:          ['competitive-intel', 'github', content.cluster, ...(repo.topics || []).slice(0, 5)],
            tool_metadata: {},
            type_metadata: { platform: 'github', stars: repo.stargazers_count, language: repo.language },
            quality: {
              score:             Math.min(1, (repo.stargazers_count || 0) / 500),
              has_description:   !!repo.description,
              has_documentation: (repo.topics || []).includes('documentation'),
              is_complete:       true,
              validation_status: 'valid',
            },
            runId: this.runId,
          });

          this.stats.new++;
          this.resetConsecutiveErrors();
          logger.debug('Stored GitHub competitive-intel repo', { name: repo.full_name, stars: repo.stargazers_count });
        }
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        this.recordError(err);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  _hash(input) {
    return createHash('sha256').update(input).digest('hex');
  }

  _clusterForQuery(query) {
    for (const [cluster, queries] of Object.entries(KEYWORD_CLUSTERS)) {
      if (queries.includes(query)) return cluster;
    }
    // GitHub queries don't map 1:1 — derive from content
    if (query.includes('agent')) return 'ai_agents';
    if (query.includes('orchestration')) return 'orchestration';
    if (query.includes('browser')) return 'browser_auto';
    if (query.includes('knowledge')) return 'knowledge';
    if (query.includes('workflow')) return 'workflow';
    if (query.includes('incubator') || query.includes('accelerator')) return 'incubator';
    return 'general';
  }
}
