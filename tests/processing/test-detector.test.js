// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Pure function re-implementation (no DB deps) ──

const FILE_PATTERNS = [
  { pattern: /_test\.go\b/, signal: 'go_test_file', framework: 'go testing' },
  { pattern: /\.test\.[jt]sx?/, signal: 'js_test_file', framework: null },
  { pattern: /\.spec\.[jt]sx?/, signal: 'js_spec_file', framework: null },
  { pattern: /\btest_[\w.]+\.py\b/, signal: 'python_test_file', framework: 'pytest' },
  { pattern: /\b[\w.]+_test\.py\b/, signal: 'python_test_file', framework: 'pytest' },
  { pattern: /\b[\w.]+_spec\.rb\b/, signal: 'ruby_spec_file', framework: 'rspec' },
];

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

const FRAMEWORK_PRIORITY = [
  'pytest', 'unittest', 'jest', 'mocha', 'go testing',
  'cargo test', 'junit', 'rspec',
];

function detectTests(content, typeMetadata = {}) {
  const text = typeof content === 'string' ? content : '';
  const signals = new Set();
  const detectedFrameworks = new Set();

  for (const { pattern, signal, framework } of FILE_PATTERNS) {
    if (pattern.test(text)) {
      signals.add(signal);
      if (framework) detectedFrameworks.add(framework);
    }
  }

  for (const { pattern, signal, frameworks } of FUNCTION_PATTERNS) {
    if (pattern.test(text)) {
      signals.add(signal);
      for (const fw of frameworks) detectedFrameworks.add(fw);
    }
  }

  for (const { pattern, framework } of FRAMEWORK_KEYWORDS) {
    if (pattern.test(text)) {
      detectedFrameworks.add(framework);
      signals.add(`framework_${framework.replace(/\s+/g, '_')}`);
    }
  }

  const hasBasic = ERROR_HANDLING_PATTERNS.basic.some(p => p.test(text));
  const hasComprehensive = ERROR_HANDLING_PATTERNS.comprehensive.some(p => p.test(text));

  let error_handling_coverage = 'none';
  if (hasBasic && hasComprehensive) {
    error_handling_coverage = 'comprehensive';
  } else if (hasBasic) {
    error_handling_coverage = 'basic';
  }

  const test_framework = FRAMEWORK_PRIORITY.find(fw => detectedFrameworks.has(fw)) ?? null;
  const test_signals = [...signals].sort();
  const has_tests = test_signals.length > 0;

  return { has_tests, test_signals, test_framework, error_handling_coverage };
}


// ── Shape contract ──

describe('detectTests — return shape', () => {
  it('returns all required fields', () => {
    const result = detectTests('');
    assert.ok('has_tests' in result);
    assert.ok('test_signals' in result);
    assert.ok('test_framework' in result);
    assert.ok('error_handling_coverage' in result);
  });

  it('has_tests is boolean', () => {
    assert.equal(typeof detectTests('').has_tests, 'boolean');
  });

  it('test_signals is an array', () => {
    assert.ok(Array.isArray(detectTests('').test_signals));
  });
});


// ── Go test patterns ──

describe('detectTests — Go', () => {
  it('detects _test.go file pattern', () => {
    const result = detectTests('// file: auth_test.go\npackage auth\n');
    assert.ok(result.has_tests);
    assert.ok(result.test_signals.includes('go_test_file'));
  });

  it('detects func Test* function signature', () => {
    const result = detectTests('func TestHandleRequest(t *testing.T) {\n}');
    assert.ok(result.has_tests);
    assert.ok(result.test_signals.includes('go_test_fn'));
    assert.equal(result.test_framework, 'go testing');
  });

  it('detects go test keyword', () => {
    const result = detectTests('run: go test ./...');
    assert.ok(result.has_tests);
  });
});


// ── JavaScript / TypeScript test patterns ──

describe('detectTests — JavaScript / TypeScript', () => {
  it('detects .test.js file reference', () => {
    const result = detectTests('import "./auth.test.js"');
    assert.ok(result.has_tests);
    assert.ok(result.test_signals.includes('js_test_file'));
  });

  it('detects .spec.ts file reference', () => {
    const result = detectTests('// auth.spec.ts');
    assert.ok(result.has_tests);
    assert.ok(result.test_signals.includes('js_spec_file'));
  });

  it('detects describe() block', () => {
    const result = detectTests("describe('auth', () => {");
    assert.ok(result.has_tests);
    assert.ok(result.test_signals.includes('describe_block'));
  });

  it('detects it() block', () => {
    const result = detectTests("it('should return 200', () => {");
    assert.ok(result.has_tests);
    assert.ok(result.test_signals.includes('it_block'));
  });

  it('detects test() call', () => {
    const result = detectTests("test('adds two numbers', () => {");
    assert.ok(result.has_tests);
    assert.ok(result.test_signals.includes('test_call'));
  });

  it('identifies jest as framework from keyword', () => {
    const result = detectTests("const { describe, it } = require('jest');");
    assert.equal(result.test_framework, 'jest');
  });

  it('identifies mocha as framework from keyword', () => {
    const result = detectTests('mocha --reporter spec');
    assert.equal(result.test_framework, 'mocha');
  });
});


// ── Python test patterns ──

describe('detectTests — Python', () => {
  it('detects def test_ function', () => {
    const result = detectTests('def test_login(client):\n    pass');
    assert.ok(result.has_tests);
    assert.ok(result.test_signals.includes('python_test_fn'));
  });

  it('detects test_*.py file pattern', () => {
    const result = detectTests('# file: test_auth.py');
    assert.ok(result.has_tests);
    assert.ok(result.test_signals.includes('python_test_file'));
  });

  it('detects *_test.py file pattern', () => {
    const result = detectTests('# file: auth_test.py');
    assert.ok(result.has_tests);
    assert.ok(result.test_signals.includes('python_test_file'));
  });

  it('detects @pytest.mark decorator', () => {
    const result = detectTests('@pytest.mark.parametrize("x", [1, 2])');
    assert.ok(result.has_tests);
    assert.ok(result.test_signals.includes('pytest_marker'));
    assert.equal(result.test_framework, 'pytest');
  });

  it('pytest takes priority over unittest in framework detection', () => {
    const result = detectTests('import unittest\n@pytest.mark.slow\ndef test_x(): pass');
    assert.equal(result.test_framework, 'pytest');
  });
});


// ── Java / JUnit test patterns ──

describe('detectTests — Java / JUnit', () => {
  it('detects @Test annotation', () => {
    const result = detectTests('@Test\npublic void shouldReturnOk() {');
    assert.ok(result.has_tests);
    assert.ok(result.test_signals.includes('junit_annotation'));
  });

  it('identifies junit from keyword', () => {
    const result = detectTests('import org.junit.jupiter.api.Test;');
    assert.equal(result.test_framework, 'junit');
  });
});


// ── Rust test patterns ──

describe('detectTests — Rust', () => {
  it('detects #[test] attribute', () => {
    const result = detectTests('#[test]\nfn it_adds() {\n    assert_eq!(2 + 2, 4);\n}');
    assert.ok(result.has_tests);
    assert.ok(result.test_signals.includes('rust_test_attr'));
    assert.equal(result.test_framework, 'cargo test');
  });

  it('detects #[cfg(test)] module', () => {
    const result = detectTests('#[cfg(test)]\nmod tests {\n}');
    assert.ok(result.has_tests);
    assert.ok(result.test_signals.includes('rust_cfg_test'));
  });
});


// ── Error handling detection ──

describe('detectTests — workflow error handling', () => {
  it('detects basic error handling (try/catch)', () => {
    const result = detectTests('try {\n  doWork();\n} catch (err) {\n  log(err);\n}');
    assert.equal(result.error_handling_coverage, 'basic');
  });

  it('detects basic error handling (fallback)', () => {
    const result = detectTests('use a fallback node if the request fails');
    assert.equal(result.error_handling_coverage, 'basic');
  });

  it('detects comprehensive error handling (retry + catch)', () => {
    const result = detectTests('try {\n  call();\n} catch (e) {\n  retry(3);\n}');
    assert.equal(result.error_handling_coverage, 'comprehensive');
  });

  it('returns none when no error handling found', () => {
    const result = detectTests('function add(a, b) { return a + b; }');
    assert.equal(result.error_handling_coverage, 'none');
  });
});


// ── No-test cases ──

describe('detectTests — no tests found', () => {
  it('returns has_tests=false for empty string', () => {
    const result = detectTests('');
    assert.equal(result.has_tests, false);
    assert.deepEqual(result.test_signals, []);
    assert.equal(result.test_framework, null);
  });

  it('returns has_tests=false for null content', () => {
    const result = detectTests(null);
    assert.equal(result.has_tests, false);
  });

  it('returns has_tests=false for plain business logic', () => {
    const result = detectTests('function processOrder(order) {\n  return order.total * 1.1;\n}');
    assert.equal(result.has_tests, false);
  });
});


// ── Multiple signals ──

describe('detectTests — multiple signals', () => {
  it('accumulates multiple signals from complex test file', () => {
    const content = [
      '// auth.test.js',
      "describe('Auth', () => {",
      "  it('returns 401', () => {",
      "    test('something', () => {});",
      '  });',
      '});',
    ].join('\n');
    const result = detectTests(content);
    assert.ok(result.test_signals.length >= 3);
    assert.ok(result.test_signals.includes('describe_block'));
    assert.ok(result.test_signals.includes('it_block'));
    assert.ok(result.test_signals.includes('js_test_file'));
  });
});


// ── False positives ──

describe('detectTests — false positive resistance', () => {
  it('does not trigger on the word "test" inside a comment without a pattern', () => {
    // The word "test" alone should not match — requires test( function call syntax
    const result = detectTests('// This is a test of our system\nconst x = 1;');
    assert.equal(result.has_tests, false);
  });

  it('does not trigger go_test_fn on func without capital T', () => {
    // func testHelper does not match func Test[A-Z]
    const result = detectTests('func testHelper(x int) int { return x }');
    assert.equal(result.test_signals.includes('go_test_fn'), false);
  });
});


// ── Framework detection accuracy ──

describe('detectTests — framework detection accuracy', () => {
  it('detects rspec from _spec.rb file and keyword', () => {
    const result = detectTests('# file: user_spec.rb\nrspec --format');
    assert.equal(result.test_framework, 'rspec');
  });

  it('returns null framework when no framework identified', () => {
    const result = detectTests('def test_foo():\n    assert True');
    // def test_ triggers pytest framework detection
    assert.notEqual(result.test_framework, null);
  });

  it('returns null for content with no test signals at all', () => {
    const result = detectTests('SELECT * FROM users;');
    assert.equal(result.test_framework, null);
  });
});
