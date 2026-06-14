CREATE TABLE IF NOT EXISTS operation_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    level TEXT NOT NULL,
    category TEXT NOT NULL,
    event_type TEXT NOT NULL,
    message TEXT NOT NULL,
    source TEXT,
    command TEXT,
    run_id UUID REFERENCES harvest_runs(id) ON DELETE SET NULL,
    request_path TEXT,
    error_name TEXT,
    error_code TEXT,
    error_stack TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_operation_logs_created_at
    ON operation_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_operation_logs_level_created_at
    ON operation_logs(level, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_operation_logs_category_created_at
    ON operation_logs(category, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_operation_logs_run_id_created_at
    ON operation_logs(run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_operation_logs_source_created_at
    ON operation_logs(source, created_at DESC);
