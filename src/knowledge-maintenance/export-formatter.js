// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #880 — Autonomous Knowledge Export Formatting
 *
 * Exports knowledge artifacts in multiple formats (JSON, CSV, Markdown,
 * YAML) with automatic schema adaptation and format optimization.
 */

const SUPPORTED_FORMATS = ['json', 'csv', 'markdown', 'yaml'];

/**
 * Export artifacts in the specified format.
 * @param {object} db
 * @param {object} [options]
 * @param {string} [options.format]
 * @param {number} [options.limit]
 * @param {string} [options.category]
 * @param {string} [options.type]
 * @returns {Promise<{ content: string, format: string, count: number, summary: object }>}
 */
export async function exportKnowledge(db, options = {}) {
  const format = options.format || 'json';
  const limit = options.limit || 100;

  if (!SUPPORTED_FORMATS.includes(format)) {
    throw new Error(`Unsupported format: ${format}. Use: ${SUPPORTED_FORMATS.join(', ')}`);
  }

  const artifacts = await fetchArtifacts(db, { limit, category: options.category, type: options.type });

  let content;
  switch (format) {
    case 'json': content = formatJson(artifacts); break;
    case 'csv': content = formatCsv(artifacts); break;
    case 'markdown': content = formatMarkdown(artifacts); break;
    case 'yaml': content = formatYaml(artifacts); break;
    default: content = formatJson(artifacts);
  }

  return {
    content,
    format,
    count: artifacts.length,
    summary: {
      exported: artifacts.length,
      format,
      size_bytes: Buffer.byteLength(content, 'utf8'),
      exported_at: new Date().toISOString(),
    },
  };
}

async function fetchArtifacts(db, { limit, category, type }) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (category) { conditions.push(`primary_category = $${idx++}`); params.push(category); }
  if (type) { conditions.push(`artifact_type = $${idx++}`); params.push(type); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await db.query(
    `SELECT id, name, description, primary_category, artifact_type,
            source_url, quality_score, tags, created_at, updated_at
     FROM artifacts
     ${where}
     ORDER BY quality_score DESC NULLS LAST
     LIMIT $${idx}`,
    [...params, limit]
  );
  return result.rows;
}

function formatJson(artifacts) {
  return JSON.stringify({
    exported_at: new Date().toISOString(),
    count: artifacts.length,
    artifacts,
  }, null, 2);
}

function formatCsv(artifacts) {
  if (artifacts.length === 0) return '';
  const headers = ['id', 'name', 'description', 'primary_category', 'artifact_type', 'source_url', 'quality_score', 'created_at', 'updated_at'];
  const rows = [headers.join(',')];
  for (const a of artifacts) {
    rows.push(headers.map(h => csvEscape(a[h])).join(','));
  }
  return rows.join('\n');
}

function formatMarkdown(artifacts) {
  const lines = [`# Knowledge Export`, ``, `> ${artifacts.length} artifacts exported on ${new Date().toISOString()}`, ``];
  for (const a of artifacts) {
    lines.push(`## ${a.name || 'Untitled'}`);
    lines.push(``);
    if (a.description) lines.push(a.description);
    lines.push(``);
    lines.push(`- **Type:** ${a.artifact_type || 'unknown'}`);
    lines.push(`- **Category:** ${a.primary_category || 'uncategorized'}`);
    if (a.source_url) lines.push(`- **Source:** ${a.source_url}`);
    if (a.quality_score != null) lines.push(`- **Quality:** ${a.quality_score}`);
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
  }
  return lines.join('\n');
}

function formatYaml(artifacts) {
  const lines = [`# Knowledge Export - ${new Date().toISOString()}`, `artifacts:`];
  for (const a of artifacts) {
    lines.push(`  - id: ${yamlEscape(a.id)}`);
    lines.push(`    name: ${yamlEscape(a.name)}`);
    if (a.description) lines.push(`    description: ${yamlEscape(a.description.slice(0, 200))}`);
    lines.push(`    type: ${yamlEscape(a.artifact_type)}`);
    if (a.primary_category) lines.push(`    category: ${yamlEscape(a.primary_category)}`);
    if (a.source_url) lines.push(`    source_url: ${yamlEscape(a.source_url)}`);
    if (a.quality_score != null) lines.push(`    quality_score: ${a.quality_score}`);
  }
  return lines.join('\n');
}

function csvEscape(val) {
  if (val == null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function yamlEscape(val) {
  if (val == null) return '""';
  const str = String(val);
  if (str.includes(':') || str.includes('#') || str.includes('\n') || str.includes('"')) {
    return `"${str.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
  }
  return str;
}

export { SUPPORTED_FORMATS, formatJson, formatCsv, formatMarkdown, formatYaml, csvEscape, yamlEscape };
