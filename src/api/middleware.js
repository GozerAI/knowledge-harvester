// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * API middleware utilities for Knowledge Harvester.
 *
 * Pure utility functions — no DB access, no side effects.
 * Used by all route handlers for consistent request/response handling.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate a UUID string.
 * @param {string} id
 * @returns {boolean}
 */
export function validateUUID(id) {
  if (typeof id !== 'string') return false;
  return UUID_REGEX.test(id);
}

/**
 * Validate that all required fields are present in a body object.
 * @param {object} body
 * @param {string[]} requiredFields
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateBody(body, requiredFields) {
  const errors = [];

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: ['Request body must be a JSON object'] };
  }

  for (const field of requiredFields) {
    if (body[field] === undefined || body[field] === null || body[field] === '') {
      errors.push(`Missing required field: ${field}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Parse pagination query params with sane defaults.
 * @param {URLSearchParams} params
 * @returns {{ limit: number, offset: number }}
 */
export function parsePagination(params) {
  const rawLimit = parseInt(params.get('limit') || '20', 10);
  const rawOffset = parseInt(params.get('offset') || '0', 10);

  const limit = Math.min(isNaN(rawLimit) || rawLimit < 1 ? 20 : rawLimit, 100);
  const offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

  return { limit, offset };
}

/**
 * Parse filter query params against an allowlist of field names.
 * Only fields in allowedFields are included — everything else is dropped.
 * @param {URLSearchParams} params
 * @param {string[]} allowedFields
 * @returns {object}
 */
export function parseFilters(params, allowedFields) {
  const filters = {};

  for (const field of allowedFields) {
    const value = params.get(field);
    if (value !== null && value !== '') {
      filters[field] = value;
    }
  }

  return filters;
}

/**
 * Write a JSON response.
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {any} data
 */
export function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}
