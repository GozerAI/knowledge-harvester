// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Predictive quality decay scoring.
 * Predicts when artifacts become stale based on repo activity + dependency age.
 */

export function predictDecay(artifact) {
  const metadata = artifact.type_metadata || {};
  const now = new Date();

  // Signal 1: Days since last commit
  const lastCommit = metadata.last_commit_date ? new Date(metadata.last_commit_date) : null;
  const daysSinceCommit = lastCommit ? Math.floor((now - lastCommit) / (1000 * 60 * 60 * 24)) : 365;

  // Signal 2: Commit velocity trend (commits per month, negative = slowing)
  const commitVelocity = metadata.commit_velocity ?? 0;

  // Signal 3: Dependency age (average months since last update)
  const dependencyAgeMonths = metadata.dependency_age_months ?? 0;

  // Signal 4: Star velocity (stars per month trend, negative = declining interest)
  const starVelocity = metadata.star_velocity ?? 0;

  // Calculate risk factors
  const riskFactors = {
    days_since_commit: daysSinceCommit,
    commit_velocity: commitVelocity,
    dependency_age_months: dependencyAgeMonths,
    star_velocity: starVelocity,
  };

  // Decay risk formula (0-1):
  // - days_since_commit: 0-1 scaled (0 at 0 days, 1 at 365+ days)
  // - commit_velocity: negative velocity increases risk
  // - dependency_age: older deps = higher risk
  // - star_velocity: declining stars = higher risk
  const commitRecencyRisk = Math.min(daysSinceCommit / 365, 1.0);
  const velocityRisk = commitVelocity < 0 ? Math.min(Math.abs(commitVelocity) / 10, 1.0) : 0;
  const depAgeRisk = Math.min(dependencyAgeMonths / 24, 1.0);
  const starRisk = starVelocity < 0 ? Math.min(Math.abs(starVelocity) / 5, 1.0) : 0;

  // Weighted average
  const decayRisk = (
    commitRecencyRisk * 0.4 +
    velocityRisk * 0.2 +
    depAgeRisk * 0.2 +
    starRisk * 0.2
  );

  const clampedRisk = Math.min(Math.max(decayRisk, 0), 1);

  return {
    decay_risk: Math.round(clampedRisk * 100) / 100,
    risk_factors: riskFactors,
    estimated_stale_date: estimateDecayDate(riskFactors, now),
    predicted_at: now.toISOString(),
  };
}

export function estimateDecayDate(riskFactors, now = new Date()) {
  // Estimate when artifact will become "stale" (decay_risk > 0.7)
  const daysSinceCommit = riskFactors.days_since_commit || 0;
  const commitVelocity = riskFactors.commit_velocity || 0;

  // If already very stale, estimate it's already past
  if (daysSinceCommit >= 365) {
    return now.toISOString().split('T')[0];
  }

  // Estimate days until stale based on velocity
  let daysUntilStale;
  if (commitVelocity <= 0) {
    // Declining or no commits — linear projection
    daysUntilStale = Math.max(365 - daysSinceCommit, 30);
  } else {
    // Active project — extend based on velocity
    daysUntilStale = Math.min(365 - daysSinceCommit + commitVelocity * 30, 730);
  }

  const staleDate = new Date(now);
  staleDate.setDate(staleDate.getDate() + Math.floor(daysUntilStale));
  return staleDate.toISOString().split('T')[0];
}

export async function scoreBatchDecay(db, limit = 100) {
  // Fetch artifacts that have type_metadata but no decay prediction yet, or old prediction
  const result = await db.query(
    `SELECT id, name, type_metadata, quality_score, updated_at
     FROM artifacts
     WHERE type_metadata IS NOT NULL
     ORDER BY updated_at DESC
     LIMIT $1`,
    [limit]
  );

  let processed = 0;
  let atRisk = 0;

  for (const row of result.rows) {
    const artifact = {
      id: row.id,
      name: row.name,
      type_metadata: typeof row.type_metadata === 'string' ? JSON.parse(row.type_metadata) : (row.type_metadata || {}),
      quality_score: row.quality_score,
      updated_at: row.updated_at,
    };

    const prediction = predictDecay(artifact);

    // Store prediction in type_metadata.decay_prediction
    const updatedMetadata = { ...artifact.type_metadata, decay_prediction: prediction };

    await db.query(
      'UPDATE artifacts SET type_metadata = $1 WHERE id = $2',
      [JSON.stringify(updatedMetadata), artifact.id]
    );

    processed++;
    if (prediction.decay_risk >= 0.6) atRisk++;
  }

  return { processed, at_risk: atRisk };
}
