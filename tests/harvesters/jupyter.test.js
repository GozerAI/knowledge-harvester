// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';


// ============================================================
// Jupyter — extractNotebookComponents + detectJupyterFramework
// (reimplemented inline)
// ============================================================

function extractPythonImports(codeText) {
  const imports = new Set();
  const lines = codeText.split('\n');
  for (const line of lines) {
    const fromMatch = line.match(/^from\s+(\S+)\s+import/);
    const importMatch = line.match(/^import\s+(\S+)/);
    if (fromMatch) imports.add(fromMatch[1].split('.')[0]);
    else if (importMatch) imports.add(importMatch[1].split('.')[0]);
  }
  return [...imports].slice(0, 50);
}

function detectJupyterFramework(codeText, imports = []) {
  const combined = codeText + '\n' + imports.join('\n');
  const checks = [
    ['pytorch', /\btorch\b/],
    ['tensorflow', /\btensorflow\b|import tensorflow/],
    ['keras', /\bkeras\b/],
    ['scikit-learn', /\bsklearn\b/],
    ['xgboost', /\bxgboost\b/],
    ['lightgbm', /\blightgbm\b/],
    ['transformers', /\btransformers\b/],
    ['pandas', /\bpandas\b/],
  ];
  for (const [name, pattern] of checks) {
    if (pattern.test(combined)) return name;
  }
  return null;
}

function extractNotebookComponents(notebook) {
  if (!notebook || typeof notebook !== 'object') {
    return {
      framework: null, cellCount: 0, codeCellCount: 0, markdownCellCount: 0,
      imports: [], hasVisualizations: false, hasModelTraining: false,
    };
  }

  const cells = Array.isArray(notebook.cells) ? notebook.cells : [];
  const codeCells = cells.filter(c => c.cell_type === 'code');
  const markdownCells = cells.filter(c => c.cell_type === 'markdown');

  const codeText = codeCells
    .map(c => (Array.isArray(c.source) ? c.source.join('') : c.source || ''))
    .join('\n');

  const imports = extractPythonImports(codeText);
  const framework = detectJupyterFramework(codeText, imports);
  const hasVisualizations = /\bmatplotlib\b|\bseaborn\b|\bplotly\b|\bplt\s*\./.test(codeText);
  const hasModelTraining = /\.fit\s*\(|\.train\s*\(|trainer\s*\.|\.backward\s*\(\)/.test(codeText);

  return {
    framework,
    cellCount: cells.length,
    codeCellCount: codeCells.length,
    markdownCellCount: markdownCells.length,
    imports,
    hasVisualizations,
    hasModelTraining,
  };
}

// ── Cell counting ────────────────────────────────────────────

describe('JupyterHarvester — cell counting', () => {
  it('counts code and markdown cells correctly', () => {
    const notebook = {
      cells: [
        { cell_type: 'code', source: 'import pandas as pd\n' },
        { cell_type: 'markdown', source: '# Title\n' },
        { cell_type: 'code', source: 'df = pd.read_csv("data.csv")\n' },
        { cell_type: 'markdown', source: 'Some explanation.\n' },
      ],
    };
    const result = extractNotebookComponents(notebook);
    assert.equal(result.cellCount, 4);
    assert.equal(result.codeCellCount, 2);
    assert.equal(result.markdownCellCount, 2);
  });

  it('handles notebook with no code cells', () => {
    const notebook = {
      cells: [
        { cell_type: 'markdown', source: '# Intro\n' },
        { cell_type: 'markdown', source: '## Section\n' },
      ],
    };
    const result = extractNotebookComponents(notebook);
    assert.equal(result.codeCellCount, 0);
    assert.equal(result.markdownCellCount, 2);
    assert.deepEqual(result.imports, []);
  });

  it('returns zero counts for empty cells array', () => {
    const result = extractNotebookComponents({ cells: [] });
    assert.equal(result.cellCount, 0);
    assert.equal(result.codeCellCount, 0);
  });
});

// ── Import extraction ────────────────────────────────────────

describe('JupyterHarvester — import extraction', () => {
  it('extracts top-level import statements', () => {
    const imports = extractPythonImports('import numpy as np\nimport pandas as pd\n');
    assert.ok(imports.includes('numpy'));
    assert.ok(imports.includes('pandas'));
  });

  it('extracts from...import statements', () => {
    const imports = extractPythonImports('from sklearn.linear_model import LinearRegression\n');
    assert.ok(imports.includes('sklearn'));
  });

  it('extracts root module from dotted import path', () => {
    const imports = extractPythonImports('from torch.nn import Linear\n');
    assert.ok(imports.includes('torch'));
  });

  it('handles array-format source cells', () => {
    // Jupyter stores cell source as either a string or array of lines
    const codeText = ['import matplotlib.pyplot as plt\n', 'plt.plot([1,2,3])\n'].join('');
    const imports = extractPythonImports(codeText);
    assert.ok(imports.includes('matplotlib'));
  });
});

// ── Framework detection ──────────────────────────────────────

describe('JupyterHarvester — framework detection', () => {
  it('detects pytorch from "import torch"', () => {
    assert.equal(detectJupyterFramework('import torch\nmodel = torch.nn.Linear(10, 1)\n'), 'pytorch');
  });

  it('detects tensorflow from import', () => {
    assert.equal(detectJupyterFramework('import tensorflow as tf\n'), 'tensorflow');
  });

  it('detects scikit-learn from sklearn import', () => {
    assert.equal(detectJupyterFramework('from sklearn.ensemble import RandomForestClassifier\n', ['sklearn']), 'scikit-learn');
  });

  it('detects pandas framework', () => {
    assert.equal(detectJupyterFramework('import pandas as pd\n', ['pandas']), 'pandas');
  });

  it('returns null when no known framework found', () => {
    assert.equal(detectJupyterFramework('x = 1 + 2\nprint(x)\n'), null);
  });
});

// ── Visualization detection ──────────────────────────────────

describe('JupyterHarvester — visualization detection', () => {
  it('detects matplotlib usage', () => {
    const notebook = {
      cells: [{ cell_type: 'code', source: 'import matplotlib.pyplot as plt\nplt.plot(x, y)\n' }],
    };
    assert.equal(extractNotebookComponents(notebook).hasVisualizations, true);
  });

  it('detects plotly usage', () => {
    const notebook = {
      cells: [{ cell_type: 'code', source: 'import plotly.express as px\npx.scatter(df)\n' }],
    };
    assert.equal(extractNotebookComponents(notebook).hasVisualizations, true);
  });

  it('returns false when no visualization libs used', () => {
    const notebook = {
      cells: [{ cell_type: 'code', source: 'x = [1, 2, 3]\nprint(sum(x))\n' }],
    };
    assert.equal(extractNotebookComponents(notebook).hasVisualizations, false);
  });
});

// ── Model training detection ─────────────────────────────────

describe('JupyterHarvester — model training detection', () => {
  it('detects .fit() call as model training', () => {
    const notebook = {
      cells: [{ cell_type: 'code', source: 'model.fit(X_train, y_train)\n' }],
    };
    assert.equal(extractNotebookComponents(notebook).hasModelTraining, true);
  });

  it('detects .backward() call for pytorch training', () => {
    const notebook = {
      cells: [{ cell_type: 'code', source: 'loss.backward()\noptimizer.step()\n' }],
    };
    assert.equal(extractNotebookComponents(notebook).hasModelTraining, true);
  });

  it('returns false when no training patterns found', () => {
    const notebook = {
      cells: [{ cell_type: 'code', source: 'import pandas as pd\ndf = pd.read_csv("data.csv")\n' }],
    };
    assert.equal(extractNotebookComponents(notebook).hasModelTraining, false);
  });
});

// ── Edge cases ───────────────────────────────────────────────

describe('JupyterHarvester — edge cases', () => {
  it('returns safe defaults for null input', () => {
    const result = extractNotebookComponents(null);
    assert.equal(result.cellCount, 0);
    assert.equal(result.framework, null);
    assert.deepEqual(result.imports, []);
  });

  it('handles cell source as array of lines (Jupyter native format)', () => {
    const notebook = {
      cells: [{
        cell_type: 'code',
        source: ['import torch\n', 'model = torch.nn.Linear(10, 1)\n'],
      }],
    };
    const result = extractNotebookComponents(notebook);
    assert.ok(result.imports.includes('torch'));
    assert.equal(result.framework, 'pytorch');
  });

  it('handles missing cells key gracefully', () => {
    const result = extractNotebookComponents({ metadata: {} });
    assert.equal(result.cellCount, 0);
    assert.equal(result.codeCellCount, 0);
  });
});
