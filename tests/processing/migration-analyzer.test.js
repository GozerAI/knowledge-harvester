// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Reimplemented from migration-analyzer.js

const TOOL_GROUPS = {
  'low-code-automation': ['n8n', 'activepieces', 'pipedream', 'node-red'],
  'data-pipeline': ['airflow', 'prefect', 'dagster', 'luigi', 'dbt'],
  'ai-agent': ['langchain', 'crewai', 'autogen', 'langgraph', 'dify', 'flowise'],
  'orchestration': ['temporal', 'windmill', 'argo'],
  'ci-cd': ['tekton', 'github-actions'],
  'iot': ['home-assistant'],
  'ml-ops': ['mlflow'],
  'bpm': ['camunda'],
  'messaging': ['kafka-connect', 'camel'],
  'image-gen': ['comfyui'],
};

const COMPLEXITY_RANK = {
  'n8n': 2, 'activepieces': 2, 'pipedream': 3, 'node-red': 3,
  'airflow': 5, 'prefect': 4, 'dagster': 5, 'luigi': 4, 'dbt': 3,
  'langchain': 5, 'crewai': 4, 'autogen': 5, 'langgraph': 5, 'dify': 3, 'flowise': 3,
  'temporal': 6, 'windmill': 4, 'argo': 5,
  'tekton': 4, 'github-actions': 3,
  'home-assistant': 2, 'mlflow': 4, 'camunda': 5,
  'kafka-connect': 4, 'camel': 5, 'comfyui': 3,
};

function getToolGroup(tool) {
  for (const [group, tools] of Object.entries(TOOL_GROUPS)) {
    if (tools.includes(tool)) return group;
  }
  return null;
}

function assessMigrationDifficulty(fromTool, toTool) {
  const fromGroup = getToolGroup(fromTool);
  const toGroup = getToolGroup(toTool);
  if (!fromGroup || !toGroup) return 'unknown';
  const fromRank = COMPLEXITY_RANK[fromTool] || 3;
  const toRank = COMPLEXITY_RANK[toTool] || 3;
  const diff = Math.abs(fromRank - toRank);
  if (fromGroup === toGroup) return 'easy';
  if (diff <= 1) return 'moderate';
  return 'hard';
}

function generateMigrationNotes(fromTool, toTool) {
  const difficulty = assessMigrationDifficulty(fromTool, toTool);
  const notes = [];
  notes.push(`Migration difficulty: ${difficulty}`);
  if (getToolGroup(fromTool) === getToolGroup(toTool)) {
    notes.push('Same tool group — concepts transfer directly.');
  } else {
    notes.push('Cross-group migration — architecture patterns differ.');
  }
  const fromRank = COMPLEXITY_RANK[fromTool] || 3;
  const toRank = COMPLEXITY_RANK[toTool] || 3;
  if (toRank > fromRank) {
    notes.push('Target tool is more complex — expect a learning curve.');
  } else if (toRank < fromRank) {
    notes.push('Target tool is simpler — some features may not translate.');
  }
  return notes;
}


describe('TOOL_GROUPS', () => {
  it('has expected group keys', () => {
    const expected = ['low-code-automation', 'data-pipeline', 'ai-agent', 'orchestration', 'ci-cd', 'iot', 'ml-ops', 'bpm', 'messaging', 'image-gen'];
    for (const key of expected) {
      assert.ok(TOOL_GROUPS[key], `Missing group: ${key}`);
    }
  });

  it('places tekton in ci-cd group', () => {
    assert.ok(TOOL_GROUPS['ci-cd'].includes('tekton'));
  });

  it('places kafka-connect and camel in messaging group', () => {
    assert.ok(TOOL_GROUPS['messaging'].includes('kafka-connect'));
    assert.ok(TOOL_GROUPS['messaging'].includes('camel'));
  });

  it('places camunda in bpm group', () => {
    assert.ok(TOOL_GROUPS['bpm'].includes('camunda'));
  });
});


describe('assessMigrationDifficulty', () => {
  it('returns easy for same-group tools (n8n → activepieces)', () => {
    assert.equal(assessMigrationDifficulty('n8n', 'activepieces'), 'easy');
  });

  it('returns easy for same-group tools (tekton → github-actions)', () => {
    assert.equal(assessMigrationDifficulty('tekton', 'github-actions'), 'easy');
  });

  it('returns moderate for cross-group with similar complexity', () => {
    // github-actions (rank 3) → dbt (rank 3) — diff = 0, but cross-group
    assert.equal(assessMigrationDifficulty('github-actions', 'dbt'), 'moderate');
  });

  it('returns hard for large complexity difference across groups', () => {
    // home-assistant (rank 2) → temporal (rank 6) — diff = 4
    assert.equal(assessMigrationDifficulty('home-assistant', 'temporal'), 'hard');
  });

  it('returns unknown for unrecognized tool', () => {
    assert.equal(assessMigrationDifficulty('unknown-tool', 'n8n'), 'unknown');
  });
});


describe('generateMigrationNotes', () => {
  it('produces correct notes for same-group migration', () => {
    const notes = generateMigrationNotes('n8n', 'pipedream');
    assert.ok(notes.some(n => n.includes('easy')));
    assert.ok(notes.some(n => n.includes('Same tool group')));
  });

  it('notes learning curve when migrating to more complex tool', () => {
    const notes = generateMigrationNotes('home-assistant', 'airflow');
    assert.ok(notes.some(n => n.includes('learning curve')));
  });

  it('notes feature loss when migrating to simpler tool', () => {
    const notes = generateMigrationNotes('temporal', 'home-assistant');
    assert.ok(notes.some(n => n.includes('simpler')));
  });
});
