#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Parallel test sharding for Node.js test runner (item #244).
 *
 * Distributes test files across N shards for parallel CI execution.
 * Usage:
 *   node test-shard.mjs --total 4 --index 0
 *   node test-shard.mjs --total 4 --index 1
 *
 * Each shard gets a deterministic subset of test files, enabling
 * parallel Jest-style sharding with the built-in Node.js test runner.
 */

import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const TEST_DIRS = [
  'tests/harvesters',
  'tests/processing',
  'tests/utils',
  'tests/db',
  'tests/export',
  'tests/api',
  'tests/net',
  'tests/testing',
  'tests/autonomy',
  'tests/self-maintenance',
];
const BASE_DIR = resolve(import.meta.dirname || '.');

function parseArgs() {
  const args = process.argv.slice(2);
  let total = 1;
  let index = 0;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--total' && args[i + 1]) total = parseInt(args[i + 1], 10);
    if (args[i] === '--index' && args[i + 1]) index = parseInt(args[i + 1], 10);
  }
  return { total, index };
}

/**
 * Discover all test files across test directories.
 * @returns {string[]}
 */
export function discoverTestFiles(baseDir = BASE_DIR) {
  const files = [];
  for (const dir of TEST_DIRS) {
    const fullDir = join(baseDir, dir);
    try {
      const entries = readdirSync(fullDir);
      for (const entry of entries) {
        if (entry.endsWith('.test.js') || entry.endsWith('.test.mjs')) {
          files.push(join(dir, entry));
        }
      }
    } catch {
      // Directory may not exist
    }
  }
  return files.sort();
}

/**
 * Hash a filename to a shard index deterministically.
 * @param {string} file
 * @param {number} totalShards
 * @returns {number}
 */
export function fileToShard(file, totalShards) {
  const hash = createHash('md5').update(file).digest();
  const num = hash.readUInt32BE(0);
  return num % totalShards;
}

/**
 * Get the test files for a specific shard.
 * @param {number} shardIndex
 * @param {number} totalShards
 * @param {string} [baseDir]
 * @returns {string[]}
 */
export function getShardFiles(shardIndex, totalShards, baseDir = BASE_DIR) {
  const all = discoverTestFiles(baseDir);
  return all.filter(f => fileToShard(f, totalShards) === shardIndex);
}

/**
 * Generate a shard distribution report.
 * @param {number} totalShards
 * @param {string} [baseDir]
 * @returns {Array<{ shard: number, files: string[], count: number }>}
 */
export function shardReport(totalShards, baseDir = BASE_DIR) {
  const all = discoverTestFiles(baseDir);
  const shards = Array.from({ length: totalShards }, (_, i) => ({
    shard: i,
    files: [],
    count: 0,
  }));

  for (const file of all) {
    const idx = fileToShard(file, totalShards);
    shards[idx].files.push(file);
    shards[idx].count++;
  }

  return shards;
}

// CLI entry point
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename || '');
if (isMain) {
  const { total, index } = parseArgs();

  if (index >= total || index < 0) {
    console.error('Shard index must be 0 <= index < total');
    process.exit(1);
  }

  const files = getShardFiles(index, total);

  if (files.length === 0) {
    console.log('Shard ' + index + '/' + total + ': no test files assigned');
    process.exit(0);
  }

  console.log('Shard ' + index + '/' + total + ': running ' + files.length + ' test files');
  const filePaths = files.map(f => join(BASE_DIR, f)).join(' ');

  try {
    execSync('node --test ' + filePaths, { stdio: 'inherit', cwd: BASE_DIR });
  } catch (err) {
    process.exit(err.status || 1);
  }
}
