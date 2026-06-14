-- Migration 016: Executable Blueprints

CREATE TABLE IF NOT EXISTS blueprints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goal TEXT NOT NULL,
    parsed_keywords TEXT[] DEFAULT '{}',
    artifact_ids UUID[] DEFAULT '{}',
    scaffold JSONB DEFAULT '{}',
    deploy_manifests JSONB DEFAULT '{}',
    combined_readme TEXT DEFAULT '',
    status TEXT DEFAULT 'draft',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blueprints_status ON blueprints(status);
CREATE INDEX IF NOT EXISTS idx_blueprints_created ON blueprints(created_at DESC);
