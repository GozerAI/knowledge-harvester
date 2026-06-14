-- Migration 012: Community Features
-- Reviews, collections, and contributor stats.

CREATE TABLE IF NOT EXISTS artifact_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id UUID REFERENCES artifacts(id) ON DELETE CASCADE,
  author_name VARCHAR(255) NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_artifact ON artifact_reviews(artifact_id);
CREATE INDEX IF NOT EXISTS idx_reviews_rating ON artifact_reviews(rating);

CREATE TABLE IF NOT EXISTS collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(500) NOT NULL,
  slug VARCHAR(200) UNIQUE NOT NULL,
  description TEXT,
  author_name VARCHAR(255) NOT NULL,
  is_public BOOLEAN DEFAULT TRUE,
  artifact_ids UUID[] DEFAULT '{}',
  artifact_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collections_slug ON collections(slug);
CREATE INDEX IF NOT EXISTS idx_collections_public ON collections(is_public) WHERE is_public = TRUE;

CREATE MATERIALIZED VIEW IF NOT EXISTS contributor_stats AS
SELECT
  author_username,
  COUNT(*) AS artifact_count,
  ROUND(AVG(quality_score)) AS avg_quality,
  array_agg(DISTINCT primary_category) FILTER (WHERE primary_category IS NOT NULL) AS expertise,
  MAX(discovered_at) AS last_contribution
FROM artifacts
WHERE author_username IS NOT NULL
GROUP BY author_username;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contributor_stats_author ON contributor_stats(author_username);
