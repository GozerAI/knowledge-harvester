// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';


// ============================================================
// CI Configs — extractCIComponents (reimplemented inline)
// ============================================================

function extractGitHubActionsComponents(content) {
  const jobs = [];
  let inJobs = false;
  for (const line of content.split('\n')) {
    if (/^jobs:/.test(line)) { inJobs = true; continue; }
    if (inJobs && /^  ([\w-]+):/.test(line)) {
      const m = line.match(/^  ([\w-]+):/);
      if (m) jobs.push(m[1]);
    }
    if (inJobs && /^\S/.test(line) && !line.startsWith('jobs:')) inJobs = false;
  }

  const triggerEvents = [];
  const onMatch = content.match(/^on:\s*\n([\s\S]*?)(?=^\w)/m);
  if (onMatch) {
    const eventLines = onMatch[1].match(/^\s{2}(\w+):/gm) || [];
    for (const e of eventLines) triggerEvents.push(e.trim().replace(':', ''));
  }
  const inlineOn = content.match(/^on:\s*\[([^\]]+)\]/m);
  if (inlineOn) {
    for (const ev of inlineOn[1].split(',')) triggerEvents.push(ev.trim());
  }

  return {
    jobs: [...new Set(jobs)],
    stages: [],
    hasMatrix: /\bmatrix:/m.test(content),
    hasCaching: /\bactions\/cache\b/.test(content) || /\bcache:/m.test(content),
    hasArtifacts: /\bactions\/upload-artifact\b/.test(content) || /\bactions\/download-artifact\b/.test(content),
    triggerEvents: [...new Set(triggerEvents)],
  };
}

function extractGitLabCIComponents(content) {
  const stages = [];
  const stagesBlock = content.match(/^stages:\s*\n([\s\S]*?)(?=^\w)/m);
  if (stagesBlock) {
    const stageLines = stagesBlock[1].match(/^\s+-\s+(\S+)/gm) || [];
    for (const s of stageLines) stages.push(s.trim().replace(/^-\s+/, ''));
  }

  const RESERVED = new Set(['stages', 'variables', 'include', 'workflow', 'default', 'image', 'services', 'before_script', 'after_script', 'cache', 'artifacts']);
  const jobs = [];
  for (const line of content.split('\n')) {
    const m = line.match(/^([\w-]+):\s*$/);
    if (m && !RESERVED.has(m[1])) jobs.push(m[1]);
  }

  const triggerEvents = [];
  if (/\bpush\b/.test(content)) triggerEvents.push('push');
  if (/\bmerge_request\b/.test(content)) triggerEvents.push('merge_request');
  if (/\bschedule\b/.test(content)) triggerEvents.push('schedule');

  return {
    jobs: jobs.slice(0, 50),
    stages,
    hasMatrix: /\bparallel:\s*\n\s+matrix:/m.test(content) || /\bparallel:\s*\d/m.test(content),
    hasCaching: /\bcache:/m.test(content),
    hasArtifacts: /\bartifacts:/m.test(content),
    triggerEvents: [...new Set(triggerEvents)],
  };
}

function extractJenkinsfileComponents(content) {
  const stages = [];
  const stageMatches = content.match(/\bstage\s*\(\s*['"]([^'"]+)['"]\s*\)/g) || [];
  for (const m of stageMatches) {
    const name = m.match(/['"]([^'"]+)['"]/)?.[1];
    if (name) stages.push(name);
  }

  const triggerEvents = [];
  if (/\bcron\b/.test(content)) triggerEvents.push('cron');
  if (/\bpollSCM\b/.test(content)) triggerEvents.push('pollSCM');
  if (/\bGenericTrigger\b/.test(content)) triggerEvents.push('webhook');

  return {
    jobs: [],
    stages: [...new Set(stages)],
    hasMatrix: /\bmatrix\s*\{/m.test(content) || /\baxes\s*\{/m.test(content),
    hasCaching: false,
    hasArtifacts: /\barchiveArtifacts\b/.test(content) || /\bjunit\b/.test(content),
    triggerEvents: [...new Set(triggerEvents)],
  };
}

// ── GitHub Actions ──────────────────────────────────────────

describe('CIConfigsHarvester — GitHub Actions normalization', () => {
  it('extracts job names from jobs block', () => {
    const yaml = `on:\n  push:\njobs:\n  build:\n    runs-on: ubuntu-latest\n  test:\n    runs-on: ubuntu-latest\n`;
    const result = extractGitHubActionsComponents(yaml);
    assert.deepEqual(result.jobs, ['build', 'test']);
  });

  it('detects matrix strategy', () => {
    const yaml = `jobs:\n  build:\n    strategy:\n      matrix:\n        node: [14, 16]\n`;
    assert.equal(extractGitHubActionsComponents(yaml).hasMatrix, true);
  });

  it('returns hasMatrix false when no matrix key', () => {
    const yaml = `jobs:\n  build:\n    runs-on: ubuntu-latest\n`;
    assert.equal(extractGitHubActionsComponents(yaml).hasMatrix, false);
  });

  it('detects actions/cache usage', () => {
    const yaml = `steps:\n  - uses: actions/cache@v3\n    with:\n      path: ~/.npm\n`;
    assert.equal(extractGitHubActionsComponents(yaml).hasCaching, true);
  });

  it('detects upload-artifact usage', () => {
    const yaml = `steps:\n  - uses: actions/upload-artifact@v3\n    with:\n      name: dist\n`;
    assert.equal(extractGitHubActionsComponents(yaml).hasArtifacts, true);
  });

  it('extracts inline on: trigger events', () => {
    const yaml = `on: [push, pull_request]\njobs:\n  build:\n`;
    const result = extractGitHubActionsComponents(yaml);
    assert.ok(result.triggerEvents.includes('push'));
    assert.ok(result.triggerEvents.includes('pull_request'));
  });

  it('returns empty jobs for yaml without jobs block', () => {
    const result = extractGitHubActionsComponents('name: CI\non:\n  push:\n');
    assert.deepEqual(result.jobs, []);
  });
});

// ── GitLab CI ───────────────────────────────────────────────

describe('CIConfigsHarvester — GitLab CI normalization', () => {
  it('extracts stages list', () => {
    const yaml = `stages:\n  - build\n  - test\n  - deploy\nbuild-job:\n`;
    const result = extractGitLabCIComponents(yaml);
    assert.deepEqual(result.stages, ['build', 'test', 'deploy']);
  });

  it('extracts job names excluding reserved keywords', () => {
    const yaml = `stages:\n  - build\nbuild-job:\ncache:\ntest-job:\n`;
    const result = extractGitLabCIComponents(yaml);
    assert.ok(result.jobs.includes('build-job'));
    assert.ok(result.jobs.includes('test-job'));
    assert.ok(!result.jobs.includes('cache'));
    assert.ok(!result.jobs.includes('stages'));
  });

  it('detects caching', () => {
    const yaml = `test:\n  cache:\n    key: $CI_COMMIT_REF_SLUG\n`;
    assert.equal(extractGitLabCIComponents(yaml).hasCaching, true);
  });

  it('detects artifacts', () => {
    const yaml = `build:\n  artifacts:\n    paths:\n      - dist/\n`;
    assert.equal(extractGitLabCIComponents(yaml).hasArtifacts, true);
  });

  it('detects push trigger event', () => {
    const yaml = `workflow:\n  rules:\n    - if: $CI_PIPELINE_SOURCE == "push"\n`;
    assert.ok(extractGitLabCIComponents(yaml).triggerEvents.includes('push'));
  });
});

// ── Jenkinsfile ─────────────────────────────────────────────

describe('CIConfigsHarvester — Jenkinsfile normalization', () => {
  it('extracts stage names from declarative pipeline', () => {
    const groovy = `pipeline {\n  stages {\n    stage('Build') { steps { sh 'make' } }\n    stage('Test') { steps { sh 'make test' } }\n  }\n}`;
    const result = extractJenkinsfileComponents(groovy);
    assert.ok(result.stages.includes('Build'));
    assert.ok(result.stages.includes('Test'));
  });

  it('detects archiveArtifacts as hasArtifacts', () => {
    const groovy = `stage('Package') { steps { archiveArtifacts 'dist/**' } }`;
    assert.equal(extractJenkinsfileComponents(groovy).hasArtifacts, true);
  });

  it('detects cron trigger', () => {
    const groovy = `triggers { cron('H 4/* 0 0 1-5') }`;
    assert.ok(extractJenkinsfileComponents(groovy).triggerEvents.includes('cron'));
  });

  it('returns empty jobs array for Jenkinsfile', () => {
    const groovy = `pipeline { stages { stage('Build') {} } }`;
    assert.deepEqual(extractJenkinsfileComponents(groovy).jobs, []);
  });

  it('returns empty stages for minimal Jenkinsfile', () => {
    const result = extractJenkinsfileComponents('node { sh "make" }');
    assert.deepEqual(result.stages, []);
  });
});
