// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Re-implement pure extractors for testing (no DB deps) ──

function extractImports(content, lang) {
  const imports = new Set();
  if (['python', 'py'].includes(lang)) {
    const fromImports = content.match(/^(?:from\s+(\S+)\s+import|import\s+(\S+))/gm) || [];
    for (const m of fromImports) {
      const mod = m.match(/(?:from\s+(\S+)|import\s+(\S+))/);
      if (mod) imports.add(mod[1] || mod[2]);
    }
  } else if (['javascript', 'js', 'typescript', 'ts'].includes(lang)) {
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

function extractClasses(content, lang) {
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

function extractFunctions(content, lang) {
  const funcs = new Set();
  if (['python', 'py'].includes(lang)) {
    const matches = content.match(/^\s*(?:async\s+)?def\s+(\w+)/gm) || [];
    for (const m of matches) {
      const fn = m.match(/def\s+(\w+)/)?.[1];
      if (fn && fn !== '__init__') funcs.add(fn);
    }
  } else if (['javascript', 'js', 'typescript', 'ts'].includes(lang)) {
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

function extractDecorators(content, lang) {
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

function detectFramework(content, lang) {
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

function detectLanguage(filename) {
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

function detectTests(content, lang) {
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

function detectErrorHandling(content, lang) {
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

function calculateCodePatternScore(row, meta) {
  let score = 0;
  if (row.name && !row.name.includes('Untitled')) score += 8;
  if (row.description?.length > 20) score += 8;
  if (row.description?.length > 100) score += 9;
  const funcCount = meta.function_count || 0;
  const classCount = meta.class_count || 0;
  const importCount = meta.import_count || 0;
  const lineCount = meta.line_count || 0;
  if (funcCount >= 1) score += 5;
  if (funcCount >= 3) score += 3;
  if (classCount >= 1) score += 5;
  if (importCount >= 2) score += 4;
  if (lineCount >= 20 && lineCount <= 500) score += 4;
  if (lineCount > 500 && lineCount <= 2000) score += 2;
  if ((meta.decorator_count || 0) > 0) score += 4;
  if (meta.has_types) score += 5;
  if (meta.has_error_handling) score += 5;
  if (meta.has_tests) score += 8;
  if (meta.has_async) score += 3;
  if (meta.has_documentation) score += 4;
  if (meta.framework) score += 10;
  const typedLanguages = ['typescript', 'go', 'rust', 'java', 'kotlin', 'csharp'];
  if (typedLanguages.includes(meta.language)) score += 8;
  else if (['python', 'javascript'].includes(meta.language)) score += 5;
  else score += 3;
  if (importCount >= 5) score += 7;
  else if (importCount >= 3) score += 4;
  return Math.min(score, 100);
}

function getDefaultCodeCategory(toolType, meta) {
  if (meta?.has_tests) return 'testing-pattern';
  if (meta?.framework) {
    const frameworkCategories = {
      fastapi: 'api-pattern', express: 'api-pattern', flask: 'api-pattern',
      django: 'api-pattern', gin: 'api-pattern', nestjs: 'api-pattern',
      pytest: 'testing-pattern', jest: 'testing-pattern',
    };
    if (frameworkCategories[meta.framework]) return frameworkCategories[meta.framework];
  }
  return 'general-utility';
}

// ── Tests ──

describe('extractImports', () => {
  it('extracts Python imports', () => {
    const code = `from fastapi import FastAPI\nimport os\nfrom typing import Optional`;
    const result = extractImports(code, 'python');
    assert.ok(result.includes('fastapi'));
    assert.ok(result.includes('os'));
    assert.ok(result.includes('typing'));
  });

  it('extracts JavaScript ES imports', () => {
    const code = `import React from 'react';\nimport { useState } from 'react';`;
    const result = extractImports(code, 'javascript');
    assert.ok(result.includes('react'));
  });

  it('extracts JavaScript require imports', () => {
    const code = `const express = require('express');\nconst path = require('path');`;
    const result = extractImports(code, 'javascript');
    assert.ok(result.includes('express'));
    assert.ok(result.includes('path'));
  });

  it('extracts Go imports', () => {
    const code = `import (\n  "fmt"\n  "github.com/gin-gonic/gin"\n)`;
    const result = extractImports(code, 'go');
    assert.ok(result.includes('github.com/gin-gonic/gin'));
  });

  it('extracts Rust use statements', () => {
    const code = `use std::collections::HashMap;\nuse tokio::runtime;`;
    const result = extractImports(code, 'rust');
    assert.ok(result.includes('std::collections::HashMap'));
    assert.ok(result.includes('tokio::runtime'));
  });

  it('extracts Java imports', () => {
    const code = `import java.util.List;\nimport org.springframework.web.bind.annotation.RestController;`;
    const result = extractImports(code, 'java');
    assert.ok(result.includes('java.util.List'));
  });

  it('returns empty for unknown language', () => {
    const result = extractImports('some code', 'brainfuck');
    assert.deepEqual(result, []);
  });
});

describe('extractClasses', () => {
  it('extracts Python classes', () => {
    const code = `class UserService:\n  pass\nclass AuthController:\n  pass`;
    const result = extractClasses(code, 'python');
    assert.ok(result.includes('UserService'));
    assert.ok(result.includes('AuthController'));
  });

  it('extracts TypeScript classes', () => {
    const code = `class UserRepository {\n}\nexport class ProductService {}`;
    const result = extractClasses(code, 'typescript');
    assert.ok(result.includes('UserRepository'));
    assert.ok(result.includes('ProductService'));
  });

  it('extracts Rust structs', () => {
    const code = `struct Config {\n  port: u16,\n}\nstruct Server {}`;
    const result = extractClasses(code, 'rust');
    assert.ok(result.includes('Config'));
    assert.ok(result.includes('Server'));
  });

  it('extracts Go structs', () => {
    const code = `type Handler struct {\n}\ntype Service struct {}`;
    const result = extractClasses(code, 'go');
    assert.ok(result.includes('Handler'));
    assert.ok(result.includes('Service'));
  });
});

describe('extractFunctions', () => {
  it('extracts Python functions', () => {
    const code = `def process_data(x):\n  pass\nasync def fetch_users():\n  pass`;
    const result = extractFunctions(code, 'python');
    assert.ok(result.includes('process_data'));
    assert.ok(result.includes('fetch_users'));
  });

  it('skips Python __init__', () => {
    const code = `def __init__(self):\n  pass\ndef run():\n  pass`;
    const result = extractFunctions(code, 'python');
    assert.ok(!result.includes('__init__'));
    assert.ok(result.includes('run'));
  });

  it('extracts JS function declarations', () => {
    const code = `function handleRequest() {}\nconst processData = (x) => {}`;
    const result = extractFunctions(code, 'javascript');
    assert.ok(result.includes('handleRequest'));
    assert.ok(result.includes('processData'));
  });

  it('extracts Go functions', () => {
    const code = `func (s *Server) HandleRequest() {}\nfunc main() {}`;
    const result = extractFunctions(code, 'go');
    assert.ok(result.includes('HandleRequest'));
    assert.ok(result.includes('main'));
  });

  it('extracts Rust functions', () => {
    const code = `fn process() {}\nasync fn handle_request() {}`;
    const result = extractFunctions(code, 'rust');
    assert.ok(result.includes('process'));
    assert.ok(result.includes('handle_request'));
  });
});

describe('extractDecorators', () => {
  it('extracts Python decorators', () => {
    const code = `@app.get\n@router.post\ndef handler(): pass`;
    const result = extractDecorators(code, 'python');
    assert.ok(result.includes('app.get'));
    assert.ok(result.includes('router.post'));
  });

  it('extracts TypeScript decorators', () => {
    const code = `@Controller\n@Injectable\nclass Service {}`;
    const result = extractDecorators(code, 'typescript');
    assert.ok(result.includes('Controller'));
    assert.ok(result.includes('Injectable'));
  });

  it('returns empty for non-decorator languages', () => {
    const result = extractDecorators('@annotation\ncode', 'go');
    assert.deepEqual(result, []);
  });
});

describe('detectFramework', () => {
  it('detects FastAPI', () => {
    assert.equal(detectFramework('from fastapi import FastAPI', 'python'), 'fastapi');
  });

  it('detects Django', () => {
    assert.equal(detectFramework('from django.db import models', 'python'), 'django');
  });

  it('detects Express', () => {
    assert.equal(detectFramework("const app = require('express')()", 'javascript'), 'express');
  });

  it('detects React', () => {
    assert.equal(detectFramework("import React from 'react'", 'javascript'), 'react');
  });

  it('detects NestJS for TypeScript', () => {
    assert.equal(detectFramework("import { Module } from '@nestjs/common'", 'typescript'), 'nestjs');
  });

  it('detects Gin for Go', () => {
    assert.equal(detectFramework('"github.com/gin-gonic/gin"', 'go'), 'gin');
  });

  it('detects Actix for Rust', () => {
    assert.equal(detectFramework('use actix_web::{web, App}', 'rust'), 'actix');
  });

  it('returns null for unknown framework', () => {
    assert.equal(detectFramework('print("hello")', 'python'), null);
  });

  it('handles language aliases', () => {
    assert.equal(detectFramework('import torch', 'py'), 'pytorch');
    assert.equal(detectFramework("from 'react'", 'js'), 'react');
  });
});

describe('detectLanguage', () => {
  it('maps common extensions', () => {
    assert.equal(detectLanguage('app.py'), 'python');
    assert.equal(detectLanguage('index.js'), 'javascript');
    assert.equal(detectLanguage('main.go'), 'go');
    assert.equal(detectLanguage('lib.rs'), 'rust');
    assert.equal(detectLanguage('App.tsx'), 'typescript');
    assert.equal(detectLanguage('Service.java'), 'java');
  });

  it('returns extension for unmapped types', () => {
    assert.equal(detectLanguage('file.xyz'), 'xyz');
  });

  it('returns unknown for no filename', () => {
    assert.equal(detectLanguage(''), 'unknown');
    assert.equal(detectLanguage(null), 'unknown');
  });
});

describe('detectTests', () => {
  it('detects Python tests', () => {
    assert.ok(detectTests('def test_something():', 'python'));
    assert.ok(detectTests('import pytest', 'python'));
  });

  it('detects JS tests', () => {
    assert.ok(detectTests("describe('suite', () => {})", 'javascript'));
    assert.ok(detectTests("test('works', () => {})", 'javascript'));
  });

  it('detects Go tests', () => {
    assert.ok(detectTests('func TestHandler(t *testing.T) {}', 'go'));
  });

  it('detects Rust tests', () => {
    assert.ok(detectTests('#[test]\nfn test_it() {}', 'rust'));
    assert.ok(detectTests('mod tests {', 'rust'));
  });

  it('returns false for non-test code', () => {
    assert.ok(!detectTests('def process():', 'python'));
  });
});

describe('detectErrorHandling', () => {
  it('detects Python try/except', () => {
    assert.ok(detectErrorHandling('try:\n  x()\nexcept Exception:', 'python'));
  });

  it('detects JS try/catch', () => {
    assert.ok(detectErrorHandling('try { x() } catch (e) {}', 'javascript'));
  });

  it('detects Go error handling', () => {
    assert.ok(detectErrorHandling('if err != nil { return err }', 'go'));
  });

  it('detects Rust Result', () => {
    assert.ok(detectErrorHandling('fn run() -> Result<(), Error> {}', 'rust'));
    assert.ok(detectErrorHandling('file.read()?;', 'rust'));
  });

  it('returns false when no error handling', () => {
    assert.ok(!detectErrorHandling('def run(): pass', 'python'));
  });
});

describe('calculateCodePatternScore', () => {
  it('scores high for well-documented TypeScript with tests', () => {
    const row = { name: 'auth-service', description: 'A comprehensive authentication service with JWT and OAuth support for web applications.' };
    const meta = {
      language: 'typescript', framework: 'nestjs',
      function_count: 5, class_count: 2, import_count: 8,
      line_count: 150, decorator_count: 3,
      has_types: true, has_error_handling: true, has_tests: true,
      has_async: true, has_documentation: true,
    };
    const score = calculateCodePatternScore(row, meta);
    assert.ok(score >= 80, `Expected >= 80, got ${score}`);
  });

  it('scores low for minimal unnamed code', () => {
    const row = { name: 'Untitled', description: '' };
    const meta = {
      language: 'unknown', function_count: 0, class_count: 0,
      import_count: 0, line_count: 5,
    };
    const score = calculateCodePatternScore(row, meta);
    assert.ok(score < 20, `Expected < 20, got ${score}`);
  });

  it('scores medium for decent Python code without tests', () => {
    const row = { name: 'data-processor', description: 'Processes incoming data streams' };
    const meta = {
      language: 'python', framework: 'fastapi',
      function_count: 3, class_count: 1, import_count: 4,
      line_count: 80, decorator_count: 2,
      has_types: true, has_error_handling: true, has_tests: false,
      has_async: true,
    };
    const score = calculateCodePatternScore(row, meta);
    assert.ok(score >= 50 && score <= 80, `Expected 50-80, got ${score}`);
  });

  it('gives typed language bonus', () => {
    const row = { name: 'x', description: '' };
    const tsScore = calculateCodePatternScore(row, { language: 'typescript' });
    const jsScore = calculateCodePatternScore(row, { language: 'javascript' });
    assert.ok(tsScore > jsScore, 'TypeScript should score higher than JavaScript');
  });
});

describe('getDefaultCodeCategory', () => {
  it('returns testing-pattern for test code', () => {
    assert.equal(getDefaultCodeCategory('python', { has_tests: true }), 'testing-pattern');
  });

  it('returns api-pattern for API frameworks', () => {
    assert.equal(getDefaultCodeCategory('python', { framework: 'fastapi' }), 'api-pattern');
    assert.equal(getDefaultCodeCategory('javascript', { framework: 'express' }), 'api-pattern');
  });

  it('returns general-utility as fallback', () => {
    assert.equal(getDefaultCodeCategory('python', {}), 'general-utility');
  });
});
