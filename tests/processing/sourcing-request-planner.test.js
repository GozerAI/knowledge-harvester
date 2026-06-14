// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveSourcingKeywords,
  recommendSourcesForRequest,
  buildSourcingQualification,
} from '../../src/processing/sourcing-request-planner.js';

describe('sourcing-request-planner', () => {
  it('derives keywords from request fields', () => {
    const keywords = deriveSourcingKeywords({
      domain: 'Revenue',
      topic: 'Partner Expansion',
      objective: 'Find partner-led growth playbooks',
      researchQuestions: ['Which sales motions work best?'],
    });

    assert.ok(keywords.includes('revenue'));
    assert.ok(keywords.includes('partner'));
    assert.ok(keywords.includes('playbooks'));
  });

  it('recommends sources for a CRO revenue request', () => {
    const recommendation = recommendSourcesForRequest(
      {
        requesterRole: 'CRO',
        domain: 'revenue',
        preferredSources: ['sales-enablement'],
      },
      {
        availableSources: ['sales-playbooks', 'sales-enablement', 'customer-success-playbooks'],
      },
    );

    assert.ok(recommendation.supported.includes('sales-playbooks'));
    assert.ok(recommendation.supported.includes('sales-enablement'));
  });

  it('builds a qualification summary from current coverage', async () => {
    const database = {
      async query(sql) {
        if (sql.includes('COUNT(*)::int AS total')) return { rows: [{ total: 3 }] };
        if (sql.includes('GROUP BY artifact_type')) return { rows: [{ artifact_type: 'documentation', count: 3 }] };
        if (sql.includes('GROUP BY COALESCE(primary_category')) return { rows: [{ category: 'enablement-doc', count: 2 }] };
        return { rows: [{ source: 'sales-playbooks', count: 2 }] };
      },
    };

    const qualification = await buildSourcingQualification(database, {
      requesterRole: 'cmo',
      domain: 'marketing',
      topic: 'competitive messaging',
      objective: 'Research enablement assets for messaging refresh',
    }, {
      availableSources: ['sales-enablement', 'sales-playbooks', 'customer-success-playbooks'],
    });

    assert.equal(qualification.current_coverage.total_artifacts, 3);
    assert.equal(qualification.current_coverage.status, 'low');
    assert.ok(qualification.recommended_sources.includes('sales-enablement'));
    assert.ok(qualification.suggested_categories.includes('enablement-doc'));
  });
});
