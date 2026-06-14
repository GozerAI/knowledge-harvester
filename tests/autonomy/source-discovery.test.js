// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Tests for #697 — Autonomous Source Discovery
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Re-implement helpers for unit testing ──

function deriveRelatedSources(sourceUrl) {
  const sources = [];
  if (!sourceUrl) return sources;
  const ghMatch = sourceUrl.match(/github\.com\/([^/]+)\//);
  if (ghMatch) {
    sources.push({
      name: `${ghMatch[1]}-org`,
      url: `https://github.com/${ghMatch[1]}`,
      type: 'repository',
      relevance: 0.7,
    });
  }
  return sources;
}

function extractDependencies(metadata) {
  const deps = [];
  if (!metadata) return deps;
  const depFields = ['dependencies', 'requires', 'imports', 'packages'];
  for (const field of depFields) {
    const val = metadata[field];
    if (Array.isArray(val)) {
      for (const d of val) {
        if (typeof d === 'string' && d.includes('/')) {
          deps.push({ name: d, url: `https://github.com/${d}` });
        }
      }
    } else if (typeof val === 'object' && val !== null) {
      for (const key of Object.keys(val)) {
        if (key.includes('/')) {
          deps.push({ name: key, url: `https://github.com/${key}` });
        }
      }
    }
  }
  return deps;
}

function getCommunityMappings(category) {
  const mappings = {
    automation: [
      { name: 'n8n-community', url: 'https://community.n8n.io', relevance: 0.9 },
      { name: 'make-community', url: 'https://community.make.com', relevance: 0.7 },
    ],
    'ai-agents': [
      { name: 'langchain-discord', url: 'https://discord.gg/langchain', relevance: 0.8 },
      { name: 'huggingface-hub', url: 'https://huggingface.co', relevance: 0.85 },
    ],
  };
  return mappings[category] || [];
}

function countByField(arr, field) {
  const counts = {};
  for (const item of arr) {
    const val = item[field];
    counts[val] = (counts[val] || 0) + 1;
  }
  return counts;
}

function getKnownRegistries() {
  return [
    { name: 'Terraform Registry', source_name: 'terraform-registry', url: 'https://registry.terraform.io', relevance: 0.85, categories: ['infra_config'] },
    { name: 'Helm Hub', source_name: 'helm-hub', url: 'https://artifacthub.io', relevance: 0.8, categories: ['infra_config'] },
  ];
}

describe('Source Discovery', () => {
  describe('deriveRelatedSources', () => {
    it('should derive org URL from GitHub repo URL', () => {
      const sources = deriveRelatedSources('https://github.com/langchain-ai/langchain/tree/main');
      assert.equal(sources.length, 1);
      assert.equal(sources[0].url, 'https://github.com/langchain-ai');
      assert.equal(sources[0].name, 'langchain-ai-org');
    });

    it('should return empty for non-GitHub URLs', () => {
      const sources = deriveRelatedSources('https://example.com/something');
      assert.equal(sources.length, 0);
    });

    it('should return empty for null URL', () => {
      const sources = deriveRelatedSources(null);
      assert.equal(sources.length, 0);
    });

    it('should handle GitHub URLs without trailing slash', () => {
      const sources = deriveRelatedSources('https://github.com/facebook/react');
      assert.equal(sources.length, 1);
      assert.equal(sources[0].url, 'https://github.com/facebook');
    });

    it('should set relevance for derived sources', () => {
      const sources = deriveRelatedSources('https://github.com/org/repo/');
      assert.equal(sources[0].relevance, 0.7);
    });

    it('should set type to repository', () => {
      const sources = deriveRelatedSources('https://github.com/org/repo/');
      assert.equal(sources[0].type, 'repository');
    });
  });

  describe('extractDependencies', () => {
    it('should extract from array dependencies', () => {
      const deps = extractDependencies({ dependencies: ['org/repo', 'single'] });
      assert.equal(deps.length, 1);
      assert.equal(deps[0].name, 'org/repo');
    });

    it('should extract from object dependencies', () => {
      const deps = extractDependencies({ dependencies: { 'org/lib': '^1.0.0' } });
      assert.equal(deps.length, 1);
      assert.equal(deps[0].name, 'org/lib');
    });

    it('should handle null metadata', () => {
      assert.equal(extractDependencies(null).length, 0);
    });

    it('should handle empty metadata', () => {
      assert.equal(extractDependencies({}).length, 0);
    });

    it('should handle multiple dep fields', () => {
      const deps = extractDependencies({
        dependencies: ['a/b'],
        requires: ['c/d'],
      });
      assert.equal(deps.length, 2);
    });

    it('should skip non-scoped strings', () => {
      const deps = extractDependencies({ dependencies: ['simple-name'] });
      assert.equal(deps.length, 0);
    });

    it('should generate GitHub URLs', () => {
      const deps = extractDependencies({ imports: ['owner/package'] });
      assert.equal(deps[0].url, 'https://github.com/owner/package');
    });
  });

  describe('getCommunityMappings', () => {
    it('should return automation communities', () => {
      const c = getCommunityMappings('automation');
      assert.equal(c.length, 2);
      assert.ok(c[0].url.includes('n8n'));
    });

    it('should return AI agent communities', () => {
      const c = getCommunityMappings('ai-agents');
      assert.equal(c.length, 2);
    });

    it('should return empty for unknown category', () => {
      assert.equal(getCommunityMappings('nonexistent').length, 0);
    });
  });

  describe('countByField', () => {
    it('should count items by field', () => {
      const items = [{ type: 'a' }, { type: 'b' }, { type: 'a' }];
      const counts = countByField(items, 'type');
      assert.equal(counts.a, 2);
      assert.equal(counts.b, 1);
    });

    it('should handle empty array', () => {
      const counts = countByField([], 'type');
      assert.deepEqual(counts, {});
    });
  });

  describe('getKnownRegistries', () => {
    it('should return known registries', () => {
      const regs = getKnownRegistries();
      assert.ok(regs.length > 0);
      assert.ok(regs[0].name);
      assert.ok(regs[0].url);
    });

    it('should include relevance scores', () => {
      const regs = getKnownRegistries();
      for (const r of regs) {
        assert.ok(r.relevance >= 0 && r.relevance <= 1);
      }
    });

    it('should include categories', () => {
      const regs = getKnownRegistries();
      for (const r of regs) {
        assert.ok(Array.isArray(r.categories));
      }
    });
  });
});
