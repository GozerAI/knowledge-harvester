-- Knowledge Harvester Database Schema
-- Run with: npm run migrate

-- Main workflows table
CREATE TABLE IF NOT EXISTS workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hash VARCHAR(64) UNIQUE NOT NULL,
  source VARCHAR(20) NOT NULL,
  source_url TEXT NOT NULL,
  source_id VARCHAR(255) NOT NULL,

  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  workflow_json JSONB NOT NULL,
  workflow_name VARCHAR(500) NOT NULL,
  original_description TEXT,

  author_username VARCHAR(255),
  author_profile_url TEXT,

  -- Denormalized metadata for fast querying
  node_types TEXT[] NOT NULL DEFAULT '{}',
  node_count INTEGER NOT NULL DEFAULT 0,
  trigger_type VARCHAR(20),
  credentials_required TEXT[] NOT NULL DEFAULT '{}',
  has_code_node BOOLEAN NOT NULL DEFAULT FALSE,
  estimated_complexity VARCHAR(20),

  -- Classification
  primary_category VARCHAR(50),
  secondary_categories TEXT[] DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',

  -- Quality
  quality_score INTEGER DEFAULT 0,
  has_description BOOLEAN DEFAULT FALSE,
  has_documentation BOOLEAN DEFAULT FALSE,
  is_complete BOOLEAN DEFAULT TRUE,
  validation_status VARCHAR(20) DEFAULT 'untested',

  -- Publishing
  publishing_status VARCHAR(20) DEFAULT 'raw',
  enriched_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  gumroad_id VARCHAR(100),
  price_tier VARCHAR(20),

  UNIQUE(source, source_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_workflows_source ON workflows(source);
CREATE INDEX IF NOT EXISTS idx_workflows_primary_category ON workflows(primary_category);
CREATE INDEX IF NOT EXISTS idx_workflows_publishing_status ON workflows(publishing_status);
CREATE INDEX IF NOT EXISTS idx_workflows_quality_score ON workflows(quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_workflows_node_types ON workflows USING GIN(node_types);
CREATE INDEX IF NOT EXISTS idx_workflows_tags ON workflows USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_workflows_discovered_at ON workflows(discovered_at DESC);

-- Duplicate tracking (near-matches)
CREATE TABLE IF NOT EXISTS workflow_duplicates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES workflows(id) ON DELETE CASCADE,
  duplicate_of UUID REFERENCES workflows(id) ON DELETE CASCADE,
  similarity_score DECIMAL(5,4) NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(workflow_id, duplicate_of)
);

-- Harvest run logs
CREATE TABLE IF NOT EXISTS harvest_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source VARCHAR(20) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'running',

  items_discovered INTEGER DEFAULT 0,
  items_new INTEGER DEFAULT 0,
  items_duplicate INTEGER DEFAULT 0,
  items_invalid INTEGER DEFAULT 0,

  error_message TEXT,
  metadata JSONB DEFAULT '{}'
);

-- Enrichment queue
CREATE TABLE IF NOT EXISTS enrichment_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES workflows(id) ON DELETE CASCADE,
  priority INTEGER DEFAULT 0,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'pending',
  error_message TEXT,

  UNIQUE(workflow_id)
);
