// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * API Spec Validator — Linting and validation for API specification artifacts.
 *
 * Checks:
 *   - Required OpenAPI fields (openapi version, info object, paths object)
 *   - Path parameter consistency (params in URL template match defined params)
 *   - Schema $ref validity (all $ref pointers resolve to existing definitions)
 *
 * Returns a validation result with a score 0-100.
 */

/**
 * Validate an API spec artifact.
 *
 * @param {string} content - Raw spec file content (YAML or JSON text)
 * @param {object} typeMetadata - Existing type_metadata from normalization
 * @returns {{ openapi_version: string|null, has_info: boolean, paths_count: number, schema_issues: string[], validation_score: number }}
 */
export function validateApiSpec(content, typeMetadata) {
  const src = content || '';
  const schema_issues = [];

  // Only perform deep OpenAPI validation for openapi/swagger specs
  const specType = typeMetadata?.spec_type || detectOpenApiPresence(src);

  const openapi_version = extractOpenApiVersion(src);
  const has_info = /\binfo\s*:/m.test(src);

  // Count paths entries (lines that look like "  /something:" at 2-space indent)
  const pathLines = src.match(/^\s{2}\/[^\s:]+:/gm) || [];
  const paths_count = pathLines.length;

  if (specType === 'openapi') {
    // ── Required top-level fields ──
    if (!openapi_version) {
      schema_issues.push('Missing or unrecognised openapi/swagger version field');
    }
    if (!has_info) {
      schema_issues.push('Missing required "info" object');
    }
    if (paths_count === 0 && !/\bpaths\s*:/m.test(src)) {
      schema_issues.push('Missing required "paths" object');
    }

    // ── Path parameter consistency ──
    const pathParamIssues = checkPathParameterConsistency(src);
    schema_issues.push(...pathParamIssues);

    // ── $ref validity ──
    const refIssues = checkSchemaRefs(src);
    schema_issues.push(...refIssues);
  }

  const validation_score = calculateApiSpecValidationScore({
    openapi_version,
    has_info,
    paths_count,
    schema_issues,
    specType,
  });

  return { openapi_version, has_info, paths_count, schema_issues, validation_score };
}

/**
 * Detect whether content looks like an OpenAPI spec when type_metadata is absent.
 */
function detectOpenApiPresence(src) {
  if (/openapi['":\s]+['"]*3\./i.test(src) || /swagger['":\s]+['"]*2\./i.test(src)) return 'openapi';
  if (/\bpaths\s*:/.test(src) && /\binfo\s*:/.test(src)) return 'openapi';
  return 'other';
}

/**
 * Extract the openapi/swagger version string.
 */
function extractOpenApiVersion(src) {
  return (
    src.match(/openapi\s*:\s*['"]*(\d+\.\d+[.\d]*)/i)?.[1] ||
    src.match(/swagger\s*:\s*['"]*(\d+\.\d+[.\d]*)/i)?.[1] ||
    null
  );
}

/**
 * Check that parameters declared in path templates (e.g. /users/{id})
 * are also listed under the path's or operation's parameters array.
 *
 * This is a text-heuristic pass; it will not catch every case but will
 * surface obvious mismatches.
 */
function checkPathParameterConsistency(src) {
  const issues = [];

  // Find all path entries with template params: "  /some/{param}:"
  const pathEntries = src.match(/^\s{2}(\/[^\s:]+):/gm) || [];

  for (const entry of pathEntries) {
    const pathTemplate = entry.trim().replace(/:$/, '');
    const templateParams = (pathTemplate.match(/\{(\w+)\}/g) || [])
      .map(p => p.slice(1, -1));

    if (templateParams.length === 0) continue;

    // Find the block of content following this path line
    // We look ahead in the full source for "in: path" parameter definitions
    const escapedPath = pathTemplate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pathBlockMatch = src.match(
      new RegExp(`${escapedPath}:\\s*\\n([\\s\\S]*?)(?=\\n\\s{2}\\/|\\Z)`)
    );

    if (!pathBlockMatch) continue;
    const pathBlock = pathBlockMatch[1];

    // Find params declared with "in: path" in this block
    const declaredParamNames = [];
    const inPathBlocks = pathBlock.match(/in:\s*path[\s\S]*?name:\s*(\w+)/g) || [];
    const nameFirst = pathBlock.match(/name:\s*(\w+)[\s\S]*?in:\s*path/g) || [];

    for (const b of [...inPathBlocks, ...nameFirst]) {
      const n = b.match(/name:\s*(\w+)/)?.[1];
      if (n) declaredParamNames.push(n);
    }

    for (const param of templateParams) {
      if (declaredParamNames.length > 0 && !declaredParamNames.includes(param)) {
        issues.push(`Path param {${param}} in "${pathTemplate}" not found in declared parameters`);
      }
    }
  }

  return issues;
}

/**
 * Check that all $ref values in the document resolve to a definition that
 * exists in the same document.
 *
 * Only validates local refs starting with "#/".
 */
function checkSchemaRefs(src) {
  const issues = [];

  // Collect all local $ref values
  const refMatches = src.match(/\$ref\s*:\s*['"]?(#\/[^'"\s]+)/g) || [];
  const refs = refMatches.map(r => r.match(/#\/([^'"\s]+)/)?.[1]).filter(Boolean);

  if (refs.length === 0) return issues;

  // Build a set of known definition paths from the document.
  // We collect names under components/schemas, definitions, and responses.
  const knownPaths = new Set();

  const definitionSections = [
    { pattern: /components\/schemas\s*:\s*\n([\s\S]*?)(?=\n\s{0,2}\w|\Z)/m, prefix: 'components/schemas' },
    { pattern: /components\/responses\s*:\s*\n([\s\S]*?)(?=\n\s{0,2}\w|\Z)/m, prefix: 'components/responses' },
    { pattern: /components\/parameters\s*:\s*\n([\s\S]*?)(?=\n\s{0,2}\w|\Z)/m, prefix: 'components/parameters' },
    { pattern: /definitions\s*:\s*\n([\s\S]*?)(?=\n\s{0,2}\w|\Z)/m, prefix: 'definitions' },
  ];

  for (const { pattern, prefix } of definitionSections) {
    const sectionMatch = src.match(pattern);
    if (!sectionMatch) continue;
    const names = sectionMatch[1].match(/^\s{4}(\w[\w-]*):/gm) || [];
    for (const n of names) {
      knownPaths.add(`${prefix}/${n.trim().replace(':', '')}`);
    }
  }

  // If we found no definitions at all, skip ref validation (spec might be YAML we can't parse)
  if (knownPaths.size === 0) return issues;

  const reported = new Set();
  for (const ref of refs) {
    if (!knownPaths.has(ref) && !reported.has(ref)) {
      issues.push(`Unresolved $ref: #/${ref}`);
      reported.add(ref);
    }
  }

  return issues;
}

/**
 * Calculate validation score for an API spec (0-100).
 */
function calculateApiSpecValidationScore({ openapi_version, has_info, paths_count, schema_issues, specType }) {
  if (specType !== 'openapi') {
    // Non-OpenAPI specs (GraphQL, gRPC, AsyncAPI) — base pass score
    return schema_issues.length === 0 ? 85 : Math.max(0, 85 - schema_issues.length * 10);
  }

  let score = 100;

  if (!openapi_version) score -= 25;
  if (!has_info) score -= 20;
  if (paths_count === 0) score -= 15;

  // Each schema issue deducts up to a total of -40
  score -= Math.min(schema_issues.length * 8, 40);

  return Math.max(0, Math.min(100, score));
}
