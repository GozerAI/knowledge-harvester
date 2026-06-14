// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Re-implement pure extractors ──

function detectDocType(content, filename) {
  const name = (filename || '').toLowerCase();
  if (/adr[-_]?\d|architecture.decision/i.test(name)) return 'adr';
  if (/runbook/i.test(name)) return 'runbook';
  if (/readme/i.test(name)) return 'readme';
  if (/contributing/i.test(name)) return 'contributing';
  if (/changelog/i.test(name)) return 'changelog';
  if (/tutorial|guide|getting.started/i.test(name)) return 'tutorial';
  if (/api[-_]?doc|api[-_]?reference/i.test(name)) return 'api-reference';
  if (/architecture|design[-_]?doc/i.test(name)) return 'architecture';
  if (/incident|postmortem|post.mortem/i.test(name)) return 'postmortem';
  if (/rfc/i.test(name)) return 'rfc';
  if (/^#\s+ADR\b|^##\s+Status\b.*\n.*^##\s+Context/ms.test(content)) return 'adr';
  if (/\bRunbook\b.*\b(Steps|Procedure|Remediation)\b/si.test(content)) return 'runbook';
  return 'technical-doc';
}

function extractDocComponents(content) {
  const lines = content.split('\n');
  const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
  const headings = [];
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+)/);
    if (heading) headings.push({ level: heading[1].length, text: heading[2].trim() });
  }
  const sectionCount = headings.filter(h => h.level === 2).length;
  const codeBlocks = (content.match(/```[\s\S]*?```/g) || []).length;
  const codeLanguages = [...new Set(
    (content.match(/```(\w+)/g) || []).map(m => m.replace('```', '')).filter(Boolean)
  )];
  const links = (content.match(/\[([^\]]+)\]\(([^)]+)\)/g) || []).length;
  const externalLinks = (content.match(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g) || []).length;
  const images = (content.match(/!\[([^\]]*)\]\(([^)]+)\)/g) || []).length;
  const tables = (content.match(/\|.*\|.*\|/g) || []).length > 2;
  const bulletLists = (content.match(/^\s*[-*]\s+/gm) || []).length;
  const numberedLists = (content.match(/^\s*\d+\.\s+/gm) || []).length;
  const hasFrontMatter = /^---\s*\n[\s\S]*?\n---/m.test(content);
  const hasToc = /table\s+of\s+contents|toc/i.test(content);
  const adrStatus = content.match(/##\s+Status\s*\n+\s*(\w+)/i)?.[1] || null;
  return {
    word_count: wordCount, line_count: lines.length, headings,
    heading_count: headings.length, section_count: sectionCount,
    code_block_count: codeBlocks, code_languages: codeLanguages,
    link_count: links, external_link_count: externalLinks,
    image_count: images, has_tables: tables,
    bullet_list_count: bulletLists, numbered_list_count: numberedLists,
    has_front_matter: hasFrontMatter, has_toc: hasToc,
    reading_time_minutes: Math.ceil(wordCount / 200),
    adr_status: adrStatus,
  };
}

function calculateDocScore(row, meta) {
  let score = 0;
  const wc = meta.word_count || 0;
  if (wc >= 100) score += 5;
  if (wc >= 300) score += 5;
  if (wc >= 500) score += 5;
  if (wc >= 1000) score += 5;
  const sc = meta.section_count || 0;
  if (sc >= 2) score += 5;
  if (sc >= 5) score += 5;
  if ((meta.heading_count || 0) >= 3) score += 5;
  if ((meta.bullet_list_count || 0) >= 3) score += 5;
  if ((meta.numbered_list_count || 0) >= 1) score += 5;
  if (meta.has_tables) score += 5;
  if ((meta.code_block_count || 0) >= 1) score += 5;
  if ((meta.link_count || 0) >= 2) score += 5;
  if ((meta.external_link_count || 0) >= 1) score += 5;
  if ((meta.image_count || 0) >= 1) score += 5;
  if ((meta.code_block_count || 0) >= 3) score += 5;
  if ((meta.code_languages || []).length >= 2) score += 5;
  if (row.name && !row.name.includes('Untitled')) score += 5;
  if (row.description?.length > 20) score += 5;
  if (meta.has_front_matter) score += 5;
  if (meta.has_toc) score += 5;
  return Math.min(score, 100);
}

function getDefaultDocCategory(meta) {
  const defaults = {
    'adr': 'adr', 'runbook': 'runbook', 'readme': 'readme',
    'tutorial': 'tutorial', 'contributing': 'contributing-guide',
    'changelog': 'changelog', 'postmortem': 'postmortem',
    'rfc': 'rfc', 'api-reference': 'api-reference', 'architecture': 'architecture-doc',
  };
  return defaults[meta?.doc_type] || 'general-documentation';
}

// ── Tests ──

describe('detectDocType', () => {
  it('detects ADR from filename', () => {
    assert.equal(detectDocType('# ADR 1', 'adr-001.md'), 'adr');
    assert.equal(detectDocType('', 'adr_1.md'), 'adr');
  });

  it('detects runbook from filename', () => {
    assert.equal(detectDocType('', 'db-runbook.md'), 'runbook');
  });

  it('detects README', () => {
    assert.equal(detectDocType('', 'README.md'), 'readme');
  });

  it('detects contributing guide', () => {
    assert.equal(detectDocType('', 'CONTRIBUTING.md'), 'contributing');
  });

  it('detects changelog', () => {
    assert.equal(detectDocType('', 'CHANGELOG.md'), 'changelog');
  });

  it('detects tutorial', () => {
    assert.equal(detectDocType('', 'getting-started.md'), 'tutorial');
    assert.equal(detectDocType('', 'tutorial.md'), 'tutorial');
  });

  it('detects postmortem', () => {
    assert.equal(detectDocType('', 'incident-2024-01.md'), 'postmortem');
    assert.equal(detectDocType('', 'postmortem.md'), 'postmortem');
  });

  it('detects RFC', () => {
    assert.equal(detectDocType('', 'rfc-001.md'), 'rfc');
  });

  it('detects architecture doc', () => {
    assert.equal(detectDocType('', 'architecture.md'), 'architecture');
    assert.equal(detectDocType('', 'design-doc.md'), 'architecture');
  });

  it('returns technical-doc for unknown', () => {
    assert.equal(detectDocType('some text', 'notes.md'), 'technical-doc');
  });
});

describe('extractDocComponents', () => {
  it('extracts comprehensive doc metrics', () => {
    const content = `---
title: Getting Started
---

# My Project

## Table of Contents

## Installation

Install with npm:

\`\`\`bash
npm install my-project
\`\`\`

\`\`\`javascript
const app = require('my-project');
\`\`\`

## Configuration

- Option A: description
- Option B: description
- Option C: description

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| GET    | /api | List items  |

1. First step
2. Second step

[Documentation](https://example.com)
![Screenshot](./img/screen.png)
`;
    const result = extractDocComponents(content);
    assert.ok(result.word_count > 30);
    assert.equal(result.heading_count, 5);
    assert.equal(result.section_count, 4); // Table of Contents, Installation, Configuration, API Reference
    assert.equal(result.code_block_count, 2);
    assert.ok(result.code_languages.includes('bash'));
    assert.ok(result.code_languages.includes('javascript'));
    assert.ok(result.link_count >= 1);
    assert.ok(result.external_link_count >= 1);
    assert.equal(result.image_count, 1);
    assert.ok(result.has_tables);
    assert.ok(result.bullet_list_count >= 3);
    assert.ok(result.numbered_list_count >= 2);
    assert.ok(result.has_front_matter);
    assert.ok(result.has_toc);
  });

  it('extracts ADR status', () => {
    const content = `# ADR 001

## Status

Accepted

## Context

We need to decide...`;
    const result = extractDocComponents(content);
    assert.equal(result.adr_status, 'Accepted');
  });

  it('calculates reading time', () => {
    const words = Array(400).fill('word').join(' ');
    const result = extractDocComponents(words);
    assert.equal(result.reading_time_minutes, 2);
  });

  it('handles empty content', () => {
    const result = extractDocComponents('');
    assert.equal(result.word_count, 0);
    assert.equal(result.heading_count, 0);
  });
});

describe('calculateDocScore', () => {
  it('scores high for comprehensive documentation', () => {
    const row = { name: 'getting-started', description: 'Complete getting started guide with examples' };
    const meta = {
      word_count: 1500, section_count: 6, heading_count: 8,
      bullet_list_count: 10, numbered_list_count: 3,
      has_tables: true, code_block_count: 5, code_languages: ['python', 'bash'],
      link_count: 8, external_link_count: 3, image_count: 2,
      has_front_matter: true, has_toc: true,
    };
    const score = calculateDocScore(row, meta);
    assert.ok(score >= 85, `Expected >= 85, got ${score}`);
  });

  it('scores low for empty doc', () => {
    const row = { name: 'Untitled', description: '' };
    const meta = { word_count: 20, section_count: 0 };
    const score = calculateDocScore(row, meta);
    assert.ok(score < 10, `Expected < 10, got ${score}`);
  });

  it('gives structure bonus', () => {
    const row = { name: 'guide' };
    const structured = { heading_count: 5, bullet_list_count: 5, code_block_count: 2, word_count: 300 };
    const flat = { word_count: 300 };
    assert.ok(
      calculateDocScore(row, structured) > calculateDocScore(row, flat),
      'Structured docs should score higher'
    );
  });
});

describe('getDefaultDocCategory', () => {
  it('maps doc types to categories', () => {
    assert.equal(getDefaultDocCategory({ doc_type: 'adr' }), 'adr');
    assert.equal(getDefaultDocCategory({ doc_type: 'runbook' }), 'runbook');
    assert.equal(getDefaultDocCategory({ doc_type: 'readme' }), 'readme');
    assert.equal(getDefaultDocCategory({ doc_type: 'tutorial' }), 'tutorial');
    assert.equal(getDefaultDocCategory({ doc_type: 'postmortem' }), 'postmortem');
  });

  it('defaults to general-documentation', () => {
    assert.equal(getDefaultDocCategory({}), 'general-documentation');
  });
});
