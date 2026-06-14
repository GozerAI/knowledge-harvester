-- Migration 003: Add pgvector embedding support
-- Requires pgvector/pgvector:pg16 Docker image

-- Enable the vector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column (768 dimensions for nomic-embed-text)
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS embedding vector(768);

-- Track which workflows have been embedded
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMPTZ;

-- HNSW index for fast approximate nearest neighbor search
-- Using cosine distance (vector_cosine_ops) which matches C-Suite's PgVectorStore defaults
CREATE INDEX IF NOT EXISTS idx_workflows_embedding
ON workflows USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
