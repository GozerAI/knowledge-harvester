// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { BaseHarvester } from './base.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { normalizeWorkflow } from '../processing/normalizer.js';
import { checkDuplicate } from '../processing/deduplicator.js';
import { storeWorkflow } from '../db/store.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

const USER_AGENT = 'KnowledgeHarvester/1.0 (by /u/harvester_bot)';
const SUBREDDIT = 'n8n';
const MAX_PAGES = 10; // Reddit caps at ~1000 results via pagination

/**
 * Search terms to find posts likely to contain workflow JSON.
 */
const SEARCH_TERMS = [
  'workflow json',
  'template share',
  'automation share',
  'workflow share',
  'n8n workflow',
];

/**
 * Harvester for Reddit r/n8n using the public JSON API.
 *
 * Strategy: Append .json to Reddit URLs — no OAuth required.
 * Rate limit: ~30 requests/minute for unauthenticated access.
 *
 * Extracts:
 * 1. JSON code blocks from post body (selftext)
 * 2. GitHub Gist links (fetched and parsed)
 */
export class RedditHarvester extends BaseHarvester {
  constructor() {
    // ~30 req/min public JSON → 1 req per 2.5 seconds
    super(
      'reddit',
      new RateLimiter({ maxTokens: 5, refillRate: 1, refillIntervalMs: 2500 })
    );
    this.seenPostIds = new Set();
  }

  async _harvest(signal) {
    // 1. Fetch recent posts (newest first)
    logger.info('Reddit: Fetching recent posts from r/n8n');
    await this._fetchListing(
      `https://www.reddit.com/r/${SUBREDDIT}/new.json?limit=100`,
      signal
    );

    // 2. Search for workflow-related posts
    for (const term of SEARCH_TERMS) {
      if (signal.aborted) break;
      logger.info(`Reddit search: "${term}"`);
      const url = `https://www.reddit.com/r/${SUBREDDIT}/search.json?q=${encodeURIComponent(term)}&restrict_sr=on&limit=100&sort=new&t=all`;
      await this._fetchListing(url, signal);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  /**
   * Fetch a Reddit listing with pagination (using "after" cursor).
   */
  async _fetchListing(url, signal) {
    let after = null;
    let pages = 0;

    do {
      if (signal.aborted) break;
      await this.rateLimiter.acquire();

      const pageUrl = after
        ? `${url}${url.includes('?') ? '&' : '?'}after=${after}`
        : url;

      let res;
      try {
        res = await fetch(pageUrl, {
          headers: { 'User-Agent': USER_AGENT },
          signal,
        });
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        logger.error('Reddit fetch failed', { error: err.message });
        break;
      }

      if (!res.ok) {
        if (res.status === 429) {
          logger.warn('Reddit rate limited, waiting 60s');
          await new Promise(r => setTimeout(r, 60000));
          continue; // Retry same page
        }
        logger.error(`Reddit API ${res.status}`);
        break;
      }

      const data = await res.json();
      const posts = data?.data?.children || [];
      after = data?.data?.after;
      pages++;

      logger.info(`Reddit page ${pages}: ${posts.length} posts`, {
        after: after ? 'more' : 'done',
      });

      for (const post of posts) {
        if (signal.aborted) break;
        const postData = post.data;
        if (!postData || this.seenPostIds.has(postData.id)) continue;
        this.seenPostIds.add(postData.id);

        try {
          await this._processPost(postData, signal);
          this.resetConsecutiveErrors();
        } catch (err) {
          if (err.name === 'AbortError') throw err;
          this.recordError(err);
        }
      }

      // Delay between pages
      if (after && !signal.aborted) {
        await new Promise(r => setTimeout(r, 3000));
      }
    } while (after && pages < MAX_PAGES);
  }

  /**
   * Scan a Reddit post for n8n workflow content.
   */
  async _processPost(post, signal) {
    const text = post.selftext || '';

    // 1. Extract JSON from code blocks
    const jsonBlocks = this._extractJsonBlocks(text);
    for (const block of jsonBlocks) {
      if (this._isN8nWorkflow(block)) {
        await this._storeWorkflow(post, block, 'post_body');
      }
    }

    // 2. Extract and follow GitHub Gist links
    const gistLinks = this._extractGistLinks(text);
    for (const gistUrl of gistLinks) {
      if (signal.aborted) break;
      await this.rateLimiter.acquire();
      try {
        const workflowJson = await this._fetchGist(gistUrl, signal);
        if (workflowJson && this._isN8nWorkflow(workflowJson)) {
          await this._storeWorkflow(post, workflowJson, 'gist_link');
        }
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        logger.debug('Failed to fetch gist', { url: gistUrl, error: err.message });
      }
    }
  }

  /**
   * Normalize, dedup, and store a workflow extracted from a Reddit post.
   */
  async _storeWorkflow(post, workflowJson, context) {
    this.stats.discovered++;
    const normalized = normalizeWorkflow('reddit', {
      post,
      workflowJson,
      context,
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
    logger.debug('Stored Reddit workflow', {
      id: normalized.id,
      postTitle: post.title?.slice(0, 60),
    });
  }

  /**
   * Extract JSON objects from markdown code blocks.
   */
  _extractJsonBlocks(text) {
    const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
    const blocks = [];
    let match;
    while ((match = codeBlockRegex.exec(text)) !== null) {
      try {
        blocks.push(JSON.parse(match[1].trim()));
      } catch {
        // Not valid JSON, skip
      }
    }
    return blocks;
  }

  /**
   * Extract GitHub Gist URLs from text.
   */
  _extractGistLinks(text) {
    const gistRegex = /https?:\/\/gist\.github\.com\/[^\s\)]+/g;
    return text?.match(gistRegex) || [];
  }

  /**
   * Fetch a GitHub Gist and return the first .json file's parsed content.
   */
  async _fetchGist(gistUrl, signal) {
    // Convert gist URL to API URL
    const parts = gistUrl.replace('https://gist.github.com/', '').split('/');
    const gistId = parts[parts.length - 1]?.split('#')[0]; // Remove any anchor
    if (!gistId) return null;

    const apiUrl = `https://api.github.com/gists/${gistId}`;
    const headers = {
      'User-Agent': USER_AGENT,
      Accept: 'application/vnd.github.v3+json',
    };
    if (config.github.token) {
      headers.Authorization = `Bearer ${config.github.token}`;
    }

    const res = await fetch(apiUrl, { headers, signal });
    if (!res.ok) return null;

    const data = await res.json();
    // Find the first .json file in the gist
    for (const file of Object.values(data.files || {})) {
      if (file.filename?.endsWith('.json') && file.content) {
        try {
          return JSON.parse(file.content);
        } catch {
          continue;
        }
      }
    }
    return null;
  }

  /**
   * Check if a JSON object looks like an n8n workflow.
   */
  _isN8nWorkflow(obj) {
    if (!obj || !Array.isArray(obj.nodes)) return false;
    return obj.nodes.some(
      n =>
        n.type?.startsWith('n8n-nodes-base.') ||
        n.type?.startsWith('@n8n/') ||
        n.type?.includes('n8n')
    );
  }
}
