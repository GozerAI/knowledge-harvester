// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #879 — Autonomous Metadata Enrichment
 *
 * Infers and enriches artifact metadata by analyzing names, descriptions,
 * URLs, and tags to add language, platform, complexity, and auto-tags.
 */

const LANGUAGE_PATTERNS = [
  { lang: 'python', patterns: ['python', '.py', 'pip', 'django', 'flask', 'fastapi'] },
  { lang: 'javascript', patterns: ['javascript', 'node', '.js', 'npm', 'react', 'express'] },
  { lang: 'typescript', patterns: ['typescript', '.ts', 'tsx'] },
  { lang: 'go', patterns: ['golang', '.go', 'go module'] },
  { lang: 'rust', patterns: ['rust', '.rs', 'cargo'] },
  { lang: 'java', patterns: ['java', '.java', 'maven', 'gradle', 'spring'] },
  { lang: 'yaml', patterns: ['yaml', 'yml'] },
  { lang: 'hcl', patterns: ['terraform', '.tf', 'hcl'] },
];

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'will', 'have', 'been',
]);

/**
 * Infer programming language from artifact name/description.
 * @param {object} artifact
 * @returns {string|null}
 */
export function inferLanguage(artifact) {
  const combined = `${(artifact.name || '').toLowerCase()} ${(artifact.description || '').toLowerCase()}`;
  for (const { lang, patterns } of LANGUAGE_PATTERNS) {
    if (patterns.some(p => combined.includes(p))) return lang;
  }
  return null;
}

/**
 * Infer complexity level from artifact metadata.
 * @param {object} artifact
 * @returns {string}
 */
export function inferComplexity(artifact) {
  const desc = artifact.description || '';
  const tags = Array.isArray(artifact.tags) ? artifact.tags : [];
  if (desc.length > 500 || tags.length > 8) return 'advanced';
  if (desc.length > 200 || tags.length > 4) return 'intermediate';
  return 'beginner';
}

/**
 * Infer source platform from URL.
 * @param {string|null} sourceUrl
 * @returns {string|null}
 */
export function inferPlatform(sourceUrl) {
  if (!sourceUrl) return null;
  if (sourceUrl.includes('github.com')) return 'github';
  if (sourceUrl.includes('gitlab.com')) return 'gitlab';
  if (sourceUrl.includes('bitbucket.org')) return 'bitbucket';
  if (sourceUrl.includes('npmjs.com')) return 'npm';
  if (sourceUrl.includes('pypi.org')) return 'pypi';
  return null;
}

/**
 * Generate auto-tags from artifact name and description.
 * @param {object} artifact
 * @returns {string[]}
 */
export function generateAutoTags(artifact) {
  const words = new Set();
  const name = (artifact.name || '').toLowerCase();
  const desc = (artifact.description || '').toLowerCase().slice(0, 200);
  for (const word of `${name} ${desc}`.split(/[\s\-_/,;:()]+/)) {
    if (word.length > 3 && !STOP_WORDS.has(word)) words.add(word);
  }
  if (artifact.artifact_type) words.add(artifact.artifact_type);
  return [...words].slice(0, 8);
}

/**
 * Compute all enrichments for an artifact.
 * @param {object} artifact
 * @returns {object}
 */
export function computeEnrichments(artifact) {
  const enrichments = {};
  const meta = artifact.type_metadata || {};

  if (!meta.language) {
    const lang = inferLanguage(artifact);
    if (lang) enrichments.language = lang;
  }

  if (!meta.complexity) {
    enrichments.complexity = inferComplexity(artifact);
  }

  if (!artifact.tags || (Array.isArray(artifact.tags) && artifact.tags.length === 0)) {
    const autoTags = generateAutoTags(artifact);
    if (autoTags.length > 0) enrichments.auto_tags = autoTags;
  }

  if (!meta.platform) {
    const p = inferPlatform(artifact.source_url);
    if (p) enrichments.platform = p;
  }

  if (Object.keys(enrichments).length > 0) {
    enrichments.enriched_at = new Date().toISOString();
  }

  return enrichments;
}

/**
 * Batch enrich artifacts in the database.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ enriched: number, summary: object }>}
 */
export async function batchEnrich(db, options = {}) {
  const limit = options.limit || 200;

  const result = await db.query(
    `SELECT id, name, description, source_url, artifact_type, tags, type_metadata
     FROM artifacts ORDER BY updated_at ASC LIMIT $1`,
    [limit]
  );

  let enriched = 0;
  for (const artifact of result.rows) {
    const meta = typeof artifact.type_metadata === 'string'
      ? JSON.parse(artifact.type_metadata) : (artifact.type_metadata || {});
    artifact.type_metadata = meta;

    const e = computeEnrichments(artifact);
    if (Object.keys(e).length > 1) { // >1 because enriched_at is always added
      const newMeta = { ...meta };
      if (e.language) newMeta.language = e.language;
      if (e.complexity) newMeta.complexity = e.complexity;
      if (e.platform) newMeta.platform = e.platform;
      newMeta.enriched_at = e.enriched_at;

      try {
        await db.query(
          `UPDATE artifacts SET type_metadata = $1 WHERE id = $2`,
          [JSON.stringify(newMeta), artifact.id]
        );
        enriched++;
      } catch { /* skip */ }
    }
  }

  return {
    enriched,
    summary: {
      scanned: result.rows.length,
      enriched,
      enriched_at: new Date().toISOString(),
    },
  };
}

export { LANGUAGE_PATTERNS, STOP_WORDS };
