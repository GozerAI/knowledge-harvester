CREATE TABLE IF NOT EXISTS source_records (
  id UUID PRIMARY KEY,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL,
  run_id UUID REFERENCES harvest_runs(id) ON DELETE SET NULL,
  source_url TEXT,
  source_id TEXT,
  content_hash TEXT,
  item_name TEXT,
  item_kind TEXT NOT NULL DEFAULT 'raw-source',
  artifact_type TEXT,
  stored_kind TEXT,
  stored_id UUID,
  decision TEXT NOT NULL,
  summary TEXT,
  discard_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK (item_kind IN ('workflow', 'artifact', 'raw-source')),
  CHECK (stored_kind IS NULL OR stored_kind IN ('workflow', 'artifact')),
  CHECK (decision IN ('accepted', 'duplicate', 'discarded', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_source_records_recorded_at
  ON source_records (recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_source_records_source_decision
  ON source_records (source, decision);

CREATE INDEX IF NOT EXISTS idx_source_records_run_id
  ON source_records (run_id);
