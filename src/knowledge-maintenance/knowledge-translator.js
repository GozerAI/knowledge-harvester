// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #885 — Autonomous Knowledge Translation
 *
 * Translates knowledge artifacts between formats, schemas, and
 * abstraction levels (e.g., workflow -> documentation, config -> guide).
 */

const TRANSLATION_TYPES = {
  'workflow_to_doc': { from: 'workflow', to: 'documentation' },
  'config_to_guide': { from: 'infra_config', to: 'documentation' },
  'code_to_api': { from: 'code_pattern', to: 'api_spec' },
  'any_to_summary': { from: '*', to: 'summary' },
};

/**
 * Translate artifacts between formats/types.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ translated: number, translations: object[], summary: object }>}
 */
export async function translateKnowledge(db, options = {}) {
  const translationType = options.type || 'any_to_summary';
  const limit = options.limit || 50;

  const spec = TRANSLATION_TYPES[translationType];
  if (!spec) {
    return { translated: 0, translations: [], summary: { error: `Unknown translation type: ${translationType}` } };
  }

  const whereType = spec.from === '*' ? '' : `AND artifact_type = '${spec.from}'`;
  const result = await db.query(
    `SELECT id, name, description, artifact_type, primary_category,
            tags, type_metadata, source_url
     FROM artifacts
     WHERE description IS NOT NULL ${whereType}
     ORDER BY quality_score DESC NULLS LAST
     LIMIT $1`,
    [limit]
  );

  const translations = [];
  for (const artifact of result.rows) {
    const translation = performTranslation(artifact, translationType);
    if (translation) {
      translations.push({
        source_id: artifact.id,
        source_type: artifact.artifact_type,
        target_type: spec.to,
        content: translation,
      });
    }
  }

  return {
    translated: translations.length,
    translations,
    summary: {
      type: translationType,
      source_count: result.rows.length,
      translated: translations.length,
      translated_at: new Date().toISOString(),
    },
  };
}

function performTranslation(artifact, type) {
  switch (type) {
    case 'workflow_to_doc':
      return translateWorkflowToDoc(artifact);
    case 'config_to_guide':
      return translateConfigToGuide(artifact);
    case 'code_to_api':
      return translateCodeToApi(artifact);
    case 'any_to_summary':
      return translateToSummary(artifact);
    default:
      return null;
  }
}

function translateWorkflowToDoc(artifact) {
  const meta = parseMeta(artifact.type_metadata);
  const lines = [
    `# ${artifact.name}`,
    '',
    `## Overview`,
    artifact.description || 'No description available.',
    '',
    `## Details`,
    `- **Category:** ${artifact.primary_category || 'Uncategorized'}`,
    `- **Source:** ${artifact.source_url || 'N/A'}`,
  ];

  if (meta.node_count) lines.push(`- **Nodes:** ${meta.node_count}`);
  if (meta.triggers) lines.push(`- **Triggers:** ${JSON.stringify(meta.triggers)}`);

  const tags = Array.isArray(artifact.tags) ? artifact.tags : [];
  if (tags.length > 0) {
    lines.push(`- **Tags:** ${tags.join(', ')}`);
  }

  return lines.join('\n');
}

function translateConfigToGuide(artifact) {
  const meta = parseMeta(artifact.type_metadata);
  return [
    `# Setup Guide: ${artifact.name}`,
    '',
    `## Description`,
    artifact.description || 'Configuration artifact.',
    '',
    `## Prerequisites`,
    `- Ensure you have the required tools installed`,
    meta.language ? `- Language: ${meta.language}` : '',
    '',
    `## Configuration`,
    `Source: ${artifact.source_url || 'N/A'}`,
    '',
    `## Notes`,
    `Quality score: ${artifact.quality_score || 'unscored'}`,
  ].filter(Boolean).join('\n');
}

function translateCodeToApi(artifact) {
  return JSON.stringify({
    name: artifact.name,
    description: artifact.description,
    type: 'code_pattern_api',
    source: artifact.source_url,
    category: artifact.primary_category,
  }, null, 2);
}

function translateToSummary(artifact) {
  const desc = artifact.description || '';
  const firstSentence = desc.split(/[.!?]/).filter(s => s.trim().length > 5)[0] || artifact.name;
  return `${artifact.name}: ${firstSentence.trim()}.`.slice(0, 300);
}

function parseMeta(meta) {
  if (!meta) return {};
  if (typeof meta === 'string') { try { return JSON.parse(meta); } catch { return {}; } }
  return meta;
}

export { TRANSLATION_TYPES, translateWorkflowToDoc, translateConfigToGuide, translateToSummary };
