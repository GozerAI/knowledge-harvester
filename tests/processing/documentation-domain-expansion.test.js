// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectDocType,
  extractDocComponents,
} from '../../src/processing/strategies/documentation/normalizer.js';
import { getDefaultDocCategory } from '../../src/processing/strategies/documentation/classifier.js';

describe('documentation domain expansion', () => {
  it('detects adjacent-domain documentation types from filenames', () => {
    assert.equal(detectDocType('', 'security-policy.md'), 'policy');
    assert.equal(detectDocType('', 'go-live-checklist.md'), 'checklist');
    assert.equal(detectDocType('', 'product-requirements-doc.md'), 'product-doc');
    assert.equal(detectDocType('', 'master-service-agreement.md'), 'legal-doc');
    assert.equal(detectDocType('', 'monthly-close-checklist.md'), 'finance-doc');
    assert.equal(detectDocType('', 'employee-handbook.md'), 'people-doc');
    assert.equal(detectDocType('', 'sales-enablement-battlecard.md'), 'enablement-doc');
    assert.equal(detectDocType('', 'support-playbook.md'), 'support-doc');
    assert.equal(detectDocType('', 'standard-operating-procedure.md'), 'sop');
  });

  it('detects adjacent-domain documentation types from content', () => {
    const policy = '# Access Control Policy\n\n## Purpose\n\nProtect systems.\n\n## Scope\n\nAll staff.';
    const checklist = '# Release Checklist\n\n- [ ] staging verified\n- [ ] rollback tested';
    const prd = '# Product Requirements\n\n## Problem Statement\n\n...\n\n## Acceptance Criteria\n\n- must work';
    const legal = '# Master Service Agreement\n\n## Governing Law\n\nDelaware.\n\n## Termination\n\n...';
    const finance = '# Monthly Close Checklist\n\n## General Ledger\n\nReconcile all accounts.\n\n## Cost Center\n\nReview allocations.';
    const people = '# Employee Handbook\n\n## Benefits\n\n...\n\n## Paid Time Off\n\n...';
    const enablement = '# Sales Enablement Battlecard\n\n## Objection Handling\n\n...\n\n## Discovery Questions\n\n...';
    const support = '# Troubleshooting Guide\n\n## Known Issues\n\n...\n\n## Escalation\n\nPage ops.';

    assert.equal(detectDocType(policy, 'notes.md'), 'policy');
    assert.equal(detectDocType(checklist, 'notes.md'), 'checklist');
    assert.equal(detectDocType(prd, 'notes.md'), 'product-doc');
    assert.equal(detectDocType(legal, 'notes.md'), 'legal-doc');
    assert.equal(detectDocType(finance, 'notes.md'), 'finance-doc');
    assert.equal(detectDocType(people, 'notes.md'), 'people-doc');
    assert.equal(detectDocType(enablement, 'notes.md'), 'enablement-doc');
    assert.equal(detectDocType(support, 'notes.md'), 'support-doc');
  });

  it('extracts operational metadata signals for adjacent-domain docs', () => {
    const content = [
      '# Go-Live Checklist',
      '',
      'Owner: Release Manager',
      'Approver: VP Engineering',
      'Risk: Medium',
      '',
      '- [ ] staging complete',
      '- [ ] rollback validated',
      '',
      '## Acceptance Criteria',
      '',
      'All services healthy.',
    ].join('\n');

    const meta = extractDocComponents(content, 'checklist');
    assert.equal(meta.has_checklist_signals, true);
    assert.equal(meta.has_ownership_signals, true);
    assert.equal(meta.has_severity_signals, true);
    assert.equal(meta.has_acceptance_criteria, true);
  });

  it('maps new documentation types to stable default categories', () => {
    assert.equal(getDefaultDocCategory({ doc_type: 'policy' }), 'policy');
    assert.equal(getDefaultDocCategory({ doc_type: 'checklist' }), 'checklist');
    assert.equal(getDefaultDocCategory({ doc_type: 'product-doc' }), 'product-doc');
    assert.equal(getDefaultDocCategory({ doc_type: 'legal-doc' }), 'legal-doc');
    assert.equal(getDefaultDocCategory({ doc_type: 'finance-doc' }), 'finance-doc');
    assert.equal(getDefaultDocCategory({ doc_type: 'people-doc' }), 'people-doc');
    assert.equal(getDefaultDocCategory({ doc_type: 'enablement-doc' }), 'enablement-doc');
    assert.equal(getDefaultDocCategory({ doc_type: 'support-doc' }), 'support-doc');
    assert.equal(getDefaultDocCategory({ doc_type: 'sop' }), 'runbook');
  });
});
