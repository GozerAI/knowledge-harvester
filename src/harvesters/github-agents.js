// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { BaseHarvester } from './base.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { normalizeWorkflow } from '../processing/normalizer.js';
import { checkDuplicate } from '../processing/deduplicator.js';
import { storeWorkflow } from '../db/store.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import pLimit from 'p-limit';

/**
 * Segmented search queries for AI agent frameworks on GitHub.
 * Each query targets a different framework or pattern.
 */
const SEARCH_QUERIES = [
  // LangChain
  { query: '"from langchain" "Agent" extension:py', framework: 'langchain' },
  { query: '"langchain.agents" extension:py', framework: 'langchain' },
  { query: '"create_react_agent" extension:py', framework: 'langchain' },
  { query: 'filename:agent.py "langchain"', framework: 'langchain' },
  { query: '"AgentExecutor" extension:py langchain', framework: 'langchain' },

  // CrewAI
  { query: '"from crewai" extension:py', framework: 'crewai' },
  { query: '"crewai" filename:crew.py', framework: 'crewai' },
  { query: '"CrewBase" extension:py', framework: 'crewai' },
  { query: 'filename:crew.yaml crewai', framework: 'crewai' },

  // AutoGen
  { query: '"from autogen" "Agent" extension:py', framework: 'autogen' },
  { query: '"autogen.agentchat" extension:py', framework: 'autogen' },
  { query: '"ConversableAgent" extension:py', framework: 'autogen' },

  // General AI agent patterns
  { query: 'filename:agents.yaml langchain', framework: 'langchain' },
  { query: '"agent_executor" "tools" extension:py', framework: 'langchain' },
];

const GITHUB_API = 'https://api.github.com';
const CONCURRENCY = 5;
const MAX_PAGES_PER_QUERY = 5; // Fewer pages — agent code is more niche

/**
 * Harvester for AI agent frameworks (LangChain, CrewAI, AutoGen) on GitHub.
 * Searches for Python files and YAML configs containing agent definitions.
 */
export class GitHubAgentsHarvester extends BaseHarvester {
  constructor() {
    // Share rate budget with main GitHub harvester
    super(
      'github-agents',
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
      logger.warn('No GITHUB_TOKEN set, skipping GitHub agents harvester');
      return;
    }

    for (const { query, framework } of SEARCH_QUERIES) {
      if (signal.aborted) break;
      logger.info(`GitHub agents search: "${query}" [${framework}]`);

      try {
        await this._searchAndProcess(query, framework, signal);
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        logger.error('GitHub agents search query failed', { query, error: err.message });
      }

      // Pause between queries
      if (!signal.aborted) {
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  /**
   * Execute a single search query with pagination.
   */
  async _searchAndProcess(query, framework, signal) {
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= MAX_PAGES_PER_QUERY && !signal.aborted) {
      await this.rateLimiter.acquire();

      const url = `${GITHUB_API}/search/code?q=${encodeURIComponent(query)}&per_page=100&page=${page}`;
      const res = await fetch(url, { headers: this._headers(), signal });

      await this._handleRateLimit(res);

      if (res.status === 403 || res.status === 429) {
        logger.warn('GitHub rate limited, pausing 60s');
        await new Promise(r => setTimeout(r, 60000));
        continue;
      }

      if (res.status === 422) {
        logger.warn('GitHub search validation failed', { query, page });
        break;
      }

      if (!res.ok) {
        logger.error(`GitHub search failed: ${res.status}`, { query, page });
        break;
      }

      const data = await res.json();
      const items = data.items || [];
      logger.info(`GitHub agents page ${page}: ${items.length} items (total: ${data.total_count})`);

      // Process items with concurrency
      const limit = pLimit(CONCURRENCY);
      const tasks = items
        .filter(item => !this.seenUrls.has(item.html_url))
        .map(item =>
          limit(async () => {
            if (signal.aborted) return;
            this.seenUrls.add(item.html_url);
            await this.rateLimiter.acquire();
            try {
              await this._processFile(item, framework, signal);
              this.resetConsecutiveErrors();
            } catch (err) {
              if (err.name === 'AbortError') throw err;
              this.recordError(err);
            }
          })
        );
      await Promise.all(tasks);

      hasMore = items.length === 100;
      page++;

      if (hasMore && !signal.aborted) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  /**
   * Monitor GitHub rate limit headers.
   */
  async _handleRateLimit(res) {
    const remaining = parseInt(res.headers.get('x-ratelimit-remaining') || '999');
    if (remaining < 50) {
      const resetEpoch = parseInt(res.headers.get('x-ratelimit-reset') || '0') * 1000;
      const waitMs = Math.max(resetEpoch - Date.now() + 5000, 30000);
      logger.warn(`GitHub rate limit low (${remaining} remaining), waiting ${Math.round(waitMs / 1000)}s`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }

  /**
   * Fetch and validate a single file as an AI agent framework artifact.
   */
  async _processFile(searchResult, framework, signal) {
    if (!searchResult.download_url) {
      this.stats.invalid++;
      return;
    }

    // Skip very large files (>500KB — likely not agent code)
    const res = await fetch(searchResult.download_url, {
      headers: this._headers(),
      signal,
    });

    if (!res.ok) {
      this.stats.invalid++;
      return;
    }

    const text = await res.text();

    // Size check
    if (text.length > 500000) {
      this.stats.invalid++;
      return;
    }

    // Validate as agent framework code
    const filename = searchResult.name || searchResult.path?.split('/').pop() || '';
    const validation = this._validateAgentCode(text, filename, framework);
    if (!validation.valid) {
      this.stats.invalid++;
      return;
    }

    this.stats.discovered++;

    // For YAML files, try to parse as JSON for structured storage
    let content = text;
    if (filename.endsWith('.yaml') || filename.endsWith('.yml')) {
      // Store as-is (YAML string) — we can't easily parse without a dep
      content = text;
    }

    const normalized = normalizeWorkflow('github-agents', {
      searchResult,
      content,
      framework: validation.framework || framework,
      filename,
    });

    const { isDuplicate } = await checkDuplicate(
      normalized.hash,
      normalized.source,
      normalized.source_id
    );
    if (isDuplicate) {
      this.stats.duplicate++;
      return;
    }

    await storeWorkflow(normalized);
    this.stats.new++;
    logger.debug('Stored agent framework', {
      id: normalized.id,
      name: normalized.workflow_name,
      framework: validation.framework || framework,
      repo: searchResult.repository?.full_name,
    });
  }

  /**
   * Validate that a file contains actual agent framework code.
   * Returns { valid: boolean, framework: string }.
   */
  _validateAgentCode(content, filename, expectedFramework) {
    const ext = filename.split('.').pop()?.toLowerCase();

    // Must be Python or YAML
    if (!['py', 'yaml', 'yml'].includes(ext)) {
      return { valid: false };
    }

    // Python file validation
    if (ext === 'py') {
      // Must have framework-specific imports
      const hasLangChain = content.includes('from langchain') || content.includes('import langchain');
      const hasCrewAI = content.includes('from crewai') || content.includes('import crewai');
      const hasAutoGen = content.includes('from autogen') || content.includes('import autogen');

      if (hasLangChain) return { valid: true, framework: 'langchain' };
      if (hasCrewAI) return { valid: true, framework: 'crewai' };
      if (hasAutoGen) return { valid: true, framework: 'autogen' };

      return { valid: false };
    }

    // YAML file validation
    if (ext === 'yaml' || ext === 'yml') {
      const hasAgentDefs = content.includes('agents:') || content.includes('agent:');
      const hasCrewDefs = content.includes('crew:') || content.includes('tasks:');
      const hasLangChainDefs = content.includes('chains:') || content.includes('tools:');

      if (hasCrewDefs && content.includes('crewai')) return { valid: true, framework: 'crewai' };
      if (hasLangChainDefs && content.includes('langchain')) return { valid: true, framework: 'langchain' };
      if (hasAgentDefs) return { valid: true, framework: expectedFramework };

      return { valid: false };
    }

    return { valid: false };
  }
}
