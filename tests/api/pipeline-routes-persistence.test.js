// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createPipelineHandlers, pipelineState, parseSteps } from '../../src/api/pipeline-routes.js';

function createResponseRecorder() {
  const writes = [];
  return {
    writes,
    writeHead(status, headers) {
      writes.push({ status, headers });
    },
    end(body) {
      writes.push({ body: JSON.parse(body) });
    },
  };
}

async function waitFor(predicate, timeoutMs = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('timed out');
}

describe('pipeline-routes persistence', () => {
  afterEach(() => {
    pipelineState.running = false;
    pipelineState.runId = null;
    pipelineState.currentStep = null;
    pipelineState.stepsCompleted = [];
    pipelineState.startedAt = null;
    pipelineState.completedAt = null;
    pipelineState.error = null;
  });

  it('parseSteps keeps defaults for invalid requests', () => {
    assert.deepEqual(parseSteps({ steps: ['bad-step'] }), ['classify', 'score', 'embed']);
  });

  it('creates and updates a persistent pipeline run', async () => {
    const createdRuns = [];
    const updatedRuns = [];
    const emitted = [];
    const logged = [];
    const handlers = createPipelineHandlers({
      database: {},
      createRun: async (entry) => {
        createdRuns.push(entry);
        return { id: entry.id };
      },
      updateRun: async (runId, patch) => {
        updatedRuns.push({ runId, patch });
        return { id: runId, ...patch };
      },
      logOperation: async (entry) => {
        logged.push(entry);
        return null;
      },
      eventBus: {
        emit(type, payload) {
          emitted.push({ type, payload });
        },
      },
      runStepImpl: async (step, { state }) => {
        await new Promise(resolve => setImmediate(resolve));
        state.stepsCompleted.push(step);
      },
    });
    const req = {
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(JSON.stringify({ steps: ['classify', 'embed'] }));
      },
    };
    const res = createResponseRecorder();

    await handlers.handlePipelineRun(req, res);
    await waitFor(() => pipelineState.running === false);

    assert.equal(res.writes[0].status, 202);
    assert.equal(createdRuns.length, 1);
    assert.equal(createdRuns[0].runType, 'pipeline');
    assert.deepEqual(createdRuns[0].stepsRequested, ['classify', 'embed']);
    assert.ok(updatedRuns.some(entry => entry.patch.status === 'completed'));
    assert.ok(logged.some(entry => entry.eventType === 'pipeline.step.started'));
    assert.ok(logged.some(entry => entry.eventType === 'pipeline.step.completed'));
    assert.ok(emitted.some(event => event.type === 'pipeline.run.start'));
    assert.ok(emitted.some(event => event.type === 'pipeline.run.complete'));
  });

  it('falls back to the last persisted pipeline run when idle', async () => {
    const handlers = createPipelineHandlers({
      database: {},
      listRuns: async () => ({
        runs: [{
          id: '123e4567-e89b-12d3-a456-426614174000',
          current_step: null,
          steps_completed: ['classify', 'score'],
          started_at: '2026-03-13T10:00:00.000Z',
          completed_at: '2026-03-13T10:05:00.000Z',
          error_message: null,
        }],
      }),
    });
    const res = createResponseRecorder();

    await handlers.handlePipelineStatus({}, res);

    assert.equal(res.writes[0].status, 200);
    assert.equal(res.writes[1].body.run_id, '123e4567-e89b-12d3-a456-426614174000');
    assert.deepEqual(res.writes[1].body.steps_completed, ['classify', 'score']);
  });
});
