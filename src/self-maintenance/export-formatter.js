// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #880 — Knowledge Export Formatting
 *
 * Formats knowledge artifacts for export in multiple formats:
 * JSON, CSV, Markdown, and YAML.
 */

const SUPPORTED_FORMATS = ['json', 'csv', 'markdown', 'yaml'];

const CSV_HEADERS = [
  'id', 'name', 'description', 'primary_category', 'artifact_type',
  'source_url', 'quality_score', 'created_at', 'updated_at',
];

/**
 * Escape a value for CSV output.
 * @param {*} val
 * @returns {string}
 */
export function csvEscape(val) {
  if (val == null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Escape a value for YAML output.
 * @param {*} val
 * @returns {string}
 */
export function yamlEscape(val) {
  if (val == null) return '""';
  const str = String(val);
  if (str.includes(':') || str.includes('#') || str.includes('\n') || str.includes('"')) {
    return `"${str.replace(/"/g, '\\"').replace(/\n/g, '\n')}"`;
  }
  return str;
}

/**
 * Format artifacts as JSON.
 * @param {object[]} artifacts
 * @returns {string}
 */
export function formatJson(artifacts) {
  return JSON.stringify({
    exported_at: new Date().toISOString(),
    count: artifacts.length,
    artifacts,
  }, null, 2);
}

/**
 * Format artifacts as CSV.
 * @param {object[]} artifacts
 * @returns {string}
 */
export function formatCsv(artifacts) {
  if (artifacts.length === 0) return '';
  const rows = [CSV_HEADERS.join(',')];
  for (const a of artifacts) {
    rows.push(CSV_HEADERS.map(h => csvEscape(a[h])).join(','));
  }
  return rows.join('\n');
}

/**
 * Format artifacts as Markdown.
 * @param {object[]} artifacts
 * @returns {string}
 */
export function formatMarkdown(artifacts) {
  const lines = [
    `# Knowledge Export`, ``,
    `> ${artifacts.length} artifacts exported on ${new Date().toISOString()}`, ``,
  ];
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

/**
 * Format artifacts as YAML.
 * @param {object[]} artifacts
 * @returns {string}
 */
export function formatYaml(artifacts) {
  const lines = [
    `exported_at: ${new Date().toISOString()}`,
    `count: ${artifacts.length}`,
    `artifacts:`,
  ];
  for (const a of artifacts) {
    lines.push(`  - id: ${yamlEscape(a.id)}`);
    lines.push(`    name: ${yamlEscape(a.name)}`);
    lines.push(`    type: ${yamlEscape(a.artifact_type)}`);
    lines.push(`    category: ${yamlEscape(a.primary_category)}`);
    if (a.source_url) lines.push(`    source_url: ${yamlEscape(a.source_url)}`);
    if (a.quality_score != null) lines.push(`    quality_score: ${a.quality_score}`);
  }
  return lines.join('\n');
}

/**
 * Export artifacts in the specified format.
 * @param {object} db
 * @param {string} format
 * @param {object} [options]
 * @returns {Promise<{ content: string, format: string, count: number }>}
 */
export async function exportArtifacts(db, format, options = {}) {
  if (!SUPPORTED_FORMATS.includes(format)) {
    throw new Error(`Unsupported format: ${format}. Supported: ${SUPPORTED_FORMATS.join(', ')}`);
  }

  const limit = options.limit || 1000;
  const category = options.category;

  let query = `SELECT id, name, description, primary_category, artifact_type,
                      source_url, quality_score, created_at, updated_at
               FROM artifacts WHERE (archived IS NULL OR archived = false)`;
  const params = [];
  if (category) {
    params.push(category);
    query += ` AND primary_category = $${params.length}`;
  }
  params.push(limit);
  query += ` ORDER BY quality_score DESC NULLS LAST LIMIT $${params.length}`;

  const result = await db.query(query, params);
  const artifacts = result.rows;

  let content;
  switch (format) {
    case 'json': content = formatJson(artifacts); break;
    case 'csv': content = formatCsv(artifacts); break;
    case 'markdown': content = formatMarkdown(artifacts); break;
    case 'yaml': content = formatYaml(artifacts); break;
  }

  return { content, format, count: artifacts.length };
}

export { SUPPORTED_FORMATS, CSV_HEADERS };
