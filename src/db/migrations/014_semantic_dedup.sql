-- Migration 014: Semantic Dedup Support
ALTER TABLE artifact_duplicates ADD COLUMN IF NOT EXISTS canonical_id UUID REFERENCES artifacts(id);
ALTER TABLE artifact_duplicates ADD COLUMN IF NOT EXISTS group_id UUID;
CREATE INDEX IF NOT EXISTS idx_artifact_duplicates_canonical ON artifact_duplicates(canonical_id);
CREATE INDEX IF NOT EXISTS idx_artifact_duplicates_group ON artifact_duplicates(group_id);
