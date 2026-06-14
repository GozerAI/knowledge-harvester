// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #705 — Autonomous Data Quality Improvement
 *
 * Scans artifacts for quality issues, applies automatic fixes where safe,
 * and tracks quality improvement over time.
 */

/**
 * @typedef {object} QualityIssue
 * @property {string} artifact_id
 * @property {string} issue_type
 * @property {string} severity - 'critical' | 'high' | 'medium' | 'low'
 * @property {string} description
 * @property {boolean} auto_fixable
 * @property {object|null} fix
 */

const ISSUE_CHECKS = [
  { name: 'missing_name', check: checkMissingName, severity: 'critical', fixable: true },
  { name: 'missing_description', check: checkMissingDescription, severity: 'high', fixable: true },
  { name: 'missing_category', check: checkMissingCategory, severity: 'high', fixable: false },
  { name: 'missing_source_url', check: checkMissingSourceUrl, severity: 'medium', fixable: false },
  { name: 'low_quality_name', check: checkLowQualityName, severity: 'medium', fixable: true },
  { name: 'duplicate_name', check: checkDuplicateName, severity: 'low', fixable: false },
  { name: 'missing_tags', check: checkMissingTags, severity: 'low', fixable: true },
  { name: 'invalid_url', check: checkInvalidUrl, severity: 'medium', fixable: false },
  { name: 'empty_metadata', check: checkEmptyMetadata, severity: 'low', fixable: false },
  { name: 'quality_score_missing', check: checkMissingQualityScore, severity: 'medium', fixable: false },
];

/**
 * Scan artifacts for quality issues.
 * @param {object} db
 * @param {object} [options]
 * @param {number} [options.limit]
 * @returns {Promise<{ issues: QualityIssue[], fixed: number, summary: object }>}
 */
export async function improveDataQuality(db, options = {}) {
  const limit = options.limit || 200;
  const autoFix = options.autoFix !== false;

  const result = await db.query(
    `SELECT id, name, description, primary_category, source_url,
            tags, type_metadata, quality_score, artifact_type
     FROM artifacts
     ORDER BY quality_score ASC NULLS FIRST
     LIMIT $1`,
    [limit]
  );

  const allIssues = [];
  let fixed = 0;

  for (const artifact of result.rows) {
    for (const check of ISSUE_CHECKS) {
      const issue = check.check(artifact);
      if (issue) {
        const qualityIssue = {
          artifact_id: artifact.id,
          issue_type: check.name,
          severity: check.severity,
          description: issue.description,
          auto_fixable: check.fixable && !!issue.fix,
          fix: issue.fix || null,
        };
        allIssues.push(qualityIssue);

        if (autoFix && qualityIssue.auto_fixable && issue.fix) {
          const didFix = await applyFix(db, artifact.id, issue.fix);
          if (didFix) fixed++;
        }
      }
    }
  }

  const summary = {
    scanned: result.rows.length,
    total_issues: allIssues.length,
    auto_fixed: fixed,
    by_severity: countBy(allIssues, 'severity'),
    by_type: countBy(allIssues, 'issue_type'),
    scanned_at: new Date().toISOString(),
  };

  return { issues: allIssues, fixed, summary };
}

/**
 * Apply a quality fix to an artifact.
 */
async function applyFix(db, artifactId, fix) {
  try {
    const sets = [];
    const values = [artifactId];
    let idx = 2;

    for (const [key, value] of Object.entries(fix)) {
      sets.push(`${key} = $${idx}`);
      values.push(value);
      idx++;
    }

    if (sets.length === 0) return false;

    await db.query(
      `UPDATE artifacts SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`,
      values
    );
    return true;
  } catch {
    return false;
  }
}

// ── Individual Check Functions ──

function checkMissingName(artifact) {
  if (!artifact.name || artifact.name.trim() === '') {
    return {
      description: 'Artifact has no name',
      fix: { name: `untitled-${artifact.artifact_type || 'artifact'}-${artifact.id}` },
    };
  }
  return null;
}

function checkMissingDescription(artifact) {
  if (!artifact.description || artifact.description.trim().length < 10) {
    const autoDesc = artifact.name
      ? `${artifact.artifact_type || 'Artifact'}: ${artifact.name}`
      : null;
    return {
      description: 'Artifact has no or very short description',
      fix: autoDesc ? { description: autoDesc } : null,
    };
  }
  return null;
}

function checkMissingCategory(artifact) {
  if (!artifact.primary_category) {
    return { description: 'Artifact has no primary category' };
  }
  return null;
}

function checkMissingSourceUrl(artifact) {
  if (!artifact.source_url) {
    return { description: 'Artifact has no source URL' };
  }
  return null;
}

function checkLowQualityName(artifact) {
  if (!artifact.name) return null;
  const name = artifact.name.trim();
  // Names that are just IDs or too short
  if (name.length < 4 || /^[a-f0-9-]+$/i.test(name)) {
    return {
      description: `Artifact name "${name}" appears to be an ID or too short`,
      fix: null,
    };
  }
  // Names that are all uppercase
  if (name === name.toUpperCase() && name.length > 5) {
    return {
      description: `Artifact name "${name}" is all uppercase`,
      fix: { name: titleCase(name) },
    };
  }
  return null;
}

function checkDuplicateName(artifact) {
  // This is a structural check — actual duplicate detection is done at batch level
  return null;
}

function checkMissingTags(artifact) {
  const tags = artifact.tags;
  if (!tags || (Array.isArray(tags) && tags.length === 0)) {
    // Auto-generate tags from name
    if (artifact.name) {
      const autoTags = artifact.name
        .toLowerCase()
        .split(/[\s\-_/]+/)
        .filter(w => w.length > 3)
        .slice(0, 5);
      if (autoTags.length > 0) {
        return {
          description: 'Artifact has no tags',
          fix: { tags: JSON.stringify(autoTags) },
        };
      }
    }
    return { description: 'Artifact has no tags', fix: null };
  }
  return null;
}

function checkInvalidUrl(artifact) {
  if (!artifact.source_url) return null;
  try {
    new URL(artifact.source_url);
    return null;
  } catch {
    return { description: `Invalid source URL: ${artifact.source_url}` };
  }
}

function checkEmptyMetadata(artifact) {
  if (!artifact.type_metadata ||
      (typeof artifact.type_metadata === 'object' && Object.keys(artifact.type_metadata).length === 0)) {
    return { description: 'Artifact has empty type_metadata' };
  }
  return null;
}

function checkMissingQualityScore(artifact) {
  if (artifact.quality_score == null) {
    return { description: 'Artifact has no quality score' };
  }
  return null;
}

function titleCase(str) {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function countBy(arr, field) {
  const counts = {};
  for (const item of arr) {
    const val = item[field];
    counts[val] = (counts[val] || 0) + 1;
  }
  return counts;
}

/**
 * Get a quality report for the knowledge base.
 */
export async function getQualityReport(db) {
  const result = await db.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE quality_score IS NULL)::int AS no_score,
       COUNT(*) FILTER (WHERE quality_score < 30)::int AS low_quality,
       COUNT(*) FILTER (WHERE quality_score >= 30 AND quality_score < 70)::int AS medium_quality,
       COUNT(*) FILTER (WHERE quality_score >= 70)::int AS high_quality,
       COUNT(*) FILTER (WHERE name IS NULL OR name = '')::int AS no_name,
       COUNT(*) FILTER (WHERE description IS NULL OR length(description) < 10)::int AS no_desc,
       COUNT(*) FILTER (WHERE primary_category IS NULL)::int AS no_category,
       COUNT(*) FILTER (WHERE source_url IS NULL)::int AS no_source_url,
       ROUND(AVG(quality_score)::numeric, 2)::float AS avg_quality
     FROM artifacts`
  );
  return result.rows[0] || {};
}

// Export internals for testing
export { ISSUE_CHECKS, checkMissingName, checkMissingDescription, checkLowQualityName, checkMissingTags, checkInvalidUrl, titleCase };
