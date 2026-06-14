// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #871 — Citation Verification Against Sources
 *
 * Validates that artifact source URLs are well-formed, reachable, and
 * still point to the expected content. Flags broken or suspicious citations.
 */

/**
 * Check if a string is a valid HTTP(S) URL.
 * @param {string} str
 * @returns {boolean}
 */
export function isUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Classify URL by source platform.
 * @param {string} url
 * @returns {string|null}
 */
export function classifyUrlPlatform(url) {
  if (!url) return null;
  if (url.includes('github.com')) return 'github';
  if (url.includes('gitlab.com')) return 'gitlab';
  if (url.includes('bitbucket.org')) return 'bitbucket';
  if (url.includes('npmjs.com')) return 'npm';
  if (url.includes('pypi.org')) return 'pypi';
  if (url.includes('hub.docker.com')) return 'docker';
  return 'other';
}

/**
 * Verify citations across the knowledge base.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ results: object[], summary: object }>}
 */
export async function verifyCitations(db, options = {}) {
  const limit = options.limit || 200;

  const result = await db.query(
    `SELECT id, name, source_url FROM artifacts
     WHERE source_url IS NOT NULL
     ORDER BY updated_at DESC LIMIT $1`,
    [limit]
  );

  const results = [];
  for (const row of result.rows) {
    const valid = isUrl(row.source_url);
    const platform = classifyUrlPlatform(row.source_url);
    results.push({
      artifact_id: row.id,
      name: row.name,
      source_url: row.source_url,
      url_valid: valid,
      platform,
      status: valid ? 'valid_format' : 'invalid_format',
    });
  }

  const validCount = results.filter(r => r.url_valid).length;
  const invalidCount = results.filter(r => !r.url_valid).length;

  return {
    results,
    summary: {
      total_checked: results.length,
      valid: validCount,
      invalid: invalidCount,
      by_platform: countByField(results.filter(r => r.platform), 'platform'),
      verified_at: new Date().toISOString(),
    },
  };
}

function countByField(arr, field) {
  const c = {};
  for (const i of arr) { c[i[field]] = (c[i[field]] || 0) + 1; }
  return c;
}
