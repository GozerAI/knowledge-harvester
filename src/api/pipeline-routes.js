// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Pipeline run/status route handlers.
 *
 * Keeps a lightweight in-process status object for live polling, but mirrors
 * accepted runs into system_runs so recent pipeline history survives restarts.
 */

import { randomUUID } from 'node:crypto';
import { db } from '../db/client.js';
import { createSystemRunSafely, updateSystemRunSafely, listSystemRuns } from '../db/system-run-store.js';
import { logOperationSafely } from '../db/operation-log-store.js';
import { getEventBus } from '../processing/event-bus.js';
import { json } from './middleware.js';

const VALID_STEPS = new Set(['classify', 'score', 'embed', 'package', 'index']);
const DEFAULT_STEPS = ['classify', 'score', 'embed'];

export const pipelineState = {
  running: false,
  runId: null,
  currentStep: null,
  stepsCompleted: [],
  startedAt: null,
  completedAt: null,
  error: null,
};

async function defaultRunStep(stepName) {
  pipelineState.currentStep = stepName;
  await new Promise(resolve => setImmediate(resolve));
  pipelineState.stepsCompleted.push(stepName);
}

async function readOptionalJsonBody(req) {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString().trim();
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function parseSteps(body) {
  if (!body || !Array.isArray(body.steps) || body.steps.length === 0) {
    return DEFAULT_STEPS;
  }

  const filtered = body.steps.filter(step => VALID_STEPS.has(step));
  return filtered.length > 0 ? filtered : DEFAULT_STEPS;
}

function resetPipelineState(runId) {
  pipelineState.running = true;
  pipelineState.runId = runId;
  pipelineState.currentStep = null;
  pipelineState.stepsCompleted = [];
  pipelineState.startedAt = new Date().toISOString();
  pipelineState.completedAt = null;
  pipelineState.error = null;
}

function finalizePipelineState({ error = null } = {}) {
  pipelineState.running = false;
  pipelineState.currentStep = null;
  pipelineState.completedAt = new Date().toISOString();
  pipelineState.error = error;
}

export function createPipelineHandlers({
  database = db,
  eventBus = getEventBus(),
  runStepImpl = defaultRunStep,
  createRun = createSystemRunSafely,
  updateRun = updateSystemRunSafely,
  listRuns = listSystemRuns,
  logOperation = logOperationSafely,
} = {}) {
  return {
    async handlePipelineRun(req, res) {
      if (pipelineState.running) {
        return json(res, 409, {
          error: 'Pipeline already running',
          currentStep: pipelineState.currentStep,
          startedAt: pipelineState.startedAt,
          run_id: pipelineState.runId,
        });
      }

      const body = await readOptionalJsonBody(req);
      const steps = parseSteps(body);
      const runId = randomUUID();
      resetPipelineState(runId);

      await createRun({
        id: runId,
        runType: 'pipeline',
        command: 'api.pipeline',
        trigger: 'api',
        status: 'running',
        stepsRequested: steps,
        stepsCompleted: [],
        metadata: { steps_requested: steps },
      }, { database });

      eventBus.emit('pipeline.run.start', {
        run_id: runId,
        steps,
        trigger: 'api',
      });
      await logOperation({
        level: 'info',
        category: 'pipeline',
        eventType: 'pipeline.run.started',
        message: 'Pipeline started',
        command: 'api.pipeline',
        systemRunId: runId,
        metadata: { steps_requested: steps, trigger: 'api' },
      }, { database });

      json(res, 202, {
        message: 'Pipeline started',
        steps,
        startedAt: pipelineState.startedAt,
        run_id: runId,
      });

      (async () => {
        try {
          for (const step of steps) {
            pipelineState.currentStep = step;
            await updateRun(runId, {
              currentStep: step,
              stepsCompleted: pipelineState.stepsCompleted,
            }, { database });

            eventBus.emit('pipeline.step.start', { run_id: runId, step });
            await logOperation({
              level: 'info',
              category: 'pipeline',
              eventType: 'pipeline.step.started',
              message: `Pipeline step started: ${step}`,
              command: 'api.pipeline',
              systemRunId: runId,
              metadata: {
                step,
                steps_completed: pipelineState.stepsCompleted,
              },
            }, { database });
            await runStepImpl(step, { runId, state: pipelineState });

            await updateRun(runId, {
              currentStep: pipelineState.currentStep,
              stepsCompleted: pipelineState.stepsCompleted,
            }, { database });
            eventBus.emit('pipeline.step.complete', { run_id: runId, step });
            await logOperation({
              level: 'info',
              category: 'pipeline',
              eventType: 'pipeline.step.completed',
              message: `Pipeline step completed: ${step}`,
              command: 'api.pipeline',
              systemRunId: runId,
              metadata: {
                step,
                steps_completed: pipelineState.stepsCompleted,
              },
            }, { database });
          }

          finalizePipelineState();
          await updateRun(runId, {
            status: 'completed',
            currentStep: null,
            stepsCompleted: pipelineState.stepsCompleted,
            completedAt: 'now',
            metadata: {
              steps_requested: steps,
              steps_completed: pipelineState.stepsCompleted,
              trigger: 'api',
            },
          }, { database });
          eventBus.emit('pipeline.run.complete', {
            run_id: runId,
            steps_completed: pipelineState.stepsCompleted,
          });
          await logOperation({
            level: 'info',
            category: 'pipeline',
            eventType: 'pipeline.run.completed',
            message: 'Pipeline completed',
            command: 'api.pipeline',
            systemRunId: runId,
            metadata: { steps_completed: pipelineState.stepsCompleted },
          }, { database });
        } catch (err) {
          pipelineState.error = err.message;
          finalizePipelineState({ error: err.message });
          await updateRun(runId, {
            status: 'failed',
            currentStep: pipelineState.currentStep,
            stepsCompleted: pipelineState.stepsCompleted,
            errorMessage: err.message,
            completedAt: 'now',
            metadata: {
              steps_requested: steps,
              steps_completed: pipelineState.stepsCompleted,
              trigger: 'api',
            },
          }, { database });
          eventBus.emit('pipeline.step.error', {
            run_id: runId,
            step: pipelineState.currentStep,
            error: err.message,
          });
          await logOperation({
            level: 'error',
            category: 'pipeline',
            eventType: 'pipeline.step.failed',
            message: `Pipeline step failed: ${pipelineState.currentStep || 'unknown'}`,
            command: 'api.pipeline',
            systemRunId: runId,
            error: err,
            metadata: {
              step: pipelineState.currentStep,
              steps_completed: pipelineState.stepsCompleted,
            },
          }, { database });
          await logOperation({
            level: 'error',
            category: 'pipeline',
            eventType: 'pipeline.run.failed',
            message: 'Pipeline failed',
            command: 'api.pipeline',
            systemRunId: runId,
            error: err,
            metadata: {
              current_step: pipelineState.currentStep,
              steps_completed: pipelineState.stepsCompleted,
            },
          }, { database });
        }
      })();
    },

    async handlePipelineStatus(_req, res) {
      if (!pipelineState.running && pipelineState.runId === null) {
        try {
          const recent = await listRuns(database, { runType: 'pipeline', limit: 1 });
          const latest = recent.runs[0];
          if (latest) {
            return json(res, 200, {
              running: false,
              run_id: latest.id,
              current_step: latest.current_step,
              steps_completed: latest.steps_completed || [],
              started_at: latest.started_at,
              completed_at: latest.completed_at,
              error: latest.error_message || null,
            });
          }
        } catch {
          // best-effort fallback only
        }
      }

      json(res, 200, {
        running: pipelineState.running,
        run_id: pipelineState.runId,
        current_step: pipelineState.currentStep,
        steps_completed: pipelineState.stepsCompleted,
        started_at: pipelineState.startedAt,
        completed_at: pipelineState.completedAt,
        error: pipelineState.error,
      });
    },
  };
}

const handlers = createPipelineHandlers();

export const handlePipelineRun = handlers.handlePipelineRun;
export const handlePipelineStatus = handlers.handlePipelineStatus;
export { parseSteps, defaultRunStep };
