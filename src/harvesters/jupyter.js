// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { ArtifactBaseHarvester } from './artifact-base.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { storeArtifact, checkArtifactDuplicate } from '../db/artifact-store.js';
import { generateContentHash } from '../utils/hash.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { randomUUID } from 'node:crypto';
import { extractNameFromPath } from '../utils/helpers.js';
import pLimit from 'p-limit';

const SEARCH_QUERIES = [
  { query: 'extension:ipynb import torch', label: 'jupyter-pytorch' },
  { query: 'extension:ipynb import tensorflow', label: 'jupyter-tensorflow' },
  { query: 'extension:ipynb import sklearn', label: 'jupyter-sklearn' },
  { query: 'extension:ipynb import pandas', label: 'jupyter-pandas' },
];

const GITHUB_API = 'https://api.github.com';
const CONCURRENCY = 5;
const MAX_PAGES_PER_QUERY = 5;

/**
 * Harvester for Jupyter notebook files (.ipynb) on GitHub.
 * Targets ML/data science notebooks using common frameworks.
 */
export class JupyterHarvester extends ArtifactBaseHarvester {
  constructor() {
    super(
      'jupyter',
      'ai_ml_asset',
      new RateLimiter({ maxTokens: 10, refillRate: 1, refillIntervalMs: 2500 })
    );
    this.seenUrls = new Set();
  }

  _headers() {
    return {
      Authorization: `Bearer ${config.github.token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'KnowledgeHarvester/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  async _harvest(signal) {
    if (!config.github.token) {
      logger.warn('No GITHUB_TOKEN set, skipping Jupyter harvester');
      return;
    }

    for (const { query, label } of SEARCH_QUERIES) {
      if (signal.aborted) break;
      logger.info(`Jupyter search: "${query}" [${label}]`);

      try {
        await this._searchAndProcess(query, label, signal);
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        logger.error('Jupyter search query failed', { query, error: err.message });
      }

      if (!signal.aborted) await new Promise(r => setTimeout(r, 5000));
    }
  }

  async _searchAndProcess(query, label, signal) {
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= MAX_PAGES_PER_QUERY && !signal.aborted) {
      await this.rateLimiter.acquire();
      const url = `${GITHUB_API}/search/code?q=${encodeURIComponent(query)}&per_page=100&page=${page}`;
      const res = await fetch(url, { headers: this._headers(), signal });

      await this._handleRateLimit(res);
      if (res.status === 403 || res.status === 429) {
        await new Promise(r => setTimeout(r, 60000));
        continue;
      }
      if (res.status === 422 || !res.ok) break;

      const data = await res.json();
      const items = data.items || [];
      logger.info(`Jupyter page ${page}: ${items.length} items`);

      const limit = pLimit(CONCURRENCY);
      const tasks = items
        .filter(item => !this.seenUrls.has(item.html_url))
        .map(item => limit(async () => {
          if (signal.aborted) return;
          this.seenUrls.add(item.html_url);
          await this.rateLimiter.acquire();
          try {
            await this._processFile(item, label, signal);
            this.resetConsecutiveErrors();
          } catch (err) {
            if (err.name === 'AbortError') throw err;
            this.recordError(err);
          }
        }));
      await Promise.all(tasks);

      hasMore = items.length === 100;
      page++;
      if (hasMore && !signal.aborted) await new Promise(r => setTimeout(r, 3000));
    }
  }

  async _handleRateLimit(res) {
    const remaining = parseInt(res.headers.get('x-ratelimit-remaining') || '999');
    if (remaining < 50) {
      const resetEpoch = parseInt(res.headers.get('x-ratelimit-reset') || '0') * 1000;
      const waitMs = Math.max(resetEpoch - Date.now() + 5000, 30000);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }

  async _processFile(searchResult, label, signal) {
    if (!searchResult.download_url) { this.stats.invalid++; return; }

    const res = await fetch(searchResult.download_url, { headers: this._headers(), signal });
    if (!res.ok) { this.stats.invalid++; return; }

    const text = await res.text();
    if (text.length > 500000 || text.length < 10) { this.stats.invalid++; return; }

    // Must be valid JSON with a cells array
    let notebook;
    try {
      notebook = JSON.parse(text);
    } catch {
      this.stats.invalid++;
      return;
    }
    if (!Array.isArray(notebook.cells)) { this.stats.invalid++; return; }

    this.stats.discovered++;

    const filename = searchResult.name || 'notebook.ipynb';
    const normalized = this._normalize(searchResult, text, notebook, filename, label);

    const { isDuplicate } = await checkArtifactDuplicate(
      normalized.hash, normalized.source, normalized.source_id
    );
    if (isDuplicate) { this.stats.duplicate++; return; }

    await storeArtifact(normalized);
    this.stats.new++;
    logger.debug('Stored Jupyter notebook', {
      id: normalized.id,
      framework: normalized.type_metadata.framework,
      repo: searchResult.repository?.full_name,
    });
  }

  _normalize(searchResult, rawText, notebook, filename, label) {
    const components = extractNotebookComponents(notebook);
    const name = searchResult?.repository?.full_name
      ? `${searchResult.repository.full_name}/${filename}`
      : extractNameFromPath(filename);
    const description = searchResult?.repository?.description || '';

    const typeMetadata = {
      asset_type: 'notebook',
      framework: components.framework,
      cell_count: components.cellCount,
      code_cell_count: components.codeCellCount,
      markdown_cell_count: components.markdownCellCount,
      imports: components.imports,
      has_visualizations: components.hasVisualizations,
      has_model_training: components.hasModelTraining,
    };

    return {
      id: randomUUID(),
      hash: generateContentHash(rawText, 'jupyter'),
      artifact_type: 'ai_ml_asset',
      source: 'jupyter',
      source_url: searchResult?.html_url || '',
      source_id: searchResult?.sha || searchResult?.html_url || randomUUID(),
      discovered_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      content: { source_code: rawText, filename },
      name,
      description,
      author: {
        username: searchResult?.repository?.owner?.login || null,
        profile_url: searchResult?.repository?.owner?.html_url || null,
      },
      language: 'python',
      tool_type: components.framework || 'jupyter',
      tool_metadata: typeMetadata,
      tags: [],
      type_metadata: typeMetadata,
      quality: {
        score: 0,
        has_description: description.length > 0,
        has_documentation: components.markdownCellCount > 0,
        is_complete: true,
        validation_status: 'valid',
      },
    };
  }
}

/**
 * Extract components from a parsed Jupyter notebook object.
 *
 * @param {object} notebook - Parsed .ipynb JSON
 * @returns {object}
 */
export function extractNotebookComponents(notebook) {
  if (!notebook || typeof notebook !== 'object') {
    return emptyNotebookComponents();
  }

  const cells = Array.isArray(notebook.cells) ? notebook.cells : [];
  const codeCells = cells.filter(c => c.cell_type === 'code');
  const markdownCells = cells.filter(c => c.cell_type === 'markdown');

  // Combine all code cell sources into one block for analysis
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

function emptyNotebookComponents() {
  return {
    framework: null,
    cellCount: 0,
    codeCellCount: 0,
    markdownCellCount: 0,
    imports: [],
    hasVisualizations: false,
    hasModelTraining: false,
  };
}

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

/**
 * Detect primary ML/data framework from code text and import list.
 * Maps raw module names to canonical framework names.
 */
export function detectJupyterFramework(codeText, imports = []) {
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
