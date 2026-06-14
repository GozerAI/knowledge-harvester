// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Documentation Classifier — Classifies documentation artifacts via Ollama.
 */

import { db } from '../../../db/client.js';
import { config } from '../../../config.js';
import { logger } from '../../../utils/logger.js';

const DOC_CATEGORIES = [
  'tutorial',
  'api-reference',
  'architecture-doc',
  'runbook',
  'policy',
  'checklist',
  'product-doc',
  'legal-doc',
  'finance-doc',
  'people-doc',
  'enablement-doc',
  'support-doc',
  'adr',
  'readme',
  'contributing-guide',
  'changelog',
  'postmortem',
  'rfc',
  'troubleshooting',
  'general-documentation',
];

const PROMPT_TEMPLATE = `Classify this technical document into ONE primary category and up to 2 secondary categories.

CATEGORIES:
- tutorial: Step-by-step learning guides, getting started docs
- api-reference: API documentation, endpoint references, SDK docs
- architecture-doc: System design, architecture diagrams, design docs
- runbook: Operational procedures, incident response, maintenance guides
- policy: Governance, compliance, controls, standards, and policy documents
- checklist: Readiness, audit, launch, and operational checklist documents
- product-doc: Product requirements, specs, briefs, and planning docs
- legal-doc: Contracts, agreements, legal terms, and risk/legal process docs
- finance-doc: Budgeting, finance controls, closing, forecasting, and reconciliation docs
- people-doc: Employee handbooks, HR policies, career ladders, and people operations docs
- enablement-doc: Sales enablement, training, battlecards, and certification docs
- support-doc: Support playbooks, FAQs, troubleshooting, and escalation docs
- adr: Architecture Decision Records, design rationale
- readme: Project README files, overview documentation
- contributing-guide: Contribution guidelines, development setup
- changelog: Release notes, version histories
- postmortem: Incident reports, root cause analysis
- rfc: Request for Comments, proposals, design specs
- troubleshooting: FAQ, known issues, debugging guides
- general-documentation: Other technical documentation

DOC TYPE: {docType}
Name: {name}
Sections: {sections}
Word Count: {wordCount}

Respond in JSON format ONLY:
{
  "primary_category": "category-slug",
  "secondary_categories": ["category-slug"],
  "tags": ["relevant", "specific", "tags"]
}`;

export async function classifyDocumentation(limit = 50) {
  const result = await db.query(
    `SELECT id, name, description, tool_type, type_metadata
     FROM artifacts
     WHERE artifact_type = 'documentation' AND primary_category IS NULL
       AND publishing_status = 'raw'
     ORDER BY discovered_at DESC LIMIT $1`,
    [limit]
  );

  if (result.rows.length === 0) {
    logger.info('No documentation to classify');
    return { success: 0, failed: 0 };
  }

  logger.info(`Classifying ${result.rows.length} documentation artifacts`);
  let success = 0, failed = 0;

  for (const row of result.rows) {
    try {
      const classification = await classifySingle(row);
      if (classification) {
        await db.query(
          `UPDATE artifacts SET primary_category = $1, secondary_categories = $2,
            tags = $3, publishing_status = 'enriched', enriched_at = NOW()
          WHERE id = $4`,
          [classification.primary_category, classification.secondary_categories || [],
           classification.tags || [], row.id]
        );
        success++;
      } else { failed++; }
    } catch (err) {
      logger.error('Documentation classification failed', { id: row.id, error: err.message });
      failed++;
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  logger.info('Documentation classification complete', { success, failed });
  return { success, failed };
}

async function classifySingle(row) {
  const meta = typeof row.type_metadata === 'string'
    ? JSON.parse(row.type_metadata) : (row.type_metadata || {});

  const sections = (meta.headings || [])
    .filter(h => h.level <= 2)
    .map(h => h.text)
    .slice(0, 10)
    .join(', ');

  const prompt = PROMPT_TEMPLATE
    .replace('{docType}', meta.doc_type || row.tool_type || 'unknown')
    .replace('{name}', row.name || 'Untitled')
    .replace('{sections}', sections || 'none')
    .replace('{wordCount}', String(meta.word_count || 0));

  const response = await fetch(`${config.ollama.host}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollama.model, prompt, stream: false,
      options: { temperature: 0.1 }, format: 'json',
    }),
  });

  if (!response.ok) throw new Error(`Ollama ${response.status}`);
  const data = await response.json();
  try {
    const parsed = JSON.parse(data.response || '');
    if (!DOC_CATEGORIES.includes(parsed.primary_category)) {
      parsed.primary_category = getDefaultDocCategory(meta);
    }
    if (Array.isArray(parsed.secondary_categories)) {
      parsed.secondary_categories = parsed.secondary_categories
        .filter(c => DOC_CATEGORIES.includes(c));
    } else { parsed.secondary_categories = []; }
    if (!Array.isArray(parsed.tags)) parsed.tags = [];
    return parsed;
  } catch {
    return null;
  }
}

export function getDefaultDocCategory(meta) {
  const typeDefaults = {
    'adr': 'adr',
    'runbook': 'runbook',
    'sop': 'runbook',
    'policy': 'policy',
    'checklist': 'checklist',
    'product-doc': 'product-doc',
    'legal-doc': 'legal-doc',
    'finance-doc': 'finance-doc',
    'people-doc': 'people-doc',
    'enablement-doc': 'enablement-doc',
    'support-doc': 'support-doc',
    'readme': 'readme',
    'tutorial': 'tutorial',
    'contributing': 'contributing-guide',
    'changelog': 'changelog',
    'postmortem': 'postmortem',
    'rfc': 'rfc',
    'api-reference': 'api-reference',
    'architecture': 'architecture-doc',
  };
  return typeDefaults[meta?.doc_type] || 'general-documentation';
}
