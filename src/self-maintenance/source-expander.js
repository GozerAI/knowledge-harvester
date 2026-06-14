// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #873 — Source Discovery Expansion
 *
 * Expands the set of harvesting sources by analyzing existing artifacts,
 * extracting organization URLs, and mapping related repositories.
 */

/**
 * Extract the GitHub organization URL from a full repo URL.
 * @param {string|null} url
 * @returns {string|null}
 */
export function extractOrgUrl(url) {
  const match = url?.match(/https?:\/\/github\.com\/([^/]+)/);
  return match ? `https://github.com/${match[1]}` : null;
}

/**
 * Extract the GitHub organization/user name from a URL.
 * @param {string|null} url
 * @returns {string|null}
 */
export function extractOrgName(url) {
  const match = url?.match(/github\.com\/([^/]+)/);
  return match ? match[1] : null;
}

/**
 * Extract domain from any URL.
 * @param {string|null} url
 * @returns {string|null}
 */
export function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Expand sources by analyzing existing artifact URLs.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ sources: object[], summary: object }>}
 */
export async function expandSources(db, options = {}) {
  const limit = options.limit || 200;

  const result = await db.query(
    `SELECT DISTINCT source_url, primary_category, artifact_type
     FROM artifacts WHERE source_url IS NOT NULL
     ORDER BY quality_score DESC NULLS LAST LIMIT $1`,
    [limit]
  );

  const orgMap = new Map();
  const domainMap = new Map();

  for (const row of result.rows) {
    const orgUrl = extractOrgUrl(row.source_url);
    const orgName = extractOrgName(row.source_url);
    if (orgUrl && orgName) {
      if (!orgMap.has(orgUrl)) {
        orgMap.set(orgUrl, {
          name: orgName,
          url: orgUrl,
          type: 'organization',
          categories: new Set(),
          artifact_count: 0,
        });
      }
      const entry = orgMap.get(orgUrl);
      if (row.primary_category) entry.categories.add(row.primary_category);
      entry.artifact_count++;
    }

    const domain = extractDomain(row.source_url);
    if (domain && !domain.includes('github.com')) {
      if (!domainMap.has(domain)) {
        domainMap.set(domain, {
          name: domain,
          url: `https://${domain}`,
          type: 'domain',
          categories: new Set(),
          artifact_count: 0,
        });
      }
      const entry = domainMap.get(domain);
      if (row.primary_category) entry.categories.add(row.primary_category);
      entry.artifact_count++;
    }
  }

  const sources = [
    ...[...orgMap.values()].map(s => ({
      ...s, categories: [...s.categories],
      relevance: Math.min(s.artifact_count / 10, 1),
    })),
    ...[...domainMap.values()].map(s => ({
      ...s, categories: [...s.categories],
      relevance: Math.min(s.artifact_count / 5, 1),
    })),
  ];

  sources.sort((a, b) => b.relevance - a.relevance);

  return {
    sources: sources.slice(0, limit),
    summary: {
      total_sources: sources.length,
      organizations: orgMap.size,
      domains: domainMap.size,
      expanded_at: new Date().toISOString(),
    },
  };
}
