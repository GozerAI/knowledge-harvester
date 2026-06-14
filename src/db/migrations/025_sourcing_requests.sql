CREATE TABLE IF NOT EXISTS sourcing_requests (
  id UUID PRIMARY KEY,
  requester TEXT NOT NULL,
  requester_role TEXT NOT NULL,
  domain TEXT NOT NULL,
  topic TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  priority TEXT NOT NULL DEFAULT 'medium',
  research_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  preferred_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  selected_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  artifact_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  constraints JSONB NOT NULL DEFAULT '{}'::jsonb,
  qualification JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dispatched_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sourcing_requests_status
  ON sourcing_requests(status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_sourcing_requests_role
  ON sourcing_requests(requester_role, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_sourcing_requests_domain
  ON sourcing_requests(domain, requested_at DESC);
