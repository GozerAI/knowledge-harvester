// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';

/**
 * Faceted Search — Provides aggregated facet data and filtered queries
 * against the workflow_facets materialized view.
 *
 * The materialized view groups workflows by tool_type, primary_category,
 * estimated_complexity, and language with counts and average quality.
 */

/**
 * Refresh the materialized view and return the updated facet data.
 *
 * @returns {{ facets: object[], refreshed_at: string }}
 */
export async function refreshFacets() {
  logger.info('Refreshing workflow_facets materialized view');

  await db.query('REFRESH MATERIALIZED VIEW CONCURRENTLY workflow_facets');

  const result = await db.query(
    `SELECT tool_type, primary_category, estimated_complexity, language,
            workflow_count, avg_quality
     FROM workflow_facets
     ORDER BY workflow_count DESC`
  );

  const refreshedAt = new Date().toISOString();
  logger.info('Facets refreshed', { count: result.rows.length });

  return { facets: result.rows, refreshed_at: refreshedAt };
}

/**
 * Query the materialized view for current facet data without refreshing.
 *
 * @returns {{ facets: object[] }}
 */
export async function getFacets() {
  const result = await db.query(
    `SELECT tool_type, primary_category, estimated_complexity, language,
            workflow_count, avg_quality
     FROM workflow_facets
     ORDER BY workflow_count DESC`
  );

  return { facets: result.rows };
}

/**
 * Search workflows using faceted filters.
 *
 * @param {object} params
 * @param {string} [params.tool_type] - Filter by tool type
 * @param {string} [params.category] - Filter by primary_category
 * @param {string} [params.complexity] - Filter by estimated_complexity
 * @param {string} [params.language] - Filter by language
 * @param {number} [params.limit=25] - Max results to return
 * @returns {{ workflows: object[], total: number }}
 */
export async function searchByFacets({ tool_type, category, complexity, language, limit = 25 } = {}) {
  const conditions = ['quality_score > 0'];
  const params = [];
  let paramIdx = 0;

  if (tool_type) {
    paramIdx++;
    conditions.push(`tool_type = $${paramIdx}`);
    params.push(tool_type);
  }

  if (category) {
    paramIdx++;
    conditions.push(`primary_category = $${paramIdx}`);
    params.push(category);
  }

  if (complexity) {
    paramIdx++;
    conditions.push(`estimated_complexity = $${paramIdx}`);
    params.push(complexity);
  }

  if (language) {
    paramIdx++;
    conditions.push(`language = $${paramIdx}`);
    params.push(language);
  }

  const whereClause = conditions.join(' AND ');

  // Get total count for the filter
  const countResult = await db.query(
    `SELECT COUNT(*) as total FROM workflows WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].total, 10);

  // Get paginated results
  paramIdx++;
  params.push(limit);
  const result = await db.query(
    `SELECT id, workflow_name, tool_type, primary_category,
            estimated_complexity, language, quality_score,
            complexity_score, original_description, tags
     FROM workflows
     WHERE ${whereClause}
     ORDER BY quality_score DESC
     LIMIT $${paramIdx}`,
    params
  );

  logger.debug('Faceted search', { filters: { tool_type, category, complexity, language }, total });

  return { workflows: result.rows, total };
}
