-- Migration 005: Packaging and Guide Generation tables
-- Adds workflow_packages and workflow_guides for deployment bundles and setup guides

CREATE TABLE IF NOT EXISTS workflow_packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID UNIQUE REFERENCES workflows(id) ON DELETE CASCADE,
    bundle JSONB NOT NULL,
    dependencies TEXT[] DEFAULT '{}',
    credentials_count INT DEFAULT 0,
    env_vars_count INT DEFAULT 0,
    estimated_setup_minutes INT DEFAULT 15,
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    package_version INT DEFAULT 1
);

CREATE TABLE IF NOT EXISTS workflow_guides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID UNIQUE REFERENCES workflows(id) ON DELETE CASCADE,
    package_id UUID REFERENCES workflow_packages(id) ON DELETE CASCADE,
    guide_markdown TEXT NOT NULL,
    word_count INT DEFAULT 0,
    section_count INT DEFAULT 0,
    quality_score INT DEFAULT 0,
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    generation_model TEXT DEFAULT 'qwen2.5:7b',
    guide_version INT DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_workflow_packages_workflow_id ON workflow_packages(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_guides_workflow_id ON workflow_guides(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_guides_quality ON workflow_guides(quality_score DESC);
