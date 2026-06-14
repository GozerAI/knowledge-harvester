// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Code Pattern Validator — Linting and validation for code pattern artifacts.
 *
 * Checks:
 *   - Syntax: balanced braces, brackets, and parentheses
 *   - Imports: valid import/require statement structure
 *   - Anti-patterns: eval(), hardcoded secrets, console.log density
 *
 * Returns a validation result with a score 0-100.
 */

// Patterns that indicate hardcoded secrets
const SECRET_PATTERNS = [
  /password\s*=\s*['"][^'"]{4,}['"]/i,
  /api_key\s*=\s*['"][^'"]{4,}['"]/i,
  /apikey\s*=\s*['"][^'"]{4,}['"]/i,
  /AWS_SECRET[_A-Z]*\s*=\s*['"][^'"]{4,}['"]/,
  /secret\s*=\s*['"][^'"]{8,}['"]/i,
  /token\s*=\s*['"][A-Za-z0-9+/=._-]{16,}['"]/i,
];

/**
 * Validate a code pattern artifact.
 *
 * @param {string} content - Raw source code string
 * @param {object} typeMetadata - Existing type_metadata from normalization
 * @returns {{ syntax_valid: boolean, import_issues: string[], anti_patterns: string[], validation_score: number }}
 */
export function validateCodePattern(content, typeMetadata) {
  const src = content || '';
  const import_issues = [];
  const anti_patterns = [];

  // ── Syntax: balanced delimiters ──
  const syntax_valid = checkBalancedDelimiters(src);

  // ── Import heuristic ──
  // Flag malformed ES import lines (import without from or specifier)
  const importLines = src.match(/^\s*import\b[^\n]*/gm) || [];
  for (const line of importLines) {
    const trimmed = line.trim();
    // import statement that has no from and no side-effect-only form
    // side-effect-only: "import 'module'" or "import \"module\""
    const isSideEffect = /^import\s+['"]/.test(trimmed);
    const hasFrom = /\bfrom\s+['"]/.test(trimmed);
    const isTypeImport = /^import\s+type\b/.test(trimmed);

    if (!isSideEffect && !hasFrom && !isTypeImport) {
      // Could be "import X from" missing the specifier, or bare "import"
      if (!/^import\s+\*\s+as\s+\w+\s+from/.test(trimmed)) {
        import_issues.push(`Possibly malformed import: ${trimmed.slice(0, 80)}`);
      }
    }
  }

  // Flag require() calls that aren't assigned or used in a recognisable pattern
  const requireCalls = src.match(/\brequire\s*\([^)]*\)/g) || [];
  for (const call of requireCalls) {
    if (!/['"][^'"]+['"]/.test(call)) {
      import_issues.push(`Dynamic require with no string literal: ${call.slice(0, 80)}`);
    }
  }

  // ── Anti-patterns ──

  // eval() usage
  const evalMatches = src.match(/\beval\s*\(/g) || [];
  if (evalMatches.length > 0) {
    anti_patterns.push(`eval() usage detected (${evalMatches.length} occurrence${evalMatches.length > 1 ? 's' : ''})`);
  }

  // Hardcoded secrets
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(src)) {
      const label = pattern.source.split('\\s')[0].replace(/[\\^(]/g, '').toUpperCase();
      anti_patterns.push(`Possible hardcoded secret: ${label}`);
    }
  }

  // console.log density — flag if more than 1 per 20 lines
  const lineCount = src.split('\n').length || 1;
  const consoleLogCount = (src.match(/\bconsole\.log\s*\(/g) || []).length;
  const logDensity = consoleLogCount / lineCount;
  if (logDensity > 0.05 && consoleLogCount >= 3) {
    anti_patterns.push(`High console.log density: ${consoleLogCount} calls across ${lineCount} lines`);
  }

  // ── Score ──
  const validation_score = calculateCodePatternValidationScore({
    syntax_valid,
    import_issues,
    anti_patterns,
    consoleLogCount,
    lineCount,
  });

  return { syntax_valid, import_issues, anti_patterns, validation_score };
}

/**
 * Check that braces, brackets, and parens are balanced in the source.
 * Returns false only when there is a definite structural mismatch.
 */
function checkBalancedDelimiters(src) {
  // Strip string literals and comments to avoid counting delimiters inside them
  const stripped = stripStringsAndComments(src);

  let braces = 0;
  let brackets = 0;
  let parens = 0;

  for (const ch of stripped) {
    if (ch === '{') braces++;
    else if (ch === '}') braces--;
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
    else if (ch === '(') parens++;
    else if (ch === ')') parens--;

    // Short-circuit on definite underflow
    if (braces < 0 || brackets < 0 || parens < 0) return false;
  }

  return braces === 0 && brackets === 0 && parens === 0;
}

/**
 * Naively remove string literals and line/block comments so that
 * delimiter characters inside them don't count.
 */
function stripStringsAndComments(src) {
  // Replace block comments
  let s = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  // Replace line comments
  s = s.replace(/\/\/[^\n]*/g, ' ');
  // Replace double-quoted strings (no multiline handling needed for balance check)
  s = s.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  // Replace single-quoted strings
  s = s.replace(/'(?:[^'\\]|\\.)*'/g, "''");
  // Replace template literals (rough)
  s = s.replace(/`(?:[^`\\]|\\.)*`/g, '``');
  return s;
}

/**
 * Calculate validation score for a code pattern (0-100).
 */
function calculateCodePatternValidationScore({ syntax_valid, import_issues, anti_patterns, consoleLogCount, lineCount }) {
  let score = 100;

  // Syntax failure is a major deduction
  if (!syntax_valid) score -= 40;

  // Import issues (up to -20)
  score -= Math.min(import_issues.length * 5, 20);

  // Anti-patterns (up to -30)
  score -= Math.min(anti_patterns.length * 10, 30);

  // Mild console.log penalty even below threshold (-1 per log, max -10)
  score -= Math.min(consoleLogCount, 10);

  return Math.max(0, Math.min(100, score));
}
