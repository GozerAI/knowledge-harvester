CREATE TABLE IF NOT EXISTS refresh_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    artifact_id UUID REFERENCES artifacts(id),
    previous_decay_risk DECIMAL(5,4),
    refresh_status TEXT NOT NULL,
    source TEXT,
    refreshed_at TIMESTAMPTZ DEFAULT NOW(),
    error_message TEXT
);
