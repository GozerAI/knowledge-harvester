-- Migration 010: Search & Discovery
-- Analytics events table, popularity materialized view.

CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(50) NOT NULL,
  entity_type VARCHAR(30),
  entity_id UUID,
  query_text TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_entity ON analytics_events(entity_id);
CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at DESC);

CREATE MATERIALIZED VIEW IF NOT EXISTS artifact_popularity AS
SELECT
  a.entity_id AS artifact_id,
  COUNT(*) AS total_events,
  COUNT(*) FILTER (WHERE a.event_type = 'view') AS views,
  COUNT(*) FILTER (WHERE a.event_type = 'download') AS downloads,
  COUNT(*) FILTER (WHERE a.created_at > NOW() - INTERVAL '7 days') AS recent_events,
  art.artifact_type,
  art.primary_category,
  art.name
FROM analytics_events a
LEFT JOIN artifacts art ON art.id = a.entity_id
WHERE a.entity_type = 'artifact'
GROUP BY a.entity_id, art.artifact_type, art.primary_category, art.name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_popularity_artifact ON artifact_popularity(artifact_id);
