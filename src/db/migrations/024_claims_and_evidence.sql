CREATE TABLE IF NOT EXISTS knowledge_claims (
  id UUID PRIMARY KEY,
  claim_text TEXT NOT NULL,
  claim_type TEXT NOT NULL DEFAULT 'assertion',
  status TEXT NOT NULL DEFAULT 'candidate',
  confidence DECIMAL(5,4) NOT NULL DEFAULT 0.5,
  subject_type TEXT,
  subject_id TEXT,
  artifact_id UUID REFERENCES artifacts(id) ON DELETE SET NULL,
  workflow_id UUID REFERENCES workflows(id) ON DELETE SET NULL,
  source_record_id UUID REFERENCES source_records(id) ON DELETE SET NULL,
  summary TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (claim_type IN ('assertion', 'fact', 'process', 'policy', 'relationship', 'risk', 'decision')),
  CHECK (status IN ('candidate', 'accepted', 'disputed', 'rejected', 'archived'))
);

CREATE TABLE IF NOT EXISTS claim_evidence (
  id UUID PRIMARY KEY,
  claim_id UUID NOT NULL REFERENCES knowledge_claims(id) ON DELETE CASCADE,
  evidence_role TEXT NOT NULL DEFAULT 'supports',
  artifact_id UUID REFERENCES artifacts(id) ON DELETE SET NULL,
  workflow_id UUID REFERENCES workflows(id) ON DELETE SET NULL,
  source_record_id UUID REFERENCES source_records(id) ON DELETE SET NULL,
  source_url TEXT,
  excerpt TEXT,
  confidence DECIMAL(5,4) NOT NULL DEFAULT 0.5,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (evidence_role IN ('supports', 'contradicts', 'context'))
);

CREATE INDEX IF NOT EXISTS idx_knowledge_claims_status
  ON knowledge_claims (status);

CREATE INDEX IF NOT EXISTS idx_knowledge_claims_subject
  ON knowledge_claims (subject_type, subject_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_claims_artifact
  ON knowledge_claims (artifact_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_claims_workflow
  ON knowledge_claims (workflow_id);

CREATE INDEX IF NOT EXISTS idx_claim_evidence_claim
  ON claim_evidence (claim_id);

CREATE INDEX IF NOT EXISTS idx_claim_evidence_role
  ON claim_evidence (evidence_role);
