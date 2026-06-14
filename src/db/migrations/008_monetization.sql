-- Migration 008: Monetization — bundles, pricing indexes, license tracking
-- Adds curated bundles table and supporting indexes for marketplace operations.

-- Curated artifact bundles for marketplace
CREATE TABLE IF NOT EXISTS artifact_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(500) NOT NULL,
  slug VARCHAR(200) UNIQUE NOT NULL,
  description TEXT,
  artifact_ids UUID[] NOT NULL DEFAULT '{}',
  artifact_count INTEGER DEFAULT 0,
  artifact_types TEXT[] DEFAULT '{}',
  category VARCHAR(50),
  tags TEXT[] DEFAULT '{}',
  price_tier VARCHAR(20) DEFAULT 'starter',
  suggested_price DECIMAL(10,2) DEFAULT 0.00,
  avg_quality_score INTEGER DEFAULT 0,
  total_value_score INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bundles_category ON artifact_bundles(category);
CREATE INDEX IF NOT EXISTS idx_bundles_price_tier ON artifact_bundles(price_tier);
CREATE INDEX IF NOT EXISTS idx_bundles_status ON artifact_bundles(status);
CREATE INDEX IF NOT EXISTS idx_bundles_tags ON artifact_bundles USING GIN(tags);

-- License tracking for monetized artifacts
CREATE TABLE IF NOT EXISTS artifact_licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id UUID REFERENCES artifacts(id) ON DELETE CASCADE,
  bundle_id UUID REFERENCES artifact_bundles(id) ON DELETE CASCADE,
  license_key VARCHAR(255),
  customer_email VARCHAR(255),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'active',
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_licenses_artifact ON artifact_licenses(artifact_id);
CREATE INDEX IF NOT EXISTS idx_licenses_bundle ON artifact_licenses(bundle_id);
CREATE INDEX IF NOT EXISTS idx_licenses_key ON artifact_licenses(license_key);
CREATE INDEX IF NOT EXISTS idx_licenses_customer ON artifact_licenses(customer_email);

-- Additional indexes for marketplace queries
CREATE INDEX IF NOT EXISTS idx_artifacts_price_tier ON artifacts(price_tier);
CREATE INDEX IF NOT EXISTS idx_artifacts_marketplace ON artifacts USING GIN(marketplace_metadata);

-- Monetization stats materialized view
CREATE MATERIALIZED VIEW IF NOT EXISTS monetization_stats AS
SELECT
  artifact_type,
  price_tier,
  COUNT(*) as artifact_count,
  ROUND(AVG(quality_score)) as avg_quality,
  COUNT(*) FILTER (WHERE publishing_status = 'published') as published_count
FROM artifacts
WHERE price_tier IS NOT NULL
GROUP BY artifact_type, price_tier;

CREATE UNIQUE INDEX IF NOT EXISTS idx_monetization_stats_unique
  ON monetization_stats(artifact_type, price_tier);
