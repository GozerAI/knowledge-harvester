-- Migration 007: Generalized artifact model
-- Transforms the workflow-centric model into a universal knowledge artifact system.
-- Existing workflows table remains untouched; new artifacts table handles all types.

-- Enable pgvector if not already enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- Core artifacts table
CREATE TABLE IF NOT EXISTS artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hash VARCHAR(64) UNIQUE NOT NULL,
  artifact_type VARCHAR(30) NOT NULL,

  -- Discovery
  source VARCHAR(50) NOT NULL,
  source_url TEXT NOT NULL,
  source_id VARCHAR(255) NOT NULL,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Content
  content JSONB NOT NULL,
  name VARCHAR(500) NOT NULL,
  description TEXT,

  -- Attribution
  author_username VARCHAR(255),
  author_profile_url TEXT,

  -- Universal metadata
  language TEXT,
  tool_type TEXT,
  tool_metadata JSONB DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',

  -- Type-specific metadata (schema varies by artifact_type)
  type_metadata JSONB DEFAULT '{}',

  -- Classification
  primary_category VARCHAR(50),
  secondary_categories TEXT[] DEFAULT '{}',

  -- Quality & Scoring
  quality_score INTEGER DEFAULT 0,
  complexity_score INTEGER DEFAULT 0,
  complexity_breakdown JSONB DEFAULT '{}',

  -- Validation
  has_description BOOLEAN DEFAULT FALSE,
  has_documentation BOOLEAN DEFAULT FALSE,
  is_complete BOOLEAN DEFAULT TRUE,
  validation_status VARCHAR(20) DEFAULT 'untested',

  -- Publishing / Monetization
  publishing_status VARCHAR(20) DEFAULT 'raw',
  enriched_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  price_tier VARCHAR(20),
  marketplace_metadata JSONB DEFAULT '{}',

  -- Embeddings
  embedding vector(768),
  embedded_at TIMESTAMPTZ,

  -- Full-text search
  search_vector tsvector,

  UNIQUE(source, source_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_artifacts_type ON artifacts(artifact_type);
CREATE INDEX IF NOT EXISTS idx_artifacts_source ON artifacts(source);
CREATE INDEX IF NOT EXISTS idx_artifacts_category ON artifacts(primary_category);
CREATE INDEX IF NOT EXISTS idx_artifacts_quality ON artifacts(quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_tags ON artifacts USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_artifacts_type_metadata ON artifacts USING GIN(type_metadata);
CREATE INDEX IF NOT EXISTS idx_artifacts_publishing ON artifacts(publishing_status);
CREATE INDEX IF NOT EXISTS idx_artifacts_discovered ON artifacts(discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_tool_type ON artifacts(tool_type);

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_artifacts_search ON artifacts USING GIN(search_vector);

-- Vector similarity index (HNSW for fast cosine search)
CREATE INDEX IF NOT EXISTS idx_artifacts_embedding ON artifacts
  USING hnsw(embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- Full-text search trigger
CREATE OR REPLACE FUNCTION artifacts_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    coalesce(NEW.name, '') || ' ' ||
    coalesce(NEW.description, '') || ' ' ||
    coalesce(array_to_string(NEW.tags, ' '), '') || ' ' ||
    coalesce(NEW.tool_type, '') || ' ' ||
    coalesce(NEW.artifact_type, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_artifacts_search ON artifacts;
CREATE TRIGGER trg_artifacts_search
  BEFORE INSERT OR UPDATE OF name, description, tags, tool_type, artifact_type
  ON artifacts FOR EACH ROW
  EXECUTE FUNCTION artifacts_search_vector_update();

-- Generalized supporting tables

CREATE TABLE IF NOT EXISTS artifact_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id UUID UNIQUE REFERENCES artifacts(id) ON DELETE CASCADE,
  bundle JSONB NOT NULL,
  dependencies TEXT[] DEFAULT '{}',
  estimated_setup_minutes INTEGER DEFAULT 15,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  package_version INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_artifact_packages_artifact ON artifact_packages(artifact_id);

CREATE TABLE IF NOT EXISTS artifact_guides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id UUID UNIQUE REFERENCES artifacts(id) ON DELETE CASCADE,
  package_id UUID REFERENCES artifact_packages(id) ON DELETE CASCADE,
  guide_markdown TEXT NOT NULL,
  word_count INTEGER DEFAULT 0,
  section_count INTEGER DEFAULT 0,
  quality_score INTEGER DEFAULT 0,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  guide_version INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_artifact_guides_artifact ON artifact_guides(artifact_id);
CREATE INDEX IF NOT EXISTS idx_artifact_guides_quality ON artifact_guides(quality_score DESC);

CREATE TABLE IF NOT EXISTS artifact_duplicates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id UUID REFERENCES artifacts(id) ON DELETE CASCADE,
  duplicate_of UUID REFERENCES artifacts(id) ON DELETE CASCADE,
  similarity_score DECIMAL(5,4) NOT NULL,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(artifact_id, duplicate_of)
);

CREATE TABLE IF NOT EXISTS artifact_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID REFERENCES artifacts(id) ON DELETE CASCADE,
  target_id UUID REFERENCES artifacts(id) ON DELETE CASCADE,
  relation_type VARCHAR(30) NOT NULL,
  metadata JSONB DEFAULT '{}',
  confidence DECIMAL(3,2) DEFAULT 0.0,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_id, target_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_artifact_relations_source ON artifact_relations(source_id);
CREATE INDEX IF NOT EXISTS idx_artifact_relations_target ON artifact_relations(target_id);
CREATE INDEX IF NOT EXISTS idx_artifact_relations_type ON artifact_relations(relation_type);

-- Widen source column on legacy tables for longer source names
ALTER TABLE workflows ALTER COLUMN source TYPE VARCHAR(50);
ALTER TABLE harvest_runs ALTER COLUMN source TYPE VARCHAR(50);

-- Artifact facets materialized view
CREATE MATERIALIZED VIEW IF NOT EXISTS artifact_facets AS
SELECT
  artifact_type, tool_type, primary_category, language,
  COUNT(*) as artifact_count, ROUND(AVG(quality_score)) as avg_quality
FROM artifacts WHERE quality_score > 0
GROUP BY artifact_type, tool_type, primary_category, language;

CREATE UNIQUE INDEX IF NOT EXISTS idx_artifact_facets_unique
  ON artifact_facets(artifact_type, tool_type, primary_category, language);
