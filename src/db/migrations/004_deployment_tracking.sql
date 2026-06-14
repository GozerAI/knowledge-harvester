-- Migration 004: Deployment tracking for n8n workflow deployments
-- Tracks which library workflows have been deployed to n8n instances

CREATE TABLE IF NOT EXISTS workflow_deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID REFERENCES workflows(id) ON DELETE CASCADE,
    n8n_workflow_id TEXT NOT NULL,
    deployed_by TEXT,
    deployed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated BOOLEAN DEFAULT FALSE,
    execution_count INTEGER DEFAULT 0,
    last_executed_at TIMESTAMPTZ,
    last_status TEXT,
    UNIQUE(workflow_id, n8n_workflow_id)
);

CREATE INDEX IF NOT EXISTS idx_deployments_workflow ON workflow_deployments(workflow_id);
CREATE INDEX IF NOT EXISTS idx_deployments_n8n ON workflow_deployments(n8n_workflow_id);
