// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Artifact Validator — Per-type validation dispatcher.
 *
 * Provides two public API:
 *   - validateArtifact(artifact)       — validates a single in-memory artifact object
 *   - validateArtifactsBatch(db, limit) — queries DB for untested artifacts, validates and updates them
 *
 * Each type-specific validator returns:
 *   { validation_score: number, ...typeSpecificFields }
 *
 * After validation, the artifact row is updated:
 *   validation_status = 'valid' | 'invalid' | 'warning'
 *   type_metadata.validation_result = { ...result }
 */

import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';

import { validateCodePattern } from './strategies/code-pattern/validator.js';
import { validateApiSpec } from './strategies/api-spec/validator.js';
import { validateInfraConfig } from './strategies/infra-config/validator.js';
import { validateWorkflow } from './strategies/workflow/validator.js';

/**
 * Map of artifact_type → validator function.
 * Each validator receives (content: string, typeMetadata: object) and returns a result object.
 */
const VALIDATOR_REGISTRY = new Map([
  ['code_pattern',  validateCodePattern],
  ['api_spec',      validateApiSpec],
  ['infra_config',  validateInfraConfig],
  ['workflow',      validateWorkflow],
]);

/**
 * Validate a single artifact object.
 *
 * @param {{ artifact_type: string, content: object|string, type_metadata: object }} artifact
 * @returns {{ validation_status: string, validation_result: object }}
 */
export function validateArtifact(artifact) {
  const { artifact_type, content, type_metadata } = artifact;

  const validator = VALIDATOR_REGISTRY.get(artifact_type);
  if (!validator) {
    logger.warn('No validator registered for artifact type', { artifact_type });
    return {
      validation_status: 'untested',
      validation_result: { message: `No validator for type: ${artifact_type}` },
    };
  }

  // Resolve the raw string content. Normalizers store content as { source_code, filename }
  // or sometimes as a plain string. Workflows may store JSON as an object directly.
  const rawContent = extractRawContent(content);
  const meta = normaliseMetadata(type_metadata);

  let result;
  try {
    result = validator(rawContent, meta);
  } catch (err) {
    logger.error('Validator threw an error', { artifact_type, error: err.message });
    return {
      validation_status: 'invalid',
      validation_result: { error: err.message, validation_score: 0 },
    };
  }

  const validation_status = scoreToStatus(result.validation_score ?? 100);

  return { validation_status, validation_result: result };
}

/**
 * Query the database for artifacts with validation_status = 'untested',
 * validate each one, and write the results back.
 *
 * @param {number} [limit=100]
 * @returns {{ validated: number, valid: number, warnings: number, invalid: number }}
 */
export async function validateArtifactsBatch(limit = 100) {
  const result = await db.query(
    `SELECT id, artifact_type, content, type_metadata
     FROM artifacts
     WHERE (type_metadata->>'validation_status' = 'untested'
            OR type_metadata->>'validation_status' IS NULL)
     ORDER BY discovered_at DESC
     LIMIT $1`,
    [limit]
  );

  if (result.rows.length === 0) {
    logger.info('No artifacts pending validation');
    return { validated: 0, valid: 0, warnings: 0, invalid: 0 };
  }

  logger.info(`Validating ${result.rows.length} artifacts`);

  const counts = { validated: 0, valid: 0, warnings: 0, invalid: 0 };

  for (const row of result.rows) {
    const artifact = {
      artifact_type: row.artifact_type,
      content: row.content,
      type_metadata: normaliseMetadata(row.type_metadata),
    };

    const { validation_status, validation_result } = validateArtifact(artifact);

    // Merge validation result into the existing type_metadata
    const updatedMeta = {
      ...artifact.type_metadata,
      validation_status,
      validation_result,
    };

    try {
      await db.query(
        `UPDATE artifacts
         SET type_metadata = $1
         WHERE id = $2`,
        [JSON.stringify(updatedMeta), row.id]
      );
    } catch (dbErr) {
      logger.error('Failed to update validation result', { id: row.id, error: dbErr.message });
      continue;
    }

    counts.validated++;
    if (validation_status === 'valid') counts.valid++;
    else if (validation_status === 'warning') counts.warnings++;
    else counts.invalid++;
  }

  logger.info('Artifact validation batch complete', counts);
  return counts;
}

// ── Helpers ──

/**
 * Pull a string out of whatever shape the content field is in.
 */
function extractRawContent(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  // n8n-style: { nodes: [], connections: {} } — pass the whole object to workflow validator
  if (typeof content === 'object' && !Array.isArray(content)) {
    // Normalised content shape: { source_code: "...", filename: "..." }
    if (typeof content.source_code === 'string') return content.source_code;
    // Raw workflow JSON object — the workflow validator accepts objects
    return content;
  }
  return String(content);
}

/**
 * Ensure type_metadata is a plain object regardless of whether the DB returned
 * it as a JSON string or an already-parsed object.
 */
function normaliseMetadata(meta) {
  if (!meta) return {};
  if (typeof meta === 'string') {
    try { return JSON.parse(meta); } catch { return {}; }
  }
  return meta;
}

/**
 * Map a validation score to a status string.
 *   >= 70 → valid
 *   40-69 → warning
 *   <  40 → invalid
 */
function scoreToStatus(score) {
  if (score >= 70) return 'valid';
  if (score >= 40) return 'warning';
  return 'invalid';
}
