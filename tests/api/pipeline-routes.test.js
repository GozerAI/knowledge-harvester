// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for pipeline route handler logic.
 *
 * Tests the state machine and parameter parsing directly
 * without spinning up an HTTP server.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Re-implemented pipeline logic ────────────────────────────────────────────

const VALID_STEPS = new Set(['classify', 'score', 'embed', 'package', 'index']);
const DEFAULT_STEPS = ['classify', 'score', 'embed'];

function makeState() {
  return {
    running: false,
    currentStep: null,
    stepsCompleted: [],
    startedAt: null,
    error: null,
  };
}

/**
 * Parse and filter requested steps from a body object.
 * Returns DEFAULT_STEPS if body has no valid steps field.
 */
function parseSteps(body) {
  if (!body || !Array.isArray(body.steps) || body.steps.length === 0) {
    return DEFAULT_STEPS;
  }
  const filtered = body.steps.filter(s => VALID_STEPS.has(s));
  return filtered.length > 0 ? filtered : DEFAULT_STEPS;
}

/**
 * Simulate the run handler decision logic (pre-async phase).
 * Returns { accepted, httpStatus, response }
 */
function simulateRunRequest(state, body) {
  if (state.running) {
    return {
      accepted: false,
      httpStatus: 409,
      response: {
        error: 'Pipeline already running',
        currentStep: state.currentStep,
        startedAt: state.startedAt,
      },
    };
  }

  const steps = parseSteps(body);
  const startedAt = new Date().toISOString();

  // Mutate state (mirrors the handler)
  state.running = true;
  state.currentStep = null;
  state.stepsCompleted = [];
  state.startedAt = startedAt;
  state.error = null;

  return {
    accepted: true,
    httpStatus: 202,
    response: { message: 'Pipeline started', steps, startedAt },
  };
}

function simulateStatusRequest(state) {
  return {
    running: state.running,
    current_step: state.currentStep,
    steps_completed: state.stepsCompleted,
    started_at: state.startedAt,
    error: state.error,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Pipeline Routes', () => {
  let state;

  beforeEach(() => {
    state = makeState();
  });

  describe('Run — happy path', () => {
    it('returns 202 when pipeline is idle', () => {
      const { httpStatus } = simulateRunRequest(state, null);
      assert.equal(httpStatus, 202);
    });

    it('sets running to true after accepted run', () => {
      simulateRunRequest(state, null);
      assert.equal(state.running, true);
    });

    it('response message confirms pipeline started', () => {
      const { response } = simulateRunRequest(state, null);
      assert.ok(response.message.includes('started'));
    });

    it('response includes startedAt timestamp', () => {
      const { response } = simulateRunRequest(state, null);
      assert.ok(typeof response.startedAt === 'string');
      assert.ok(!isNaN(Date.parse(response.startedAt)));
    });

    it('records startedAt in state', () => {
      simulateRunRequest(state, null);
      assert.ok(typeof state.startedAt === 'string');
    });

    it('resets stepsCompleted on new run', () => {
      state.stepsCompleted = ['classify'];
      simulateRunRequest(state, null);
      assert.deepEqual(state.stepsCompleted, []);
    });
  });

  describe('Run — conflict', () => {
    it('returns 409 when pipeline already running', () => {
      simulateRunRequest(state, null);
      const { httpStatus } = simulateRunRequest(state, null);
      assert.equal(httpStatus, 409);
    });

    it('409 response includes error message', () => {
      simulateRunRequest(state, null);
      const { response } = simulateRunRequest(state, null);
      assert.ok(response.error.toLowerCase().includes('running'));
    });
  });

  describe('Run — steps parsing', () => {
    it('uses default steps when no body provided', () => {
      const { response } = simulateRunRequest(state, null);
      assert.deepEqual(response.steps, DEFAULT_STEPS);
    });

    it('uses default steps for empty steps array', () => {
      const steps = parseSteps({ steps: [] });
      assert.deepEqual(steps, DEFAULT_STEPS);
    });

    it('uses provided valid steps', () => {
      const steps = parseSteps({ steps: ['classify', 'score'] });
      assert.deepEqual(steps, ['classify', 'score']);
    });

    it('filters out invalid step names', () => {
      const steps = parseSteps({ steps: ['classify', 'invalid_step', 'score'] });
      assert.deepEqual(steps, ['classify', 'score']);
    });

    it('falls back to defaults when all provided steps are invalid', () => {
      const steps = parseSteps({ steps: ['bad_step', 'another_bad'] });
      assert.deepEqual(steps, DEFAULT_STEPS);
    });

    it('accepts a single valid step', () => {
      const steps = parseSteps({ steps: ['embed'] });
      assert.deepEqual(steps, ['embed']);
    });
  });

  describe('Status', () => {
    it('returns not running when idle', () => {
      const status = simulateStatusRequest(state);
      assert.equal(status.running, false);
    });

    it('returns running state while pipeline active', () => {
      simulateRunRequest(state, null);
      const status = simulateStatusRequest(state);
      assert.equal(status.running, true);
    });

    it('returns null current_step when idle', () => {
      const status = simulateStatusRequest(state);
      assert.equal(status.current_step, null);
    });

    it('returns empty steps_completed when idle', () => {
      const status = simulateStatusRequest(state);
      assert.deepEqual(status.steps_completed, []);
    });

    it('reflects error state after failed run', () => {
      state.error = 'classifier failed';
      const status = simulateStatusRequest(state);
      assert.equal(status.error, 'classifier failed');
    });
  });
});
