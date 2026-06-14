-- Migration 015: GitHub Webhook Support

CREATE TABLE IF NOT EXISTS watched_repos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner TEXT NOT NULL,
    repo TEXT NOT NULL,
    webhook_active BOOLEAN DEFAULT true,
    last_event_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(owner, repo)
);

CREATE TABLE IF NOT EXISTS github_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL,
    repo_full_name TEXT NOT NULL,
    payload JSONB NOT NULL,
    processed BOOLEAN DEFAULT false,
    artifacts_created INTEGER DEFAULT 0,
    received_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_repo ON github_webhook_events(repo_full_name);
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed ON github_webhook_events(processed);
CREATE INDEX IF NOT EXISTS idx_watched_repos_active ON watched_repos(webhook_active);
