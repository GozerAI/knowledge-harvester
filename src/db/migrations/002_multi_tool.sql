-- Migration 002: Multi-tool support
-- Expands the schema to support multiple automation tools beyond n8n
-- (Zapier, Make, IFTTT, LangChain, CrewAI, AutoGen, etc.)

-- Add tool_type column to distinguish automation frameworks
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS tool_type TEXT NOT NULL DEFAULT 'n8n';

-- Tool-specific metadata (framework version, agent types, tools used, etc.)
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS tool_metadata JSONB DEFAULT '{}';

-- Programming language (python, yaml, json, javascript, etc.)
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS language TEXT;

-- Full-text search vector for fast keyword search
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Index for tool_type filtering
CREATE INDEX IF NOT EXISTS idx_workflows_tool_type ON workflows(tool_type);

-- GIN index for full-text search
CREATE INDEX IF NOT EXISTS idx_workflows_search ON workflows USING GIN(search_vector);

-- Backfill existing data: all current workflows are n8n
UPDATE workflows SET tool_type = 'n8n' WHERE tool_type = 'n8n' OR tool_type IS NULL;

-- Backfill search vectors for existing workflows
UPDATE workflows SET search_vector = to_tsvector('english',
  coalesce(workflow_name, '') || ' ' ||
  coalesce(original_description, '') || ' ' ||
  coalesce(array_to_string(tags, ' '), '') || ' ' ||
  coalesce(tool_type, '')
)
WHERE search_vector IS NULL;

-- Trigger function to keep search_vector updated automatically
CREATE OR REPLACE FUNCTION workflows_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    coalesce(NEW.workflow_name, '') || ' ' ||
    coalesce(NEW.original_description, '') || ' ' ||
    coalesce(array_to_string(NEW.tags, ' '), '') || ' ' ||
    coalesce(NEW.tool_type, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_workflows_search ON workflows;
CREATE TRIGGER trg_workflows_search
  BEFORE INSERT OR UPDATE OF workflow_name, original_description, tags, tool_type
  ON workflows FOR EACH ROW
  EXECUTE FUNCTION workflows_search_vector_update();
