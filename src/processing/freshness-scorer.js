// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

// ── Recency scoring table (0-40 points) ──

const RECENCY_BRACKETS = [
  { maxDays: 7,   points: 40 },
  { maxDays: 30,  points: 30 },
  { maxDays: 90,  points: 20 },
  { maxDays: 180, points: 10 },
  { maxDays: 365, points: 5  },
];

// ── Star scoring table (0-30 points) ──

const STAR_BRACKETS = [
  { min: 5000, points: 30 },
  { min: 1001, points: 25 },
  { min: 501,  points: 20 },
  { min: 101,  points: 15 },
  { min: 11,   points: 10 },
  { min: 1,    points: 5  },
  { min: 0,    points: 0  },
];

// ── Fork scoring table (0-15 points) ──

const FORK_BRACKETS = [
  { min: 101, points: 15 },
  { min: 51,  points: 12 },
  { min: 21,  points: 9  },
  { min: 6,   points: 6  },
  { min: 1,   points: 3  },
  { min: 0,   points: 0  },
];

const ARCHIVED_PENALTY = 20;

/**
 * Score repository freshness on a 0-100 scale.
 *
 * Pure function — no I/O, no side effects.
 *
 * Scoring breakdown:
 *   Recency   0-40: based on days since last commit
 *   Stars     0-30: log-scaled bracket lookup
 *   Forks     0-15: log-scaled bracket lookup
 *   Archived  penalty of -20 if the repo is archived
 *
 * @param {{
 *   stars?: number,
 *   forks?: number,
 *   last_commit?: string|null,
 *   is_archived?: boolean
 * }} repoData
 * @returns {number} Integer score clamped to [0, 100]
 */
export function calculateFreshness(repoData = {}) {
  const stars = repoData.stars ?? 0;
  const forks = repoData.forks ?? 0;
  const is_archived = repoData.is_archived ?? false;
  const last_commit = repoData.last_commit ?? null;

  const recencyScore = scoreRecency(last_commit);
  const starScore = scoreBracket(stars, STAR_BRACKETS);
  const forkScore = scoreBracket(forks, FORK_BRACKETS);
  const archivedPenalty = is_archived ? ARCHIVED_PENALTY : 0;

  const raw = recencyScore + starScore + forkScore - archivedPenalty;
  return Math.max(0, Math.min(100, raw));
}

/**
 * Calculate recency score (0-40) from a commit date string.
 *
 * @param {string|null} lastCommitDate - ISO 8601 date string or null
 * @returns {number}
 */
function scoreRecency(lastCommitDate) {
  if (!lastCommitDate) return 0;

  const commitDate = new Date(lastCommitDate);
  if (isNaN(commitDate.getTime())) return 0;

  const nowMs = Date.now();
  const ageMs = nowMs - commitDate.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  if (ageDays < 0) return 40; // future-dated commits treated as brand-new

  for (const { maxDays, points } of RECENCY_BRACKETS) {
    if (ageDays < maxDays) return points;
  }
  return 0; // older than 365 days
}

/**
 * Perform a descending bracket lookup — returns points for the first bracket
 * whose min threshold is satisfied.
 *
 * @param {number} value
 * @param {Array<{ min: number, points: number }>} brackets - Ordered highest-first
 * @returns {number}
 */
function scoreBracket(value, brackets) {
  const n = typeof value === 'number' && !isNaN(value) ? value : 0;
  for (const { min, points } of brackets) {
    if (n >= min) return points;
  }
  return 0;
}

/**
 * Extract a GitHub owner/repo slug from a URL.
 *
 * @param {string} url
 * @returns {{ owner: string, repo: string }|null}
 */
function parseGitHubUrl(url) {
  if (!url) return null;
  const match = url.match(/github\.com\/([^/]+)\/([^/#?]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
}

/**
 * Batch-score GitHub artifacts that are missing freshness_signals metadata.
 * Rate-limited to 1 request/second.
 *
 * @param {object} db - pg pool / client with .query()
 * @param {number} limit - Max artifacts to process
 * @returns {{ processed: number, scored: number, errors: number }}
 */
export async function scoreFreshnessBatch(db, limit = 50) {
  const result = await db.query(
    `SELECT id, source_url, type_metadata
     FROM artifacts
     WHERE type_metadata->>'freshness_signals' IS NULL
       AND source_url LIKE '%github.com%'
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );

  if (result.rows.length === 0) {
    logger.info('No artifacts to score for freshness');
    return { processed: 0, scored: 0, errors: 0 };
  }

  logger.info(`Scoring freshness for ${result.rows.length} artifacts`);

  let processed = 0;
  let scored = 0;
  let errors = 0;

  for (const row of result.rows) {
    processed++;

    const slug = parseGitHubUrl(row.source_url);
    if (!slug) {
      logger.warn('Could not parse GitHub URL', { id: row.id, url: row.source_url });
      errors++;
      continue;
    }

    try {
      const repoData = await fetchGitHubRepo(slug.owner, slug.repo);

      const freshness = calculateFreshness(repoData);
      const updatedMeta = {
        ...(row.type_metadata || {}),
        freshness_signals: {
          score: freshness,
          stars: repoData.stars,
          forks: repoData.forks,
          last_commit: repoData.last_commit,
          is_archived: repoData.is_archived,
          scored_at: new Date().toISOString(),
        },
      };

      await db.query(
        `UPDATE artifacts SET type_metadata = $1 WHERE id = $2`,
        [JSON.stringify(updatedMeta), row.id]
      );

      scored++;
    } catch (err) {
      logger.error('Freshness scoring failed', { id: row.id, error: err.message });
      errors++;
    }

    // Rate-limit: 1 request per second
    if (processed < result.rows.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  logger.info('Freshness scoring complete', { processed, scored, errors });
  return { processed, scored, errors };
}

/**
 * Fetch repository metadata from the GitHub REST API.
 *
 * @param {string} owner
 * @param {string} repo
 * @returns {Promise<{ stars: number, forks: number, last_commit: string|null, is_archived: boolean }>}
 */
async function fetchGitHubRepo(owner, repo) {
  const url = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'knowledge-harvester/1.0',
  };

  if (config.github.token) {
    headers['Authorization'] = `Bearer ${config.github.token}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${owner}/${repo}`);
  }

  const data = await response.json();
  return {
    stars: data.stargazers_count ?? 0,
    forks: data.forks_count ?? 0,
    last_commit: data.pushed_at ?? null,
    is_archived: data.archived ?? false,
  };
}
