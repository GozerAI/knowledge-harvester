// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { randomUUID } from 'node:crypto';
import { generateContentHash } from '../../../utils/hash.js';
import { extractNameFromPath } from '../../../utils/helpers.js';

/**
 * Normalize raw code pattern data into the unified artifact schema.
 *
 * @param {string} source - Source identifier (e.g. 'code-patterns', 'design-patterns')
 * @param {object} rawData - { searchResult, content, filename, label, language }
 * @returns {object} Normalized artifact for storeArtifact()
 */
export function normalizeCodePattern(source, rawData) {
  const { searchResult, content, filename, label, language } = rawData;
  const detectedLang = language || detectLanguage(filename);
  const components = extractCodePatternComponents(content, detectedLang);

  const name = searchResult?.repository?.full_name
    ? `${searchResult.repository.full_name}/${filename}`
    : extractNameFromPath(filename);
  const description = searchResult?.repository?.description || '';

  return {
    id: randomUUID(),
    hash: generateContentHash(content, 'code_pattern'),
    artifact_type: 'code_pattern',
    source,
    source_url: searchResult?.html_url || '',
    source_id: searchResult?.sha || searchResult?.html_url || randomUUID(),
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    content: { source_code: content, filename },
    name,
    description,
    author: {
      username: searchResult?.repository?.owner?.login || null,
      profile_url: searchResult?.repository?.owner?.html_url || null,
    },
    language: detectedLang,
    tool_type: detectedLang,
    tool_metadata: {
      pattern_label: label || null,
      framework: components.framework,
    },
    tags: [],
    type_metadata: {
      pattern_type: 'code_pattern',
      language: detectedLang,
      imports: components.imports,
      import_count: components.imports.length,
      classes: components.classes,
      class_count: components.classes.length,
      functions: components.functions,
      function_count: components.functions.length,
      decorators: components.decorators,
      decorator_count: components.decorators.length,
      framework: components.framework,
      line_count: content.split('\n').length,
      has_tests: components.hasTests,
      has_types: components.hasTypes,
      has_error_handling: components.hasErrorHandling,
      has_async: components.hasAsync,
    },
    quality: {
      score: 0,
      has_description: description.length > 0,
      has_documentation: hasDocstrings(content, detectedLang),
      is_complete: true,
      validation_status: 'valid',
    },
  };
}

/**
 * Extract structural components from code content.
 */
export function extractCodePatternComponents(content, language) {
  const lang = (language || '').toLowerCase();

  const imports = extractImports(content, lang);
  const classes = extractClasses(content, lang);
  const functions = extractFunctions(content, lang);
  const decorators = extractDecorators(content, lang);
  const framework = detectFramework(content, lang);
  const hasTests = detectTests(content, lang);
  const hasTypes = detectTypes(content, lang);
  const hasErrorHandling = detectErrorHandling(content, lang);
  const hasAsync = /\basync\b/.test(content);

  return {
    imports, classes, functions, decorators,
    framework, hasTests, hasTypes, hasErrorHandling, hasAsync,
  };
}

/**
 * Extract import statements.
 */
export function extractImports(content, lang) {
  const imports = new Set();

  if (['python', 'py'].includes(lang)) {
    // from X import Y or import X
    const fromImports = content.match(/^(?:from\s+(\S+)\s+import|import\s+(\S+))/gm) || [];
    for (const m of fromImports) {
      const mod = m.match(/(?:from\s+(\S+)|import\s+(\S+))/);
      if (mod) imports.add(mod[1] || mod[2]);
    }
  } else if (['javascript', 'js', 'typescript', 'ts'].includes(lang)) {
    // import X from 'Y' or require('Y')
    const esImports = content.match(/(?:from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g) || [];
    for (const m of esImports) {
      const mod = m.match(/['"]([^'"]+)['"]/);
      if (mod) imports.add(mod[1]);
    }
  } else if (['go', 'golang'].includes(lang)) {
    const goImports = content.match(/"([^"]+)"/g) || [];
    for (const m of goImports) {
      const pkg = m.replace(/"/g, '');
      if (pkg.includes('/') || pkg.includes('.')) imports.add(pkg);
    }
  } else if (['java', 'kotlin'].includes(lang)) {
    const javaImports = content.match(/^import\s+([\w.]+)/gm) || [];
    for (const m of javaImports) {
      const pkg = m.replace(/^import\s+/, '');
      if (pkg) imports.add(pkg);
    }
  } else if (['rust', 'rs'].includes(lang)) {
    const rustImports = content.match(/^use\s+([\w:]+)/gm) || [];
    for (const m of rustImports) {
      const crate = m.replace(/^use\s+/, '');
      if (crate) imports.add(crate);
    }
  }

  return [...imports].slice(0, 50);
}

/**
 * Extract class definitions.
 */
export function extractClasses(content, lang) {
  const classes = new Set();

  if (['python', 'py'].includes(lang)) {
    const matches = content.match(/^class\s+(\w+)/gm) || [];
    for (const m of matches) {
      const cls = m.match(/class\s+(\w+)/)?.[1];
      if (cls) classes.add(cls);
    }
  } else if (['javascript', 'js', 'typescript', 'ts', 'java', 'kotlin'].includes(lang)) {
    const matches = content.match(/\bclass\s+(\w+)/g) || [];
    for (const m of matches) {
      const cls = m.match(/class\s+(\w+)/)?.[1];
      if (cls) classes.add(cls);
    }
  } else if (['rust', 'rs'].includes(lang)) {
    const matches = content.match(/\bstruct\s+(\w+)/g) || [];
    for (const m of matches) {
      const s = m.match(/struct\s+(\w+)/)?.[1];
      if (s) classes.add(s);
    }
  } else if (['go', 'golang'].includes(lang)) {
    const matches = content.match(/\btype\s+(\w+)\s+struct/g) || [];
    for (const m of matches) {
      const s = m.match(/type\s+(\w+)/)?.[1];
      if (s) classes.add(s);
    }
  }

  return [...classes].slice(0, 30);
}

/**
 * Extract function/method definitions.
 */
export function extractFunctions(content, lang) {
  const funcs = new Set();

  if (['python', 'py'].includes(lang)) {
    const matches = content.match(/^\s*(?:async\s+)?def\s+(\w+)/gm) || [];
    for (const m of matches) {
      const fn = m.match(/def\s+(\w+)/)?.[1];
      if (fn && fn !== '__init__') funcs.add(fn);
    }
  } else if (['javascript', 'js', 'typescript', 'ts'].includes(lang)) {
    // function X, const X = , X() {
    const matches = content.match(/(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\())/g) || [];
    for (const m of matches) {
      const fn = m.match(/(?:function\s+(\w+)|(?:const|let|var)\s+(\w+))/);
      if (fn) funcs.add(fn[1] || fn[2]);
    }
  } else if (['go', 'golang'].includes(lang)) {
    const matches = content.match(/^func\s+(?:\([^)]+\)\s+)?(\w+)/gm) || [];
    for (const m of matches) {
      const fn = m.match(/func\s+(?:\([^)]+\)\s+)?(\w+)/)?.[1];
      if (fn) funcs.add(fn);
    }
  } else if (['rust', 'rs'].includes(lang)) {
    const matches = content.match(/\bfn\s+(\w+)/g) || [];
    for (const m of matches) {
      const fn = m.match(/fn\s+(\w+)/)?.[1];
      if (fn) funcs.add(fn);
    }
  }

  return [...funcs].slice(0, 50);
}

/**
 * Extract decorator patterns.
 */
export function extractDecorators(content, lang) {
  const decorators = new Set();

  if (['python', 'py'].includes(lang)) {
    const matches = content.match(/^@(\w+(?:\.\w+)*)/gm) || [];
    for (const m of matches) {
      const dec = m.replace('@', '');
      if (dec) decorators.add(dec);
    }
  } else if (['typescript', 'ts', 'java', 'kotlin'].includes(lang)) {
    const matches = content.match(/^@(\w+)/gm) || [];
    for (const m of matches) {
      const dec = m.replace('@', '');
      if (dec) decorators.add(dec);
    }
  }

  return [...decorators].slice(0, 20);
}

/**
 * Detect the primary framework from imports/content.
 */
export function detectFramework(content, lang) {
  const frameworks = {
    python: [
      ['fastapi', /\bFastAPI\b|from fastapi/],
      ['django', /\bdjango\b|from django/],
      ['flask', /\bFlask\b|from flask/],
      ['pytorch', /\btorch\b|import torch/],
      ['tensorflow', /\btensorflow\b|import tensorflow/],
      ['sqlalchemy', /\bSQLAlchemy\b|from sqlalchemy/],
      ['pytest', /\bpytest\b|import pytest/],
      ['pydantic', /\bBaseModel\b.*pydantic|from pydantic/],
    ],
    javascript: [
      ['react', /\bReact\b|from ['"]react['"]/],
      ['express', /\bexpress\b|require\(['"]express['"]\)/],
      ['nextjs', /\bnext\b|from ['"]next/],
      ['nestjs', /\b@nestjs\b|from ['"]@nestjs/],
      ['vue', /\bVue\b|from ['"]vue['"]/],
    ],
    typescript: [
      ['nestjs', /@nestjs\b|from ['"]@nestjs/],
      ['angular', /@angular\b|from ['"]@angular/],
      ['react', /\bReact\b|from ['"]react['"]/],
      ['nextjs', /\bnext\b|from ['"]next/],
    ],
    go: [
      ['gin', /\bgin-gonic\/gin\b/],
      ['echo', /\blabstack\/echo\b/],
      ['fiber', /\bgofiber\/fiber\b/],
      ['grpc', /\bgoogle\.golang\.org\/grpc\b/],
    ],
    rust: [
      ['actix', /\bactix[-_]web\b/],
      ['axum', /\baxum\b/],
      ['tokio', /\btokio\b/],
      ['serde', /\bserde\b/],
    ],
  };

  const langKey = ['py'].includes(lang) ? 'python'
    : ['js'].includes(lang) ? 'javascript'
    : ['ts'].includes(lang) ? 'typescript'
    : ['golang'].includes(lang) ? 'go'
    : ['rs'].includes(lang) ? 'rust'
    : lang;

  const checks = frameworks[langKey] || [];
  for (const [name, pattern] of checks) {
    if (pattern.test(content)) return name;
  }
  return null;
}

/**
 * Detect if content contains test code.
 */
export function detectTests(content, lang) {
  if (['python', 'py'].includes(lang)) {
    return /\bdef test_/.test(content) || /\bpytest\b/.test(content) || /\bunittest\b/.test(content);
  }
  if (['javascript', 'js', 'typescript', 'ts'].includes(lang)) {
    return /\b(describe|it|test)\s*\(/.test(content) || /\bjest\b|\bmocha\b|\bvitest\b/.test(content);
  }
  if (['go', 'golang'].includes(lang)) {
    return /\bfunc Test\w+/.test(content);
  }
  if (['rust', 'rs'].includes(lang)) {
    return /#\[test\]/.test(content) || /\bmod tests\b/.test(content);
  }
  return false;
}

/**
 * Detect type annotations / typing usage.
 */
export function detectTypes(content, lang) {
  if (['python', 'py'].includes(lang)) {
    return /\bfrom typing\b/.test(content) || /:\s*(str|int|float|bool|list|dict|Optional|Union)\b/.test(content);
  }
  if (['typescript', 'ts'].includes(lang)) {
    return true; // TypeScript by definition
  }
  if (['go', 'golang', 'rust', 'rs', 'java', 'kotlin'].includes(lang)) {
    return true; // Statically typed
  }
  return false;
}

/**
 * Detect error handling patterns.
 */
export function detectErrorHandling(content, lang) {
  if (['python', 'py'].includes(lang)) {
    return /\btry:/.test(content) && /\bexcept\b/.test(content);
  }
  if (['javascript', 'js', 'typescript', 'ts'].includes(lang)) {
    return /\btry\s*\{/.test(content) && /\bcatch\b/.test(content);
  }
  if (['go', 'golang'].includes(lang)) {
    return /\bif err != nil\b/.test(content);
  }
  if (['rust', 'rs'].includes(lang)) {
    return /\bResult</.test(content) || /\.unwrap\(\)/.test(content) || /\?;/.test(content);
  }
  return false;
}

/**
 * Detect if code has docstrings / documentation comments.
 */
function hasDocstrings(content, lang) {
  if (['python', 'py'].includes(lang)) {
    return /"""[\s\S]{10,}?"""/.test(content) || /'''[\s\S]{10,}?'''/.test(content);
  }
  if (['javascript', 'js', 'typescript', 'ts', 'java', 'kotlin'].includes(lang)) {
    return /\/\*\*[\s\S]{10,}?\*\//.test(content);
  }
  if (['rust', 'rs'].includes(lang)) {
    return /\/\/\/\s+/.test(content);
  }
  if (['go', 'golang'].includes(lang)) {
    return /\/\/\s+\w+\s/.test(content); // Go convention: comment above function
  }
  return false;
}

/**
 * Detect language from filename extension.
 */
export function detectLanguage(filename) {
  if (!filename) return 'unknown';
  const ext = filename.split('.').pop()?.toLowerCase();
  const map = {
    py: 'python', js: 'javascript', ts: 'typescript', jsx: 'javascript',
    tsx: 'typescript', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
    rb: 'ruby', php: 'php', cs: 'csharp', cpp: 'cpp', c: 'c',
    swift: 'swift', scala: 'scala', lua: 'lua', r: 'r',
    sh: 'shell', bash: 'shell', zsh: 'shell',
  };
  return map[ext] || ext || 'unknown';
}
