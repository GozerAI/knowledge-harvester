// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Reimplemented pure logic from guide-generator.js ──

function countWords(text) {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

function countSections(text) {
  const matches = text.match(/^##\s+/gm);
  return matches ? matches.length : 0;
}

function validateGuide(guide, toolType) {
  if (!guide || typeof guide !== 'string') {
    return { valid: false, score: 0, reason: 'Empty guide' };
  }

  const words = countWords(guide);
  if (words < 100) {
    return { valid: false, score: 0, reason: `Too short: ${words} words (min 100)` };
  }

  const requiredSections = [
    'Overview', 'Prerequisites', 'Install', 'Credential', 'Import', 'Configure', 'Test', 'Troubleshoot'
  ];
  const foundSections = [];
  for (const section of requiredSections) {
    if (guide.toLowerCase().includes(section.toLowerCase())) {
      foundSections.push(section);
    }
  }

  if (foundSections.length < 5) {
    return {
      valid: false,
      score: 0,
      reason: `Missing sections: only found ${foundSections.length}/8`,
    };
  }

  const toolTerms = {
    n8n: ['n8n', 'node', 'workflow'],
    comfyui: ['comfyui', 'node', 'class_type'],
    airflow: ['airflow', 'dag', 'operator'],
    luigi: ['luigi', 'task', 'require'],
  };

  const terms = toolTerms[toolType] || [];
  const guideLower = guide.toLowerCase();
  const matchedTerms = terms.filter(t => guideLower.includes(t));

  if (terms.length > 0 && matchedTerms.length === 0) {
    return { valid: false, score: 0, reason: `No tool-specific terminology for ${toolType}` };
  }

  let score = 0;
  score += Math.min(words / 10, 30);
  score += foundSections.length * 5;
  score += matchedTerms.length * 10;
  score = Math.min(Math.round(score), 100);

  return { valid: true, score };
}


describe('countWords', () => {
  it('counts words correctly', () => {
    assert.equal(countWords('hello world foo bar'), 4);
  });

  it('handles extra whitespace', () => {
    assert.equal(countWords('  hello   world  '), 2);
  });

  it('handles empty string', () => {
    assert.equal(countWords(''), 0);
  });

  it('handles newlines and tabs', () => {
    assert.equal(countWords('hello\nworld\tfoo'), 3);
  });
});


describe('countSections', () => {
  it('counts ## headings', () => {
    const md = '## Overview\ntext\n## Prerequisites\ntext\n## Install\ntext';
    assert.equal(countSections(md), 3);
  });

  it('ignores # and ### headings', () => {
    const md = '# Title\n## Section\n### Subsection';
    assert.equal(countSections(md), 1);
  });

  it('returns 0 for no headings', () => {
    assert.equal(countSections('just plain text'), 0);
  });
});


describe('validateGuide', () => {
  const makeGuide = (words, sections, toolTerms) => {
    let guide = '';
    for (const s of sections) {
      guide += `## ${s}\n`;
    }
    // Add tool-specific terms
    for (const term of toolTerms) {
      guide += `${term} `;
    }
    // Pad to desired word count
    const current = countWords(guide);
    if (current < words) {
      guide += ' filler'.repeat(words - current);
    }
    return guide;
  };

  it('rejects null guide', () => {
    const result = validateGuide(null, 'n8n');
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'Empty guide');
  });

  it('rejects short guide', () => {
    const result = validateGuide('Too short.', 'n8n');
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes('Too short'));
  });

  it('rejects guide with too few sections', () => {
    const guide = makeGuide(200, ['Overview', 'Install'], ['n8n', 'node']);
    const result = validateGuide(guide, 'n8n');
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes('Missing sections'));
  });

  it('rejects guide without tool terminology', () => {
    const guide = makeGuide(200, [
      'Overview', 'Prerequisites', 'Install Dependencies',
      'Configure Credentials', 'Import', 'Configure Settings',
      'Test', 'Troubleshooting',
    ], []);
    const result = validateGuide(guide, 'comfyui');
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes('No tool-specific terminology'));
  });

  it('accepts valid n8n guide', () => {
    const guide = makeGuide(300, [
      'Overview', 'Prerequisites', 'Install Dependencies',
      'Configure Credentials', 'Import the Workflow',
      'Configure Settings', 'Test the Workflow', 'Troubleshooting',
    ], ['n8n', 'node', 'workflow']);
    const result = validateGuide(guide, 'n8n');
    assert.equal(result.valid, true);
    assert.ok(result.score > 0);
  });

  it('accepts guide for unknown tool type', () => {
    const guide = makeGuide(200, [
      'Overview', 'Prerequisites', 'Install Dependencies',
      'Configure Credentials', 'Import',
      'Configure', 'Test', 'Troubleshoot',
    ], []);
    const result = validateGuide(guide, 'unknown-tool');
    assert.equal(result.valid, true);
  });

  it('calculates quality score', () => {
    const guide = makeGuide(500, [
      'Overview', 'Prerequisites', 'Install Dependencies',
      'Configure Credentials', 'Import the Workflow',
      'Configure Settings', 'Test the Workflow', 'Troubleshooting',
    ], ['airflow', 'dag', 'operator']);
    const result = validateGuide(guide, 'airflow');
    assert.equal(result.valid, true);
    assert.ok(result.score >= 50);
    assert.ok(result.score <= 100);
  });
});
