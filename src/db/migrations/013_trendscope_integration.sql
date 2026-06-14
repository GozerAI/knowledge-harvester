-- Migration 013: Trendscope integration — GIN index on trend_signals
CREATE INDEX IF NOT EXISTS idx_artifacts_trend_signals
  ON artifacts USING GIN ((marketplace_metadata->'trend_signals'))
  WHERE marketplace_metadata ? 'trend_signals';
