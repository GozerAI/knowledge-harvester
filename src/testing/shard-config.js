// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Parallel test sharding for Node.js test runner (item #244).
 *
 * Splits test files across multiple worker processes for parallel execution.
 * Supports round-robin, file-size, and historical-duration strategies.
 * Designed for node --test runner (not Jest, since this project uses node:test).
 */

import { readFileSync, statSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { execSync } from 'node:child_process';

/**
 * Discover all test files matching patterns in the given directories.
 * @param {string[]} testDirs - Directories to scan
 * @param {string} [pattern='.test.js'] - File suffix filter
 * @returns {string[]} Absolute paths of test files
 */
export function discoverTestFiles(testDirs, pattern = '.test.js') {
  const files = [];

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(pattern)) {
        files.push(full);
      }
    }
  }

  for (const dir of testDirs) {
    walk(resolve(dir));
  }

  return files.sort();
}

/**
 * @typedef {'round-robin'|'file-size'|'duration'} ShardStrategy
 */

/**
 * Split test files into N shards for parallel execution.
 * @param {string[]} files - Test file paths
 * @param {number} shardCount - Number of shards
 * @param {object} [options]
 * @param {ShardStrategy} [options.strategy='file-size']
 * @param {object} [options.durations] - Map of file -> historical duration in ms
 * @returns {Array<string[]>} Array of shard arrays
 */
export function shardTestFiles(files, shardCount, { strategy = 'file-size', durations = {} } = {}) {
  if (shardCount <= 0) throw new Error('shardCount must be positive');
  if (files.length === 0) return Array.from({ length: shardCount }, () => []);

  const effectiveShards = Math.min(shardCount, files.length);
  const shards = Array.from({ length: effectiveShards }, () => []);

  if (strategy === 'round-robin') {
    // Simple round-robin assignment
    for (let i = 0; i < files.length; i++) {
      shards[i % effectiveShards].push(files[i]);
    }
  } else if (strategy === 'file-size') {
    // Assign largest files first to the shard with least total weight (greedy)
    const weighted = files.map(f => {
      let size = 0;
      try { size = statSync(f).size; } catch {}
      return { file: f, weight: size };
    }).sort((a, b) => b.weight - a.weight);

    const shardWeights = new Array(effectiveShards).fill(0);

    for (const { file, weight } of weighted) {
      // Find shard with minimum total weight
      let minIdx = 0;
      for (let i = 1; i < effectiveShards; i++) {
        if (shardWeights[i] < shardWeights[minIdx]) {
          minIdx = i;
        }
      }
      shards[minIdx].push(file);
      shardWeights[minIdx] += weight;
    }
  } else if (strategy === 'duration') {
    // Assign by historical test duration (greedy load balancing)
    const weighted = files.map(f => ({
      file: f,
      weight: durations[f] || durations[relative('.', f)] || 1000,
    })).sort((a, b) => b.weight - a.weight);

    const shardWeights = new Array(effectiveShards).fill(0);

    for (const { file, weight } of weighted) {
      let minIdx = 0;
      for (let i = 1; i < effectiveShards; i++) {
        if (shardWeights[i] < shardWeights[minIdx]) {
          minIdx = i;
        }
      }
      shards[minIdx].push(file);
      shardWeights[minIdx] += weight;
    }
  } else {
    throw new Error(`Unknown shard strategy: ${strategy}`);
  }

  // Pad with empty shards if needed
  while (shards.length < shardCount) {
    shards.push([]);
  }

  return shards;
}

/**
 * Generate a shell command to run a specific shard.
 * @param {string[]} files - Files in this shard
 * @param {object} [options]
 * @param {number} [options.shardIndex=0]
 * @param {number} [options.concurrency=1] - Node test runner concurrency
 * @returns {string}
 */
export function buildShardCommand(files, { shardIndex = 0, concurrency = 1 } = {}) {
  if (files.length === 0) return 'echo "Shard empty, nothing to run"';
  const fileList = files.join(' ');
  return `node --test --test-concurrency=${concurrency} ${fileList}`;
}

/**
 * Load historical test durations from a JSON file.
 * @param {string} filePath
 * @returns {object} Map of file path -> duration in ms
 */
export function loadDurations(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Save test durations to a JSON file for future shard optimization.
 * @param {string} filePath
 * @param {object} durations - Map of file -> duration in ms
 */
export function saveDurations(filePath, durations) {
  writeFileSync(filePath, JSON.stringify(durations, null, 2));
}

/**
 * Full shard runner: discover, shard, and generate commands.
 * @param {object} options
 * @param {string[]} options.testDirs - Directories to scan
 * @param {number} options.shardCount - Number of parallel shards
 * @param {ShardStrategy} [options.strategy='file-size']
 * @param {string} [options.durationsFile] - Path to durations JSON
 * @param {number} [options.concurrency=1]
 * @returns {{ shards: Array<{ index: number, files: string[], command: string }>, totalFiles: number }}
 */
export function buildShardPlan({
  testDirs,
  shardCount,
  strategy = 'file-size',
  durationsFile = null,
  concurrency = 1,
}) {
  const files = discoverTestFiles(testDirs);
  const durations = durationsFile ? loadDurations(durationsFile) : {};

  const shards = shardTestFiles(files, shardCount, { strategy, durations });

  return {
    totalFiles: files.length,
    shards: shards.map((files, index) => ({
      index,
      files,
      command: buildShardCommand(files, { shardIndex: index, concurrency }),
    })),
  };
}

/**
 * Execute shards in parallel as child processes.
 * @param {Array<{ command: string, index: number }>} shards
 * @returns {Array<{ index: number, exitCode: number, output: string }>}
 */
export function executeShards(shards) {
  const results = [];

  for (const shard of shards) {
    if (shard.files && shard.files.length === 0) {
      results.push({ index: shard.index, exitCode: 0, output: 'Shard empty' });
      continue;
    }

    try {
      const output = execSync(shard.command, {
        encoding: 'utf-8',
        timeout: 300_000, // 5 minute timeout per shard
        stdio: 'pipe',
      });
      results.push({ index: shard.index, exitCode: 0, output });
    } catch (err) {
      results.push({
        index: shard.index,
        exitCode: err.status || 1,
        output: err.stdout || err.message,
      });
    }
  }

  return results;
}
