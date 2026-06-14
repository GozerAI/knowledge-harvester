// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #873 — Autonomous Source Discovery Expansion
 *
 * Expands the set of known harvesting sources by analyzing artifact
 * references, dependency graphs, and community links.
 */

/**
 * Expand source discovery by analyzing existing artifact links.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ new_sources: object[], summary: object }>}
 */
export async function expandSourceDiscovery(db, options = {}) {
  const limit = options.limit || 100;

  const fromRefs = await discoverFromReferences(db, limit);
  const fromOrgs = await discoverFromOrganizations(db, limit);
  const fromTags = await discoverFromTags(db, limit);

  const allSources = deduplicateSources([...fromRefs, ...fromOrgs, ...fromTags]);
  const existingSources = await getExistingSources(db);
  const newSources = allSources.filter(s => !existingSources.has(s.url));

  return {
    new_sources: newSources.slice(0, limit),
    summary: {
      candidates_found: allSources.length,
      already_known: allSources.length - newSources.length,
      new_sources: Math.min(newSources.length, limit),
      by_method: countBy(newSources, 'method'),
      discovered_at: new Date().toISOString(),
    },
  };
}

async function discoverFromReferences(db, limit) {
  const result = await db.query(
    `SELECT DISTINCT source_url FROM artifacts
     WHERE source_url IS NOT NULL AND source_url LIKE '%github.com%'
     LIMIT $1`,
    [limit]
  );

  const sources = [];
  for (const row of result.rows) {
    const orgUrl = extractOrgUrl(row.source_url);
    if (orgUrl) {
      sources.push({
        name: orgUrl.split('/').pop(),
        url: orgUrl,
        method: 'reference',
        relevance: 0.7,
      });
    }
  }
  return sources;
}

async function discoverFromOrganizations(db, limit) {
  const result = await db.query(
    `SELECT source_url, COUNT(*)::int AS cnt
     FROM artifacts
     WHERE source_url IS NOT NULL AND source_url LIKE '%github.com%'
     GROUP BY source_url
     ORDER BY cnt DESC
     LIMIT $1`,
    [limit]
  );

  const orgs = new Map();
  for (const row of result.rows) {
    const org = extractOrgName(row.source_url);
    if (org && !orgs.has(org)) {
      orgs.set(org, {
        name: `${org}-repos`,
        url: `https://github.com/${org}`,
        method: 'organization',
        relevance: Math.min(0.5 + row.cnt * 0.05, 0.95),
      });
    }
  }
  return [...orgs.values()];
}

async function discoverFromTags(db, limit) {
  const result = await db.query(
    `SELECT tags, COUNT(*)::int AS cnt
     FROM artifacts
     WHERE tags IS NOT NULL
     GROUP BY tags
     ORDER BY cnt DESC
     LIMIT $1`,
    [limit]
  );

  const sources = [];
  for (const row of result.rows) {
    const tags = Array.isArray(row.tags) ? row.tags
      : typeof row.tags === 'string' ? safeJsonParse(row.tags) : [];
    if (!tags) continue;

    for (const tag of tags) {
      if (typeof tag === 'string' && tag.length > 3) {
        sources.push({
          name: `${tag}-github`,
          url: `https://github.com/topics/${encodeURIComponent(tag)}`,
          method: 'tag_expansion',
          relevance: Math.min(0.4 + row.cnt * 0.02, 0.8),
        });
      }
    }
  }
  return sources;
}

async function getExistingSources(db) {
  try {
    const result = await db.query(`SELECT DISTINCT source FROM artifacts WHERE source IS NOT NULL`);
    return new Set(result.rows.map(r => r.source));
  } catch {
    return new Set();
  }
}

function extractOrgUrl(url) {
  const match = url?.match(/https?:\/\/github\.com\/([^/]+)/);
  return match ? `https://github.com/${match[1]}` : null;
}

function extractOrgName(url) {
  const match = url?.match(/github\.com\/([^/]+)/);
  return match ? match[1] : null;
}

function deduplicateSources(sources) {
  const seen = new Set();
  return sources.filter(s => {
    const key = s.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function safeJsonParse(s) { try { return JSON.parse(s); } catch { return null; } }

function countBy(arr, field) {
  const c = {};
  for (const i of arr) { c[i[field]] = (c[i[field]] || 0) + 1; }
  return c;
}

export { extractOrgUrl, extractOrgName, deduplicateSources };
