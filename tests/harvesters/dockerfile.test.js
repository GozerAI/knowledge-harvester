// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';


// ============================================================
// Dockerfile — extractDockerfileComponents (reimplemented)
// ============================================================

function extractDockerfileComponents(content) {
  if (!content || typeof content !== 'string') {
    return {
      stages: [], baseImages: [], isMultiStage: false,
      hasHealthcheck: false, hasNonRootUser: false,
      exposedPorts: [], buildArgs: [],
    };
  }

  const fromLines = content.match(/^FROM\s+\S+(?:\s+AS\s+\S+)?/gim) || [];
  const stages = [];
  const baseImages = [];

  for (const line of fromLines) {
    const parts = line.trim().split(/\s+/);
    const image = parts[1] || '';
    if (image && image.toLowerCase() !== 'scratch') {
      baseImages.push(image.toLowerCase());
    }
    const asIdx = parts.findIndex(p => p.toLowerCase() === 'as');
    if (asIdx !== -1 && parts[asIdx + 1]) {
      stages.push(parts[asIdx + 1]);
    } else {
      stages.push(image || `stage${stages.length}`);
    }
  }

  const isMultiStage = fromLines.length > 1;
  const hasHealthcheck = /^HEALTHCHECK\s/im.test(content);

  const userMatches = content.match(/^USER\s+(\S+)/gim) || [];
  const hasNonRootUser = userMatches.some(u => {
    const val = u.split(/\s+/)[1] || '';
    return val !== 'root' && val !== '0';
  });

  const exposeLines = content.match(/^EXPOSE\s+(.+)/gim) || [];
  const exposedPorts = [];
  for (const line of exposeLines) {
    const portPart = line.replace(/^EXPOSE\s+/i, '').trim();
    for (const p of portPart.split(/\s+/)) {
      const port = p.split('/')[0];
      if (port && !exposedPorts.includes(port)) exposedPorts.push(port);
    }
  }

  const argMatches = content.match(/^ARG\s+(\w+)/gim) || [];
  const buildArgs = [...new Set(argMatches.map(a => a.split(/\s+/)[1]).filter(Boolean))];

  return {
    stages,
    baseImages: [...new Set(baseImages)],
    isMultiStage,
    hasHealthcheck,
    hasNonRootUser,
    exposedPorts,
    buildArgs,
  };
}

// ── FROM / stages / base images ─────────────────────────────

describe('DockerfileHarvester — FROM parsing', () => {
  it('extracts single base image', () => {
    const result = extractDockerfileComponents('FROM node:18-alpine\nRUN npm install\n');
    assert.deepEqual(result.baseImages, ['node:18-alpine']);
  });

  it('extracts multiple base images for multi-stage build', () => {
    const content = 'FROM node:18-alpine AS builder\nFROM nginx:alpine\n';
    const result = extractDockerfileComponents(content);
    assert.ok(result.baseImages.includes('node:18-alpine'));
    assert.ok(result.baseImages.includes('nginx:alpine'));
  });

  it('detects multi-stage as isMultiStage true', () => {
    const content = 'FROM golang:1.21 AS builder\nFROM scratch\n';
    assert.equal(extractDockerfileComponents(content).isMultiStage, true);
  });

  it('returns isMultiStage false for single FROM', () => {
    assert.equal(extractDockerfileComponents('FROM python:3.11\n').isMultiStage, false);
  });

  it('extracts named stage aliases from AS clause', () => {
    const content = 'FROM node:18 AS deps\nFROM node:18 AS runner\n';
    const result = extractDockerfileComponents(content);
    assert.ok(result.stages.includes('deps'));
    assert.ok(result.stages.includes('runner'));
  });

  it('excludes scratch from base images', () => {
    const content = 'FROM golang:1.21 AS builder\nFROM scratch\n';
    const result = extractDockerfileComponents(content);
    assert.ok(!result.baseImages.includes('scratch'));
    assert.ok(result.baseImages.includes('golang:1.21'));
  });
});

// ── HEALTHCHECK ──────────────────────────────────────────────

describe('DockerfileHarvester — HEALTHCHECK detection', () => {
  it('detects HEALTHCHECK instruction', () => {
    const content = 'FROM node:18\nHEALTHCHECK --interval=30s CMD curl -f http://localhost/ || exit 1\n';
    assert.equal(extractDockerfileComponents(content).hasHealthcheck, true);
  });

  it('returns false when no HEALTHCHECK', () => {
    assert.equal(extractDockerfileComponents('FROM node:18\nRUN npm install\n').hasHealthcheck, false);
  });
});

// ── USER (non-root) ──────────────────────────────────────────

describe('DockerfileHarvester — non-root USER detection', () => {
  it('detects non-root numeric user', () => {
    const content = 'FROM node:18\nUSER 1001\n';
    assert.equal(extractDockerfileComponents(content).hasNonRootUser, true);
  });

  it('detects named non-root user', () => {
    const content = 'FROM python:3.11\nUSER appuser\n';
    assert.equal(extractDockerfileComponents(content).hasNonRootUser, true);
  });

  it('returns false when USER is root', () => {
    const content = 'FROM ubuntu:22.04\nUSER root\n';
    assert.equal(extractDockerfileComponents(content).hasNonRootUser, false);
  });

  it('returns false when USER is 0', () => {
    const content = 'FROM ubuntu:22.04\nUSER 0\n';
    assert.equal(extractDockerfileComponents(content).hasNonRootUser, false);
  });

  it('returns false when no USER directive', () => {
    assert.equal(extractDockerfileComponents('FROM alpine\nRUN apk add curl\n').hasNonRootUser, false);
  });
});

// ── EXPOSE ports ─────────────────────────────────────────────

describe('DockerfileHarvester — EXPOSE ports', () => {
  it('extracts single exposed port', () => {
    const result = extractDockerfileComponents('FROM nginx\nEXPOSE 80\n');
    assert.deepEqual(result.exposedPorts, ['80']);
  });

  it('extracts multiple ports on one EXPOSE line', () => {
    const result = extractDockerfileComponents('FROM node:18\nEXPOSE 3000 8080\n');
    assert.ok(result.exposedPorts.includes('3000'));
    assert.ok(result.exposedPorts.includes('8080'));
  });

  it('strips protocol suffix from port', () => {
    const result = extractDockerfileComponents('FROM node:18\nEXPOSE 8080/tcp\n');
    assert.ok(result.exposedPorts.includes('8080'));
    assert.ok(!result.exposedPorts.includes('8080/tcp'));
  });

  it('returns empty array when no EXPOSE', () => {
    assert.deepEqual(extractDockerfileComponents('FROM alpine\n').exposedPorts, []);
  });
});

// ── ARG / build args ─────────────────────────────────────────

describe('DockerfileHarvester — build args', () => {
  it('extracts ARG names', () => {
    const content = 'FROM node:18\nARG NODE_ENV\nARG APP_VERSION\n';
    const result = extractDockerfileComponents(content);
    assert.ok(result.buildArgs.includes('NODE_ENV'));
    assert.ok(result.buildArgs.includes('APP_VERSION'));
  });

  it('returns empty array when no ARG', () => {
    assert.deepEqual(extractDockerfileComponents('FROM alpine\n').buildArgs, []);
  });
});

// ── Edge cases ───────────────────────────────────────────────

describe('DockerfileHarvester — edge cases', () => {
  it('returns safe defaults for empty string', () => {
    const result = extractDockerfileComponents('');
    assert.deepEqual(result.stages, []);
    assert.deepEqual(result.baseImages, []);
    assert.equal(result.isMultiStage, false);
  });

  it('returns safe defaults for null input', () => {
    const result = extractDockerfileComponents(null);
    assert.deepEqual(result.exposedPorts, []);
    assert.equal(result.hasHealthcheck, false);
  });
});
