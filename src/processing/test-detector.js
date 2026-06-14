// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { logger } from '../utils/logger.js';

// ── Test file extension patterns ──

const FILE_PATTERNS = [
  { pattern: /_test\.go\b/, signal: 'go_test_file', framework: 'go testing' },
  { pattern: /\.test\.[jt]sx?/, signal: 'js_test_file', framework: null },
  { pattern: /\.spec\.[jt]sx?/, signal: 'js_spec_file', framework: null },
  { pattern: /\btest_[\w.]+\.py\b/, signal: 'python_test_file', framework: 'pytest' },
  { pattern: /\b[\w.]+_test\.py\b/, signal: 'python_test_file', framework: 'pytest' },
  { pattern: /\b[\w.]+_spec\.rb\b/, signal: 'ruby_spec_file', framework: 'rspec' },
];

// ── Test function / annotation patterns ──

const FUNCTION_PATTERNS = [
  { pattern: /\bdescribe\s*\(/, signal: 'describe_block', frameworks: ['jest', 'mocha', 'jasmine'] },
  { pattern: /\bit\s*\(/, signal: 'it_block', frameworks: ['jest', 'mocha', 'jasmine'] },
  { pattern: /\btest\s*\(/, signal: 'test_call', frameworks: ['jest', 'mocha'] },
  { pattern: /@Test\b/, signal: 'junit_annotation', frameworks: ['junit'] },
  { pattern: /@pytest\.mark\b/, signal: 'pytest_marker', frameworks: ['pytest'] },
  { pattern: /\bdef test_\w+/, signal: 'python_test_fn', frameworks: ['pytest', 'unittest'] },
  { pattern: /\bfunc Test[A-Z]\w*\s*\(/, signal: 'go_test_fn', frameworks: ['go testing'] },
  { pattern: /#\[test\]/, signal: 'rust_test_attr', frameworks: ['cargo test'] },
  { pattern: /#\[cfg\s*\(\s*test\s*\)\]/, signal: 'rust_cfg_test', frameworks: ['cargo test'] },
];

// ── Framework keyword patterns ──

const FRAMEWORK_KEYWORDS = [
  { pattern: /\bjest\b/i, framework: 'jest' },
  { pattern: /\bmocha\b/i, framework: 'mocha' },
  { pattern: /\bpytest\b/i, framework: 'pytest' },
  { pattern: /\bunittest\b/i, framework: 'unittest' },
  { pattern: /\bgo\s+test\b/i, framework: 'go testing' },
  { pattern: /\brspec\b/i, framework: 'rspec' },
  { pattern: /\bjunit\b/i, framework: 'junit' },
  { pattern: /\bcargo\s+test\b/i, framework: 'cargo test' },
];

// ── Workflow error handling patterns ──

const ERROR_HANDLING_PATTERNS = {
  basic: [
    /\btry\s*{/,
    /\bcatch\s*\(/,
    /\berror\s+trigger\b/i,
    /\bon[_\s]?error\b/i,
    /\bErrorTrigger\b/,
    /\bfallback\b/i,
  ],
  comprehensive: [
    /\bretry\b/i,
    /\bbackoff\b/i,
    /\bdead.?letter\b/i,
    /\bcircuit.?breaker\b/i,
    /\bErrorHandler\b/,
    /\bfinally\s*{/,
  ],
};

/**
 * Detect test coverage signals within artifact content and metadata.
 *
 * Pure function — no I/O, no side effects.
 *
 * @param {string} content - Raw artifact content (source code, workflow JSON, docs, etc.)
 * @param {object} typeMetadata - Existing type_metadata for the artifact
 * @returns {{
 *   has_tests: boolean,
 *   test_signals: string[],
 *   test_framework: string|null,
 *   error_handling_coverage: 'none'|'basic'|'comprehensive'
 * }}
 */
export function detectTests(content, typeMetadata = {}) {
  const text = typeof content === 'string' ? content : '';
  const signals = new Set();
  const detectedFrameworks = new Set();

  // ── File pattern signals ──
  for (const { pattern, signal, framework } of FILE_PATTERNS) {
    if (pattern.test(text)) {
      signals.add(signal);
      if (framework) detectedFrameworks.add(framework);
    }
  }

  // ── Function / annotation signals ──
  for (const { pattern, signal, frameworks } of FUNCTION_PATTERNS) {
    if (pattern.test(text)) {
      signals.add(signal);
      for (const fw of frameworks) detectedFrameworks.add(fw);
    }
  }

  // ── Framework keyword signals ──
  for (const { pattern, framework } of FRAMEWORK_KEYWORDS) {
    if (pattern.test(text)) {
      detectedFrameworks.add(framework);
      signals.add(`framework_${framework.replace(/\s+/g, '_')}`);
    }
  }

  // ── Error handling coverage ──
  const hasBasic = ERROR_HANDLING_PATTERNS.basic.some(p => p.test(text));
  const hasComprehensive = ERROR_HANDLING_PATTERNS.comprehensive.some(p => p.test(text));

  let error_handling_coverage = 'none';
  if (hasBasic && hasComprehensive) {
    error_handling_coverage = 'comprehensive';
  } else if (hasBasic) {
    error_handling_coverage = 'basic';
  }

  // ── Resolve primary framework (priority order mirrors test ecosystem prevalence) ──
  const FRAMEWORK_PRIORITY = [
    'pytest', 'unittest', 'jest', 'mocha', 'go testing',
    'cargo test', 'junit', 'rspec',
  ];
  const test_framework = FRAMEWORK_PRIORITY.find(fw => detectedFrameworks.has(fw)) ?? null;

  const test_signals = [...signals].sort();
  const has_tests = test_signals.length > 0;

  return { has_tests, test_signals, test_framework, error_handling_coverage };
}

/**
 * Batch-process artifacts that are missing test_coverage metadata.
 *
 * @param {object} db - pg pool / client with .query()
 * @param {number} limit - Max artifacts to process
 * @returns {{ processed: number, with_tests: number, without_tests: number }}
 */
export async function detectTestsBatch(db, limit = 100) {
  const result = await db.query(
    `SELECT id, content, type_metadata
     FROM artifacts
     WHERE type_metadata->>'test_coverage' IS NULL
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );

  if (result.rows.length === 0) {
    logger.info('No artifacts to process for test detection');
    return { processed: 0, with_tests: 0, without_tests: 0 };
  }

  logger.info(`Detecting tests for ${result.rows.length} artifacts`);

  let processed = 0;
  let with_tests = 0;
  let without_tests = 0;

  for (const row of result.rows) {
    try {
      const coverage = detectTests(row.content, row.type_metadata || {});
      const updatedMeta = {
        ...(row.type_metadata || {}),
        test_coverage: coverage,
      };

      await db.query(
        `UPDATE artifacts SET type_metadata = $1 WHERE id = $2`,
        [JSON.stringify(updatedMeta), row.id]
      );

      processed++;
      if (coverage.has_tests) {
        with_tests++;
      } else {
        without_tests++;
      }
    } catch (err) {
      logger.error('Test detection failed', { id: row.id, error: err.message });
    }
  }

  logger.info('Test detection complete', { processed, with_tests, without_tests });
  return { processed, with_tests, without_tests };
}
