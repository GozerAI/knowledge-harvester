-- Migration 006: Wave-2 expansion
-- Cross-tool migration suggestions, workflow compositions, complexity analysis, faceted search

CREATE TABLE IF NOT EXISTS workflow_migrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_workflow_id UUID REFERENCES workflows(id) ON DELETE CASCADE,
  target_tool_type TEXT NOT NULL,
  migration_difficulty TEXT DEFAULT 'moderate',
  migration_notes TEXT,
  equivalent_workflow_id UUID REFERENCES workflows(id) ON DELETE SET NULL,
  confidence DECIMAL(3,2) DEFAULT 0.0,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_workflow_id, target_tool_type)
);

CREATE TABLE IF NOT EXISTS workflow_compositions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  component_workflow_ids UUID[] NOT NULL,
  composition_type TEXT DEFAULT 'sequential',
  suggested_connections JSONB DEFAULT '[]',
  total_quality_score INTEGER DEFAULT 0,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE workflows ADD COLUMN IF NOT EXISTS complexity_score INTEGER DEFAULT 0;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS complexity_breakdown JSONB DEFAULT '{}';

CREATE MATERIALIZED VIEW IF NOT EXISTS workflow_facets AS
SELECT
  tool_type, primary_category, estimated_complexity, language,
  COUNT(*) as workflow_count, ROUND(AVG(quality_score)) as avg_quality
FROM workflows WHERE quality_score > 0
GROUP BY tool_type, primary_category, estimated_complexity, language;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_facets_unique
  ON workflow_facets(tool_type, primary_category, estimated_complexity, language);

CREATE INDEX IF NOT EXISTS idx_workflow_migrations_source ON workflow_migrations(source_workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_migrations_target ON workflow_migrations(target_tool_type);
CREATE INDEX IF NOT EXISTS idx_workflow_compositions_components ON workflow_compositions USING GIN(component_workflow_ids);
CREATE INDEX IF NOT EXISTS idx_workflows_complexity ON workflows(complexity_score DESC);
