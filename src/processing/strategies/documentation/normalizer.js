// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { randomUUID } from 'node:crypto';
import { generateContentHash } from '../../../utils/hash.js';
import { extractNameFromPath } from '../../../utils/helpers.js';

/**
 * Normalize raw documentation data into the unified artifact schema.
 *
 * Handles: ADRs, runbooks, SOPs, policies, checklists, PRDs, support docs,
 * legal docs, finance docs, people docs, enablement docs, READMEs,
 * technical guides, and architecture docs.
 */
export function normalizeDocumentation(source, rawData) {
  const { searchResult, content, filename } = rawData;
  const docType = detectDocType(content, filename);
  const components = extractDocComponents(content, docType);

  const name = searchResult?.repository?.full_name
    ? `${searchResult.repository.full_name}/${filename}`
    : extractNameFromPath(filename);
  const description = searchResult?.repository?.description || '';

  return {
    id: randomUUID(),
    hash: generateContentHash(content, 'documentation'),
    artifact_type: 'documentation',
    source,
    source_url: searchResult?.html_url || '',
    source_id: searchResult?.sha || searchResult?.html_url || randomUUID(),
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    content: { source_code: content, filename },
    name,
    description,
    author: {
      username: searchResult?.repository?.owner?.login || null,
      profile_url: searchResult?.repository?.owner?.html_url || null,
    },
    language: 'markdown',
    tool_type: docType,
    tool_metadata: { doc_type: docType },
    tags: [],
    type_metadata: { doc_type: docType, ...components },
    quality: {
      score: 0,
      has_description: description.length > 0,
      has_documentation: true,
      is_complete: components.word_count >= 100,
      validation_status: 'valid',
    },
  };
}

/**
 * Detect the documentation type.
 */
export function detectDocType(content, filename) {
  const name = (filename || '').toLowerCase();

  if (/adr[-_]?\d|architecture.decision/i.test(name)) return 'adr';
  if (/runbook/i.test(name)) return 'runbook';
  if (/sop|standard[-_ ]operating[-_ ]procedure/i.test(name)) return 'sop';
  if (/policy|policies|governance|control[-_ ]matrix/i.test(name)) return 'policy';
  if (/budget|forecast|close[-_ ]checklist|reconciliation|invoice|expense[-_ ]policy|finance[-_ ]control/i.test(name)) return 'finance-doc';
  if (/checklist|readiness|go-live|cutover/i.test(name)) return 'checklist';
  if (/prd|product[-_ ]requirements|requirements[-_ ]doc|spec/i.test(name)) return 'product-doc';
  if (/msa|mou|sow|dpa|nda|agreement|contract|terms[-_ ]of[-_ ]service|statement[-_ ]of[-_ ]work/i.test(name)) return 'legal-doc';
  if (/employee[-_ ]handbook|people[-_ ]ops|benefits|leave[-_ ]policy|compensation|career[-_ ]ladder|performance[-_ ]review/i.test(name)) return 'people-doc';
  if (/sales[-_ ]playbook|battlecard|enablement|training[-_ ]plan|certification|messaging[-_ ]guide/i.test(name)) return 'enablement-doc';
  if (/faq|knowledge[-_ ]base|kb[-_ ]|troubleshoot|playbook|support/i.test(name)) return 'support-doc';
  if (/readme/i.test(name)) return 'readme';
  if (/contributing/i.test(name)) return 'contributing';
  if (/changelog/i.test(name)) return 'changelog';
  if (/tutorial|guide|getting.started/i.test(name)) return 'tutorial';
  if (/api[-_]?doc|api[-_]?reference/i.test(name)) return 'api-reference';
  if (/architecture|design[-_]?doc/i.test(name)) return 'architecture';
  if (/incident|postmortem|post.mortem/i.test(name)) return 'postmortem';
  if (/rfc/i.test(name)) return 'rfc';

  // Content-based detection
  if (/^#\s+ADR\b|^##\s+Status\b.*\n.*^##\s+Context/ms.test(content)) return 'adr';
  if (/\bRunbook\b.*\b(Steps|Procedure|Remediation)\b/si.test(content)) return 'runbook';
  if (/\b(Standard Operating Procedure|SOP)\b|\bPurpose\b.*\bScope\b.*\bProcedure\b/si.test(content)) return 'sop';
  if (/\bPolicy\b.*\bPurpose\b|\bControl Objective\b|\bApplies To\b/si.test(content)) return 'policy';
  if (/\b(Budget|Forecast|Monthly Close|Reconciliation|Expense Policy|Invoice Approval|Cash Flow)\b|\bCost Center\b|\bGeneral Ledger\b/si.test(content)) return 'finance-doc';
  if (/\bChecklist\b|\bPre[- ]flight\b|\bReadiness\b|\bGo[- ]Live\b/si.test(content)) return 'checklist';
  if (/\bProduct Requirements\b|\bUser Story\b|\bAcceptance Criteria\b|\bProblem Statement\b/si.test(content)) return 'product-doc';
  if (/\b(Master Service Agreement|Statement of Work|Data Processing Agreement|Non-Disclosure Agreement|Service Level Agreement)\b|\bGoverning Law\b|\bTermination\b.*\bLiability\b/si.test(content)) return 'legal-doc';
  if (/\b(Employee Handbook|Benefits|Paid Time Off|Leave Policy|Manager Expectations|Career Ladder|Performance Review)\b/si.test(content)) return 'people-doc';
  if (/\b(Sales Enablement|Battlecard|Training Curriculum|Certification|Talk Track|Objection Handling|Discovery Questions)\b/si.test(content)) return 'enablement-doc';
  if (/\bFAQ\b|\bTroubleshooting\b|\bKnown Issues\b|\bEscalation\b|\bCustomer Impact\b/si.test(content)) return 'support-doc';
  if (/^#\s+.*\n+.*\binstall/mi.test(content)) return 'readme';
  if (/\bIncident\b.*\b(Impact|Timeline|Root Cause)\b/si.test(content)) return 'postmortem';

  return 'technical-doc';
}

/**
 * Extract documentation components.
 */
export function extractDocComponents(content, docType) {
  const lines = content.split('\n');
  const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;

  // Extract headings
  const headings = [];
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+)/);
    if (heading) {
      headings.push({
        level: heading[1].length,
        text: heading[2].trim(),
      });
    }
  }

  // Section count (level 2 headings)
  const sectionCount = headings.filter(h => h.level === 2).length;

  // Code blocks
  const codeBlocks = (content.match(/```[\s\S]*?```/g) || []).length;
  const codeLanguages = [...new Set(
    (content.match(/```(\w+)/g) || [])
      .map(m => m.replace('```', ''))
      .filter(Boolean)
  )];

  // Links
  const links = (content.match(/\[([^\]]+)\]\(([^)]+)\)/g) || []).length;
  const externalLinks = (content.match(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g) || []).length;

  // Images
  const images = (content.match(/!\[([^\]]*)\]\(([^)]+)\)/g) || []).length;

  // Tables
  const tables = (content.match(/\|.*\|.*\|/g) || []).length > 2;

  // Lists
  const bulletLists = (content.match(/^\s*[-*]\s+/gm) || []).length;
  const numberedLists = (content.match(/^\s*\d+\.\s+/gm) || []).length;

  // Front matter / metadata
  const hasFrontMatter = /^---\s*\n[\s\S]*?\n---/m.test(content);
  const hasChecklistSignals = /\[[ xX]\]/.test(content) || /\bchecklist\b/i.test(content);
  const hasOwnershipSignals = /\bowner|approver|reviewer|stakeholder\b/i.test(content);
  const hasSeveritySignals = /\bseverity|impact|priority|risk\b/i.test(content);
  const hasAcceptanceCriteria = /\bacceptance criteria\b/i.test(content);

  // ADR-specific
  const adrStatus = content.match(/##\s+Status\s*\n+\s*(\w+)/i)?.[1] || null;
  const adrDate = content.match(/(?:Date|Created):\s*(\d{4}-\d{2}-\d{2})/)?.[1] || null;

  return {
    word_count: wordCount,
    line_count: lines.length,
    headings: headings.slice(0, 30),
    heading_count: headings.length,
    section_count: sectionCount,
    code_block_count: codeBlocks,
    code_languages: codeLanguages,
    link_count: links,
    external_link_count: externalLinks,
    image_count: images,
    has_tables: tables,
    bullet_list_count: bulletLists,
    numbered_list_count: numberedLists,
    has_front_matter: hasFrontMatter,
    has_toc: /table\s+of\s+contents|toc/i.test(content),
    has_checklist_signals: hasChecklistSignals,
    has_ownership_signals: hasOwnershipSignals,
    has_severity_signals: hasSeveritySignals,
    has_acceptance_criteria: hasAcceptanceCriteria,
    reading_time_minutes: Math.ceil(wordCount / 200),
    // ADR-specific
    adr_status: adrStatus,
    adr_date: adrDate,
  };
}
