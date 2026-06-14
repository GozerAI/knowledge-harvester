-- Migration 009: Quality Improvements
-- Adds indexes for license detection, validation status, and test coverage.

CREATE INDEX IF NOT EXISTS idx_artifacts_validation_status ON artifacts(validation_status);

CREATE INDEX IF NOT EXISTS idx_artifacts_licensed
  ON artifacts ((type_metadata->>'license_info'))
  WHERE type_metadata ? 'license_info';

CREATE INDEX IF NOT EXISTS idx_artifacts_tested
  ON artifacts ((type_metadata->>'has_tests'))
  WHERE type_metadata ? 'test_coverage';
