// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';


// ============================================================
// Makefile — extractMakefileComponents (reimplemented)
// ============================================================

function extractMakefileComponents(content) {
  if (!content || typeof content !== 'string') {
    return {
      targets: [],
      phonyTargets: [],
      hasDocker: false,
      hasTest: false,
      hasLint: false,
      hasHelp: false,
      variableCount: 0,
    };
  }

  const phonyTargets = [];
  const phonyMatches = content.match(/^\.PHONY\s*:\s*(.+)/gm) || [];
  for (const m of phonyMatches) {
    const rest = m.replace(/^\.PHONY\s*:\s*/, '').trim();
    for (const t of rest.split(/\s+/)) {
      if (t) phonyTargets.push(t);
    }
  }

  const targets = [];
  for (const line of content.split('\n')) {
    if (/^\.PHONY/.test(line)) continue;
    if (/^#/.test(line)) continue;
    const m = line.match(/^([\w][\w.-]*)\s*:/);
    if (m && !m[1].includes('=')) targets.push(m[1]);
  }

  const varMatches = content.match(/^[\w][\w_]*\s*[:?!+]?=/gm) || [];
  const variableCount = varMatches.length;

  const hasDocker = /\bdocker\b/i.test(content);
  const hasTest = targets.some(t => /^test/.test(t)) || phonyTargets.some(t => /^test/.test(t));
  const hasLint = targets.some(t => /^lint/.test(t)) || phonyTargets.some(t => /^lint/.test(t));
  const hasHelp = targets.includes('help') || phonyTargets.includes('help');

  return {
    targets: [...new Set(targets)].slice(0, 100),
    phonyTargets: [...new Set(phonyTargets)],
    hasDocker,
    hasTest,
    hasLint,
    hasHelp,
    variableCount,
  };
}

// ── Target extraction ─────────────────────────────────────────

describe('MakefileHarvester — target extraction', () => {
  it('extracts simple targets', () => {
    const content = 'build:\n\tgo build ./...\n\ntest:\n\tgo test ./...\n';
    const result = extractMakefileComponents(content);
    assert.ok(result.targets.includes('build'));
    assert.ok(result.targets.includes('test'));
  });

  it('extracts targets with dependencies', () => {
    const content = 'all: build test\nbuild:\n\tmake build\ntest:\n\tmake test\n';
    const result = extractMakefileComponents(content);
    assert.ok(result.targets.includes('all'));
    assert.ok(result.targets.includes('build'));
    assert.ok(result.targets.includes('test'));
  });

  it('does not include .PHONY line as a target', () => {
    const content = '.PHONY: build test\nbuild:\n\techo building\n';
    const result = extractMakefileComponents(content);
    assert.ok(!result.targets.includes('.PHONY'));
  });

  it('does not include comment lines as targets', () => {
    const content = '# This is a comment\nbuild:\n\techo building\n';
    const result = extractMakefileComponents(content);
    assert.ok(!result.targets.some(t => t.startsWith('#')));
  });

  it('returns empty targets for empty Makefile', () => {
    const result = extractMakefileComponents('');
    assert.deepEqual(result.targets, []);
  });
});

// ── .PHONY parsing ────────────────────────────────────────────

describe('MakefileHarvester — .PHONY parsing', () => {
  it('extracts phony targets from single .PHONY line', () => {
    const content = '.PHONY: build test lint\nbuild:\n\techo building\n';
    const result = extractMakefileComponents(content);
    assert.ok(result.phonyTargets.includes('build'));
    assert.ok(result.phonyTargets.includes('test'));
    assert.ok(result.phonyTargets.includes('lint'));
  });

  it('extracts phony targets from multiple .PHONY lines', () => {
    const content = '.PHONY: build\n.PHONY: test\nbuild:\n\techo build\ntest:\n\techo test\n';
    const result = extractMakefileComponents(content);
    assert.ok(result.phonyTargets.includes('build'));
    assert.ok(result.phonyTargets.includes('test'));
  });

  it('returns empty phonyTargets when no .PHONY directive', () => {
    const content = 'build:\n\techo building\n';
    assert.deepEqual(extractMakefileComponents(content).phonyTargets, []);
  });

  it('deduplicates phony targets appearing in multiple .PHONY lines', () => {
    const content = '.PHONY: build\n.PHONY: build test\n';
    const result = extractMakefileComponents(content);
    const buildCount = result.phonyTargets.filter(t => t === 'build').length;
    assert.equal(buildCount, 1);
  });
});

// ── Docker detection ──────────────────────────────────────────

describe('MakefileHarvester — docker detection', () => {
  it('detects docker build command', () => {
    const content = 'docker-build:\n\tdocker build -t myapp .\n';
    assert.equal(extractMakefileComponents(content).hasDocker, true);
  });

  it('detects docker-compose usage', () => {
    const content = 'up:\n\tdocker-compose up -d\n';
    assert.equal(extractMakefileComponents(content).hasDocker, true);
  });

  it('returns false when no docker', () => {
    const content = 'build:\n\tgo build ./...\n';
    assert.equal(extractMakefileComponents(content).hasDocker, false);
  });
});

// ── test / lint / help detection ─────────────────────────────

describe('MakefileHarvester — test/lint/help detection', () => {
  it('detects test target', () => {
    const content = '.PHONY: test\ntest:\n\tnpm test\n';
    assert.equal(extractMakefileComponents(content).hasTest, true);
  });

  it('detects test target from phony list', () => {
    const content = '.PHONY: build test\nbuild:\n\techo build\n';
    assert.equal(extractMakefileComponents(content).hasTest, true);
  });

  it('detects lint target', () => {
    const content = 'lint:\n\teslint src/\n';
    assert.equal(extractMakefileComponents(content).hasLint, true);
  });

  it('detects help target', () => {
    const content = 'help:\n\t@echo "Usage: make [target]"\n';
    assert.equal(extractMakefileComponents(content).hasHelp, true);
  });

  it('returns false for hasTest when no test target', () => {
    const content = 'build:\n\tgo build\nlint:\n\tgolangci-lint run\n';
    assert.equal(extractMakefileComponents(content).hasTest, false);
  });
});

// ── Variable counting ─────────────────────────────────────────

describe('MakefileHarvester — variable counting', () => {
  it('counts variable assignments', () => {
    const content = 'APP_NAME = myapp\nVERSION := 1.0.0\nPORT ?= 3000\nbuild:\n\techo $(APP_NAME)\n';
    const result = extractMakefileComponents(content);
    assert.equal(result.variableCount, 3);
  });

  it('returns 0 for Makefile with no variables', () => {
    const content = 'build:\n\techo building\ntest:\n\techo testing\n';
    assert.equal(extractMakefileComponents(content).variableCount, 0);
  });
});

// ── Edge cases ────────────────────────────────────────────────

describe('MakefileHarvester — edge cases', () => {
  it('returns safe defaults for null input', () => {
    const result = extractMakefileComponents(null);
    assert.deepEqual(result.targets, []);
    assert.deepEqual(result.phonyTargets, []);
    assert.equal(result.variableCount, 0);
    assert.equal(result.hasDocker, false);
  });

  it('handles Makefile with only .PHONY and no real targets', () => {
    const result = extractMakefileComponents('.PHONY: all\n');
    assert.deepEqual(result.targets, []);
    assert.ok(result.phonyTargets.includes('all'));
  });
});
