// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Research gap analysis routes for the autonomous research agent.
 */

import { db } from '../db/client.js';

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export async function handleResearchGaps(req, res) {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');

    const { category, priority } = body;

    if (!category) {
      return json(res, 400, { error: 'category is required' });
    }

    // Count existing artifacts in this category
    const countResult = await db.query(
      'SELECT COUNT(*) as count FROM artifacts WHERE primary_category = $1',
      [category]
    );
    const existingCount = parseInt(countResult.rows[0]?.count || 0);

    // Get related categories
    const relatedResult = await db.query(
      `SELECT DISTINCT primary_category, COUNT(*) as count
       FROM artifacts
       WHERE primary_category IS NOT NULL
       GROUP BY primary_category
       ORDER BY count DESC
       LIMIT 10`
    );

    const response = {
      category,
      priority: priority || 'medium',
      existing_artifacts: existingCount,
      status: existingCount < 3 ? 'gap_confirmed' : 'sufficient',
      related_categories: relatedResult.rows.map(r => ({
        category: r.primary_category,
        artifact_count: parseInt(r.count),
      })),
      recommendation: existingCount === 0
        ? `Critical gap: No artifacts in ${category}. Recommend immediate harvesting.`
        : existingCount < 3
          ? `Low coverage in ${category}. ${existingCount} artifacts found. Recommend targeted harvesting.`
          : `Sufficient coverage in ${category}. ${existingCount} artifacts available.`,
    };

    json(res, 200, response);
  } catch (err) {
    json(res, 500, { error: 'Research gap analysis failed' });
  }
}
