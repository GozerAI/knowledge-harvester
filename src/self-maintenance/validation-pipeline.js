// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #886 — Knowledge Validation Pipeline
 *
 * Multi-stage validation pipeline for artifacts covering schema,
 * content, consistency, completeness, and URL format validation.
 */

const VALIDATION_STAGES = ['schema', 'content', 'consistency', 'completeness', 'url_format'];

/**
 * Validate artifact schema (required fields).
 * @param {object} artifact
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSchema(artifact) {
  const errors = [];
  if (!artifact.id) errors.push('Missing id');
  if (!artifact.artifact_type) errors.push('Missing artifact_type');
  return { valid: errors.length === 0, errors };
}

/**
 * Validate artifact content quality.
 * @param {object} artifact
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateContent(artifact) {
  const errors = [];
  if (!artifact.name || artifact.name.trim().length === 0) errors.push('Empty name');
  if (artifact.name && artifact.name.length > 500) errors.push('Name exceeds 500 chars');
  if (artifact.description && artifact.description.length > 50000) {
    errors.push('Description exceeds 50000 chars');
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validate data consistency.
 * @param {object} artifact
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateConsistency(artifact) {
  const errors = [];
  if (artifact.quality_score != null) {
    if (artifact.quality_score < 0 || artifact.quality_score > 100) {
      errors.push(`Quality score ${artifact.quality_score} out of range [0-100]`);
    }
  }
  if (artifact.created_at && artifact.updated_at) {
    if (new Date(artifact.updated_at) < new Date(artifact.created_at)) {
      errors.push('updated_at is before created_at');
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validate field completeness.
 * @param {object} artifact
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateCompleteness(artifact) {
  const errors = [];
  const requiredFields = ['name', 'artifact_type'];
  for (const field of requiredFields) {
    if (!artifact[field]) errors.push(`Missing required field: ${field}`);
  }
  const warnings = [];
  const desiredFields = ['description', 'primary_category', 'source_url'];
  for (const field of desiredFields) {
    if (!artifact[field]) warnings.push(`Missing recommended field: ${field}`);
  }
  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate URL format.
 * @param {object} artifact
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateUrlFormat(artifact) {
  const errors = [];
  if (artifact.source_url) {
    try {
      const u = new URL(artifact.source_url);
      if (!['http:', 'https:'].includes(u.protocol)) {
        errors.push(`Invalid URL protocol: ${u.protocol}`);
      }
    } catch {
      errors.push(`Malformed URL: ${artifact.source_url}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Run the full validation pipeline on an artifact.
 * @param {object} artifact
 * @returns {{ valid: boolean, stages: object, errors: string[], warnings: string[] }}
 */
export function validateArtifact(artifact) {
  const stages = {
    schema: validateSchema(artifact),
    content: validateContent(artifact),
    consistency: validateConsistency(artifact),
    completeness: validateCompleteness(artifact),
    url_format: validateUrlFormat(artifact),
  };

  const allErrors = [];
  const allWarnings = [];
  let valid = true;

  for (const [, result] of Object.entries(stages)) {
    if (!result.valid) valid = false;
    allErrors.push(...(result.errors || []));
    allWarnings.push(...(result.warnings || []));
  }

  return { valid, stages, errors: allErrors, warnings: allWarnings };
}

/**
 * Batch validate artifacts.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ results: object[], summary: object }>}
 */
export async function batchValidate(db, options = {}) {
  const limit = options.limit || 500;

  const result = await db.query(
    `SELECT id, name, description, artifact_type, primary_category,
            source_url, quality_score, created_at, updated_at
     FROM artifacts ORDER BY updated_at DESC LIMIT $1`,
    [limit]
  );

  const results = result.rows.map(a => ({
    artifact_id: a.id,
    name: a.name,
    ...validateArtifact(a),
  }));

  const validCount = results.filter(r => r.valid).length;

  return {
    results,
    summary: {
      total: results.length,
      valid: validCount,
      invalid: results.length - validCount,
      validation_rate: results.length > 0
        ? Math.round((validCount / results.length) * 100) : 0,
      validated_at: new Date().toISOString(),
    },
  };
}

export { VALIDATION_STAGES };
