// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';


// ============================================================
// Shell Scripts — extractShellScriptComponents (reimplemented)
// ============================================================

function extractShellScriptComponents(content, label = '') {
  if (!content || typeof content !== 'string') {
    return {
      shell: 'sh',
      functions: [],
      hasErrorHandling: false,
      hasLogging: false,
      usesSudo: false,
      scriptType: 'unknown',
    };
  }

  const shebang = content.split('\n')[0] || '';
  let shell = 'sh';
  if (/bash/.test(shebang)) shell = 'bash';
  else if (/zsh/.test(shebang)) shell = 'zsh';
  else if (/sh/.test(shebang)) shell = 'sh';

  const funcMatches = [
    ...content.matchAll(/^(?:function\s+)?(\w+)\s*\(\s*\)\s*\{/gm),
  ];
  const functions = [...new Set(funcMatches.map(m => m[1]).filter(Boolean))].slice(0, 50);

  const hasErrorHandling = /\bset\s+-[eo]\b|\bset\s+-[^-]*e|\btrap\b.*\bERR\b|\bset\s+-o\s+errexit\b/.test(content);
  const hasLogging = /\blog\s*\(|\becho\s+|printf\s+.*\bERROR\b|\becho\s+.*\bINFO\b|\becho\s+.*\bWARN/i.test(content);
  const usesSudo = /\bsudo\b/.test(content);
  const scriptType = deriveScriptType(label, content);

  return { shell, functions, hasErrorHandling, hasLogging, usesSudo, scriptType };
}

function deriveScriptType(label, content) {
  if (label === 'deploy' || /\bdeploy\b/i.test(content.slice(0, 500))) return 'deploy';
  if (label === 'setup') return 'setup';
  if (label === 'install' || /\bapt-get\b|\byum\b|\bbrew install\b/.test(content)) return 'install';
  if (label === 'entrypoint' || /exec\s+"\$@"/.test(content)) return 'entrypoint';
  return 'setup';
}

// ── Shebang detection ─────────────────────────────────────────

describe('ShellScriptsHarvester — shebang detection', () => {
  it('detects bash shebang', () => {
    const result = extractShellScriptComponents('#!/bin/bash\necho hello\n');
    assert.equal(result.shell, 'bash');
  });

  it('detects zsh shebang', () => {
    const result = extractShellScriptComponents('#!/usr/bin/env zsh\necho hello\n');
    assert.equal(result.shell, 'zsh');
  });

  it('detects sh shebang', () => {
    const result = extractShellScriptComponents('#!/bin/sh\necho hello\n');
    assert.equal(result.shell, 'sh');
  });

  it('defaults to sh when no shebang', () => {
    const result = extractShellScriptComponents('echo hello\n');
    assert.equal(result.shell, 'sh');
  });
});

// ── Function extraction ───────────────────────────────────────

describe('ShellScriptsHarvester — function extraction', () => {
  it('extracts POSIX-style function definitions', () => {
    const script = '#!/bin/sh\ndeploy() {\n  echo deploying\n}\n';
    const result = extractShellScriptComponents(script);
    assert.ok(result.functions.includes('deploy'));
  });

  it('extracts bash function keyword style', () => {
    const script = '#!/bin/bash\nfunction setup() {\n  apt-get install -y curl\n}\n';
    const result = extractShellScriptComponents(script);
    assert.ok(result.functions.includes('setup'));
  });

  it('extracts multiple functions', () => {
    const script = '#!/bin/bash\nlog() { echo "$@"; }\ncheck_deps() { which curl; }\n';
    const result = extractShellScriptComponents(script);
    assert.ok(result.functions.includes('log'));
    assert.ok(result.functions.includes('check_deps'));
  });

  it('returns empty functions list for script with no functions', () => {
    const result = extractShellScriptComponents('#!/bin/sh\necho hello\necho world\n');
    assert.deepEqual(result.functions, []);
  });
});

// ── Error handling detection ──────────────────────────────────

describe('ShellScriptsHarvester — error handling detection', () => {
  it('detects set -e', () => {
    const result = extractShellScriptComponents('#!/bin/bash\nset -e\necho running\n');
    assert.equal(result.hasErrorHandling, true);
  });

  it('detects set -o errexit', () => {
    const result = extractShellScriptComponents('#!/bin/bash\nset -o errexit\n');
    assert.equal(result.hasErrorHandling, true);
  });

  it('detects trap ERR handler', () => {
    const result = extractShellScriptComponents('#!/bin/bash\ntrap "exit 1" ERR\necho running\n');
    assert.equal(result.hasErrorHandling, true);
  });

  it('returns false when no error handling', () => {
    const result = extractShellScriptComponents('#!/bin/sh\necho hello\n');
    assert.equal(result.hasErrorHandling, false);
  });
});

// ── Logging detection ─────────────────────────────────────────

describe('ShellScriptsHarvester — logging detection', () => {
  it('detects echo usage as logging', () => {
    const result = extractShellScriptComponents('#!/bin/sh\necho "Starting deployment"\n');
    assert.equal(result.hasLogging, true);
  });

  it('detects INFO echo pattern', () => {
    const result = extractShellScriptComponents('#!/bin/bash\necho "INFO: Starting setup"\n');
    assert.equal(result.hasLogging, true);
  });
});

// ── Sudo detection ────────────────────────────────────────────

describe('ShellScriptsHarvester — sudo detection', () => {
  it('detects sudo usage', () => {
    const result = extractShellScriptComponents('#!/bin/bash\nsudo apt-get update\n');
    assert.equal(result.usesSudo, true);
  });

  it('returns false when no sudo', () => {
    const result = extractShellScriptComponents('#!/bin/bash\napt-get update\n');
    assert.equal(result.usesSudo, false);
  });
});

// ── Script type classification ────────────────────────────────

describe('ShellScriptsHarvester — script type classification', () => {
  it('classifies deploy label as deploy', () => {
    const result = extractShellScriptComponents('#!/bin/bash\necho deploying\n', 'deploy');
    assert.equal(result.scriptType, 'deploy');
  });

  it('classifies setup label as setup', () => {
    const result = extractShellScriptComponents('#!/bin/bash\necho setup\n', 'setup');
    assert.equal(result.scriptType, 'setup');
  });

  it('classifies install label as install', () => {
    const result = extractShellScriptComponents('#!/bin/bash\napt-get install curl\n', 'install');
    assert.equal(result.scriptType, 'install');
  });

  it('classifies entrypoint label as entrypoint', () => {
    const result = extractShellScriptComponents('#!/bin/sh\nexec "$@"\n', 'entrypoint');
    assert.equal(result.scriptType, 'entrypoint');
  });

  it('infers install type from apt-get content without label', () => {
    const result = extractShellScriptComponents('#!/bin/bash\napt-get install -y nginx\n');
    assert.equal(result.scriptType, 'install');
  });

  it('infers entrypoint type from exec "$@" pattern', () => {
    const result = extractShellScriptComponents('#!/bin/sh\nset -e\nexec "$@"\n');
    assert.equal(result.scriptType, 'entrypoint');
  });
});

// ── Edge cases ────────────────────────────────────────────────

describe('ShellScriptsHarvester — edge cases', () => {
  it('returns safe defaults for empty string', () => {
    const result = extractShellScriptComponents('');
    assert.equal(result.shell, 'sh');
    assert.deepEqual(result.functions, []);
    assert.equal(result.hasErrorHandling, false);
  });

  it('returns safe defaults for null input', () => {
    const result = extractShellScriptComponents(null);
    assert.equal(result.usesSudo, false);
    assert.deepEqual(result.functions, []);
  });
});
