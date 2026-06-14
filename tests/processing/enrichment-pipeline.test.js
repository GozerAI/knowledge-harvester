// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EnrichmentPipeline } from '../../src/processing/worker-pool.js';

describe('EnrichmentPipeline', () => {
  it('runs stages in parallel', async () => {
    const p = new EnrichmentPipeline({ concurrency: 3 });
    p.addStage('score', async (art) => ({ score: art.quality * 2 }));
    p.addStage('classify', async () => ({ category: 'workflow' }));
    const { enrichments, errors } = await p.enrich({ quality: 5 });
    assert.equal(enrichments.score.score, 10);
    assert.equal(enrichments.classify.category, 'workflow');
    assert.equal(errors.length, 0);
  });

  it('captures stage errors', async () => {
    const p = new EnrichmentPipeline();
    p.addStage('good', async () => ({ ok: true }));
    p.addStage('bad', async () => { throw new Error('stage fail'); });
    const { enrichments, errors } = await p.enrich({});
    assert.ok(enrichments.good);
    assert.ok(!enrichments.bad);
    assert.equal(errors.length, 1);
  });

  it('respects timeout', async () => {
    const p = new EnrichmentPipeline({ timeoutMs: 50 });
    p.addStage('slow', async () => new Promise(r => setTimeout(r, 5000)));
    const { errors } = await p.enrich({});
    assert.ok(errors.length > 0);
  });

  it('records timing per stage', async () => {
    const p = new EnrichmentPipeline();
    p.addStage('fast', async () => ({ ok: true }));
    const { timing } = await p.enrich({});
    assert.ok(typeof timing.fast === 'number');
  });

  it('enrichBatch processes multiple artifacts', async () => {
    const p = new EnrichmentPipeline();
    p.addStage('tag', async (art) => ({ tag: art.id }));
    const results = await p.enrichBatch([{ id: 'a' }, { id: 'b' }]);
    assert.equal(results.length, 2);
  });

  it('respects priority ordering', () => {
    const p = new EnrichmentPipeline();
    p.addStage('low', async () => {}, { priority: 1 });
    p.addStage('high', async () => {}, { priority: 10 });
    p.addStage('mid', async () => {}, { priority: 5 });
    assert.deepEqual(p.getStageNames(), ['high', 'mid', 'low']);
  });

  it('stageCount reflects added stages', () => {
    const p = new EnrichmentPipeline();
    assert.equal(p.stageCount, 0);
    p.addStage('a', async () => {});
    assert.equal(p.stageCount, 1);
  });
});
