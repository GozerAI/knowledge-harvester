// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #918 — npm Dependency Auto-Update
 *
 * Analyzes npm dependencies for outdated packages, security vulnerabilities,
 * and compatibility issues. Generates update plans and applies safe updates.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Analyze and optionally update npm dependencies.
 * @param {object} [options]
 * @param {string} [options.projectDir]
 * @param {boolean} [options.apply]
 * @returns {Promise<{ outdated: object[], updated: string[], summary: object }>}
 */
export async function autoUpdateDependencies(options = {}) {
  const projectDir = options.projectDir || process.cwd();
  const apply = options.apply || false;

  const pkgPath = join(projectDir, 'package.json');
  if (!existsSync(pkgPath)) {
    return { outdated: [], updated: [], summary: { error: 'package.json not found' } };
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const outdated = await checkOutdated(projectDir);
  const vulnerabilities = await checkVulnerabilities(projectDir);
  const updatePlan = generateUpdatePlan(outdated, vulnerabilities, pkg);

  let updated = [];
  if (apply && updatePlan.safe.length > 0) {
    updated = await applySafeUpdates(projectDir, updatePlan.safe);
  }

  return {
    outdated,
    updated,
    summary: {
      total_deps: countDeps(pkg),
      outdated_count: outdated.length,
      vulnerability_count: vulnerabilities.length,
      safe_updates: updatePlan.safe.length,
      risky_updates: updatePlan.risky.length,
      applied: updated.length,
      checked_at: new Date().toISOString(),
    },
  };
}

/**
 * Check for outdated packages.
 */
async function checkOutdated(projectDir) {
  try {
    const output = execSync('npm outdated --json 2>/dev/null', {
      cwd: projectDir,
      encoding: 'utf8',
      timeout: 30000,
    });
    const data = JSON.parse(output || '{}');
    return Object.entries(data).map(([name, info]) => ({
      name,
      current: info.current,
      wanted: info.wanted,
      latest: info.latest,
      type: info.type || 'dependencies',
    }));
  } catch (err) {
    // npm outdated exits with code 1 when there are outdated packages
    if (err.stdout) {
      try {
        const data = JSON.parse(err.stdout);
        return Object.entries(data).map(([name, info]) => ({
          name,
          current: info.current,
          wanted: info.wanted,
          latest: info.latest,
          type: info.type || 'dependencies',
        }));
      } catch {
        return [];
      }
    }
    return [];
  }
}

/**
 * Check for security vulnerabilities.
 */
async function checkVulnerabilities(projectDir) {
  try {
    const output = execSync('npm audit --json 2>/dev/null', {
      cwd: projectDir,
      encoding: 'utf8',
      timeout: 30000,
    });
    const data = JSON.parse(output || '{}');
    const vulns = [];
    if (data.vulnerabilities) {
      for (const [name, info] of Object.entries(data.vulnerabilities)) {
        vulns.push({
          name,
          severity: info.severity,
          via: Array.isArray(info.via) ? info.via.map(v => typeof v === 'string' ? v : v.title).join(', ') : '',
          fixAvailable: info.fixAvailable,
        });
      }
    }
    return vulns;
  } catch {
    return [];
  }
}

/**
 * Generate an update plan categorizing safe vs risky updates.
 */
function generateUpdatePlan(outdated, vulnerabilities, pkg) {
  const vulnNames = new Set(vulnerabilities.map(v => v.name));
  const safe = [];
  const risky = [];

  for (const dep of outdated) {
    const isMajor = dep.latest && dep.current && dep.latest.split('.')[0] !== dep.current.split('.')[0];
    const hasVuln = vulnNames.has(dep.name);

    if (isMajor) {
      risky.push({ ...dep, reason: 'major_version_bump' });
    } else if (hasVuln) {
      safe.push({ ...dep, reason: 'security_fix', priority: 'high' });
    } else {
      safe.push({ ...dep, reason: 'minor_update', priority: 'low' });
    }
  }

  return { safe, risky };
}

/**
 * Apply safe (non-major) updates.
 */
async function applySafeUpdates(projectDir, safeUpdates) {
  const updated = [];
  for (const dep of safeUpdates) {
    try {
      execSync(`npm install ${dep.name}@${dep.wanted} --save`, {
        cwd: projectDir,
        encoding: 'utf8',
        timeout: 30000,
      });
      updated.push(dep.name);
    } catch {
      // Skip failed updates
    }
  }
  return updated;
}

function countDeps(pkg) {
  return (pkg.dependencies ? Object.keys(pkg.dependencies).length : 0) +
    (pkg.devDependencies ? Object.keys(pkg.devDependencies).length : 0);
}

export { checkOutdated, generateUpdatePlan, countDeps };
