CREATE TABLE IF NOT EXISTS system_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_type TEXT NOT NULL,
    command TEXT,
    trigger TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    current_step TEXT,
    steps_requested TEXT[] NOT NULL DEFAULT '{}',
    steps_completed TEXT[] NOT NULL DEFAULT '{}',
    error_message TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_system_runs_started_at
    ON system_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_runs_run_type_started_at
    ON system_runs(run_type, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_runs_status_started_at
    ON system_runs(status, started_at DESC);

ALTER TABLE operation_logs
    ADD COLUMN IF NOT EXISTS system_run_id UUID REFERENCES system_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_operation_logs_system_run_id_created_at
    ON operation_logs(system_run_id, created_at DESC);
