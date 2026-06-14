// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * #886 — Autonomous Knowledge Validation Pipeline
 *
 * Multi-stage validation pipeline that checks artifacts through
 * schema validation, content checks, and consistency verification.
 */

/**
 * @typedef {object} ValidationStage
 * @property {string} name
 * @property {Function} validate
 */

const VALIDATION_STAGES = [
  { name: 'schema', validate: validateSchema },
  { name: 'content', validate: validateContent },
  { name: 'consistency', validate: validateConsistency },
  { name: 'completeness', validate: validateCompleteness },
  { name: 'url_format', validate: validateUrlFormat },
];

/**
 * Run the full validation pipeline on a batch of artifacts.
 * @param {object} db
 * @param {object} [options]
 * @returns {Promise<{ validated: number, passed: number, failed: number, results: object[], summary: object }>}
 */
export async function runValidationPipeline(db, options = {}) {
  const limit = options.limit || 200;
  const stages = options.stages || VALIDATION_STAGES;

  const result = await db.query(
    `SELECT id, name, description, primary_category, artifact_type,
            source_url, quality_score, tags, type_metadata
     FROM artifacts
     ORDER BY updated_at DESC
     LIMIT $1`,
    [limit]
  );

  const results = [];
  let passed = 0, failed = 0;

  for (const artifact of result.rows) {
    const stageResults = {};
    let allPassed = true;

    for (const stage of stages) {
      const stageResult = stage.validate(artifact);
      stageResults[stage.name] = stageResult;
      if (!stageResult.valid) allPassed = false;
    }

    results.push({
      artifact_id: artifact.id,
      name: artifact.name,
      stages: stageResults,
      overall_valid: allPassed,
    });

    if (allPassed) passed++;
    else failed++;
  }

  return {
    validated: result.rows.length,
    passed,
    failed,
    results,
    summary: {
      total_validated: result.rows.length,
      passed,
      failed,
      pass_rate: result.rows.length > 0 ? Math.round(passed / result.rows.length * 100) : 0,
      stage_failures: summarizeStageFailures(results, stages),
      validated_at: new Date().toISOString(),
    },
  };
}

function validateSchema(artifact) {
  const errors = [];
  if (!artifact.id) errors.push('Missing id');
  if (!artifact.artifact_type) errors.push('Missing artifact_type');
  return { valid: errors.length === 0, errors };
}

function validateContent(artifact) {
  const errors = [];
  if (!artifact.name || artifact.name.trim().length === 0) errors.push('Empty name');
  if (artifact.name && artifact.name.length > 500) errors.push('Name exceeds 500 chars');
  if (artifact.description && artifact.description.length > 50000) errors.push('Description exceeds 50000 chars');
  return { valid: errors.length === 0, errors };
}

function validateConsistency(artifact) {
  const errors = [];
  if (artifact.quality_score != null) {
    if (artifact.quality_score < 0 || artifact.quality_score > 100) {
      errors.push(`Quality score ${artifact.quality_score} out of range [0-100]`);
    }
  }
  return { valid: errors.length === 0, errors };
}

function validateCompleteness(artifact) {
  const errors = [];
  const requiredFields = ['name', 'artifact_type'];
  for (const field of requiredFields) {
    if (!artifact[field]) errors.push(`Missing required field: ${field}`);
  }

  const desiredFields = ['description', 'primary_category', 'source_url'];
  const warnings = [];
  for (const field of desiredFields) {
    if (!artifact[field]) warnings.push(`Missing recommended field: ${field}`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateUrlFormat(artifact) {
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

function summarizeStageFailures(results, stages) {
  const summary = {};
  for (const stage of stages) {
    const failures = results.filter(r => r.stages[stage.name] && !r.stages[stage.name].valid).length;
    summary[stage.name] = failures;
  }
  return summary;
}

export {
  VALIDATION_STAGES,
  validateSchema,
  validateContent,
  validateConsistency,
  validateCompleteness,
  validateUrlFormat,
};
