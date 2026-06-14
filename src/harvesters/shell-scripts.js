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
  { query: 'filename:deploy.sh language:shell', label: 'deploy' },
  { query: 'filename:setup.sh language:shell', label: 'setup' },
  { query: 'filename:install.sh language:shell', label: 'install' },
  { query: 'filename:entrypoint.sh language:shell', label: 'entrypoint' },
];

const GITHUB_API = 'https://api.github.com';
const CONCURRENCY = 5;
const MAX_PAGES_PER_QUERY = 5;

/**
 * Harvester for shell script files on GitHub.
 * Targets deploy, setup, install, and entrypoint scripts.
 */
export class ShellScriptsHarvester extends ArtifactBaseHarvester {
  constructor() {
    super(
      'shell-scripts',
      'infra_config',
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
      logger.warn('No GITHUB_TOKEN set, skipping Shell Scripts harvester');
      return;
    }

    for (const { query, label } of SEARCH_QUERIES) {
      if (signal.aborted) break;
      logger.info(`Shell Scripts search: "${query}" [${label}]`);

      try {
        await this._searchAndProcess(query, label, signal);
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        logger.error('Shell Scripts search query failed', { query, error: err.message });
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
      logger.info(`Shell Scripts page ${page}: ${items.length} items`);

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
    if (text.length > 500000 || text.length < 5) { this.stats.invalid++; return; }

    this.stats.discovered++;

    const filename = searchResult.name || `${label}.sh`;
    const normalized = this._normalize(searchResult, text, filename, label);

    const { isDuplicate } = await checkArtifactDuplicate(
      normalized.hash, normalized.source, normalized.source_id
    );
    if (isDuplicate) { this.stats.duplicate++; return; }

    await storeArtifact(normalized);
    this.stats.new++;
    logger.debug('Stored shell script', {
      id: normalized.id,
      scriptType: normalized.type_metadata.script_type,
      repo: searchResult.repository?.full_name,
    });
  }

  _normalize(searchResult, content, filename, label) {
    const components = extractShellScriptComponents(content, label);
    const name = searchResult?.repository?.full_name
      ? `${searchResult.repository.full_name}/${filename}`
      : extractNameFromPath(filename);
    const description = searchResult?.repository?.description || '';

    const typeMetadata = {
      config_type: 'shell_script',
      shell: components.shell,
      functions: components.functions,
      has_error_handling: components.hasErrorHandling,
      has_logging: components.hasLogging,
      uses_sudo: components.usesSudo,
      script_type: components.scriptType,
    };

    return {
      id: randomUUID(),
      hash: generateContentHash(content, 'shell-scripts'),
      artifact_type: 'infra_config',
      source: 'shell-scripts',
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
      language: 'shell',
      tool_type: components.shell,
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
 * Extract components from shell script content.
 *
 * @param {string} content - Raw shell script text
 * @param {string} [label] - Harvester label hint ('deploy'|'setup'|'install'|'entrypoint')
 * @returns {object}
 */
export function extractShellScriptComponents(content, label = '') {
  if (!content || typeof content !== 'string') {
    return {
      shell: 'sh',
      functions: [],
      hasErrorHandling: false,
      hasLogging: false,
      usesSudo: false,
      scriptType: 'unknown',
    };
  }

  // Detect shell from shebang
  const shebang = content.split('\n')[0] || '';
  let shell = 'sh';
  if (/bash/.test(shebang)) shell = 'bash';
  else if (/zsh/.test(shebang)) shell = 'zsh';
  else if (/sh/.test(shebang)) shell = 'sh';

  // Extract function names: function foo() or foo()
  const funcMatches = [
    ...content.matchAll(/^(?:function\s+)?(\w+)\s*\(\s*\)\s*\{/gm),
  ];
  const functions = [...new Set(funcMatches.map(m => m[1]).filter(Boolean))].slice(0, 50);

  // Error handling: set -e, set -o errexit, or trap ERR
  const hasErrorHandling = /\bset\s+-[eo]\b|\bset\s+-[^-]*e|\btrap\b.*\bERR\b|\bset\s+-o\s+errexit\b/.test(content);

  // Logging: echo, printf, logger, log functions
  const hasLogging = /\blog\s*\(|\becho\s+|printf\s+.*\bERROR\b|\becho\s+.*\bINFO\b|\becho\s+.*\bWARN/i.test(content);

  const usesSudo = /\bsudo\b/.test(content);

  // Script type from label or filename patterns
  const scriptType = deriveScriptType(label, content);

  return { shell, functions, hasErrorHandling, hasLogging, usesSudo, scriptType };
}

function deriveScriptType(label, content) {
  if (label === 'deploy' || /\bdeploy\b/i.test(content.slice(0, 500))) return 'deploy';
  if (label === 'setup') return 'setup';
  if (label === 'install' || /\bapt-get\b|\byum\b|\bbrew install\b/.test(content)) return 'install';
  if (label === 'entrypoint' || /exec\s+"\$@"/.test(content)) return 'entrypoint';
  return 'setup';
}
