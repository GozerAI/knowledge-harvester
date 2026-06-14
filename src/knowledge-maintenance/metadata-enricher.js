// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #879 — Autonomous Metadata Enrichment
 *
 * Enriches artifact metadata by inferring missing fields from content,
 * cross-referencing with external signals, and normalizing formats.
 */

/**
 * Enrich metadata for a batch of artifacts.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ enriched: number, summary: object }>}
 */
export async function enrichMetadata(db, options = {}) {
  const limit = options.limit || 200;

  const result = await db.query(
    `SELECT id, name, description, source_url, primary_category,
            artifact_type, tags, type_metadata
     FROM artifacts
     WHERE type_metadata IS NULL
        OR type_metadata = '{}'::jsonb
        OR jsonb_array_length(COALESCE(tags, '[]'::jsonb)) = 0
     ORDER BY updated_at ASC
     LIMIT $1`,
    [limit]
  );

  let enriched = 0;
  for (const artifact of result.rows) {
    const enrichments = computeEnrichments(artifact);
    if (Object.keys(enrichments).length > 0) {
      const ok = await applyEnrichments(db, artifact.id, enrichments);
      if (ok) enriched++;
    }
  }

  return {
    enriched,
    summary: {
      scanned: result.rows.length,
      enriched,
      enrichment_rate: result.rows.length > 0 ? Math.round(enriched / result.rows.length * 100) : 0,
      enriched_at: new Date().toISOString(),
    },
  };
}

/**
 * Compute enrichments for an artifact.
 */
export function computeEnrichments(artifact) {
  const enrichments = {};
  const meta = typeof artifact.type_metadata === 'string'
    ? safeJsonParse(artifact.type_metadata) : (artifact.type_metadata || {});

  // Infer language from source URL or name
  if (!meta.language) {
    const lang = inferLanguage(artifact);
    if (lang) {
      enrichments.language = lang;
    }
  }

  // Infer complexity from description length and tags
  if (!meta.complexity) {
    enrichments.complexity = inferComplexity(artifact);
  }

  // Generate auto-tags from name and description
  if (!artifact.tags || (Array.isArray(artifact.tags) && artifact.tags.length === 0)) {
    const autoTags = generateAutoTags(artifact);
    if (autoTags.length > 0) {
      enrichments.auto_tags = autoTags;
    }
  }

  // Infer platform from source URL
  if (!meta.platform) {
    const platform = inferPlatform(artifact.source_url);
    if (platform) {
      enrichments.platform = platform;
    }
  }

  // Add enrichment timestamp
  if (Object.keys(enrichments).length > 0) {
    enrichments.enriched_at = new Date().toISOString();
  }

  return enrichments;
}

function inferLanguage(artifact) {
  const name = (artifact.name || '').toLowerCase();
  const desc = (artifact.description || '').toLowerCase();
  const combined = `${name} ${desc}`;

  const langPatterns = [
    { lang: 'python', patterns: ['python', '.py', 'pip', 'django', 'flask', 'fastapi'] },
    { lang: 'javascript', patterns: ['javascript', 'node', '.js', 'npm', 'react', 'express'] },
    { lang: 'typescript', patterns: ['typescript', '.ts', 'tsx'] },
    { lang: 'go', patterns: ['golang', '.go', 'go module'] },
    { lang: 'rust', patterns: ['rust', '.rs', 'cargo'] },
    { lang: 'java', patterns: ['java', '.java', 'maven', 'gradle', 'spring'] },
    { lang: 'yaml', patterns: ['yaml', 'yml'] },
    { lang: 'hcl', patterns: ['terraform', '.tf', 'hcl'] },
  ];

  for (const { lang, patterns } of langPatterns) {
    if (patterns.some(p => combined.includes(p))) return lang;
  }
  return null;
}

function inferComplexity(artifact) {
  const desc = artifact.description || '';
  const tags = Array.isArray(artifact.tags) ? artifact.tags : [];

  if (desc.length > 500 || tags.length > 8) return 'advanced';
  if (desc.length > 200 || tags.length > 4) return 'intermediate';
  return 'beginner';
}

function generateAutoTags(artifact) {
  const words = new Set();
  const name = (artifact.name || '').toLowerCase();
  const desc = (artifact.description || '').toLowerCase().slice(0, 200);

  for (const word of `${name} ${desc}`.split(/[\s\-_/,;:()]+/)) {
    if (word.length > 3 && !STOP_WORDS.has(word)) {
      words.add(word);
    }
  }

  if (artifact.artifact_type) words.add(artifact.artifact_type);
  return [...words].slice(0, 8);
}

function inferPlatform(sourceUrl) {
  if (!sourceUrl) return null;
  if (sourceUrl.includes('github.com')) return 'github';
  if (sourceUrl.includes('gitlab.com')) return 'gitlab';
  if (sourceUrl.includes('bitbucket.org')) return 'bitbucket';
  if (sourceUrl.includes('npmjs.com')) return 'npm';
  if (sourceUrl.includes('pypi.org')) return 'pypi';
  return null;
}

async function applyEnrichments(db, artifactId, enrichments) {
  try {
    await db.query(
      `UPDATE artifacts
       SET type_metadata = COALESCE(type_metadata, '{}'::jsonb) || $1::jsonb,
           updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(enrichments), artifactId]
    );
    return true;
  } catch {
    return false;
  }
}

function safeJsonParse(s) { try { return JSON.parse(s); } catch { return null; } }

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'will', 'have', 'been',
  'into', 'about', 'each', 'which', 'their', 'there', 'when', 'what', 'your',
  'more', 'some', 'than', 'them', 'then', 'also', 'just', 'like', 'over',
]);

export { inferLanguage, inferComplexity, inferPlatform, generateAutoTags };
