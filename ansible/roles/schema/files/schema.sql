-- The pipeline's tables (D12). Run once by Ansible (phase schema) with the
-- bootstrap password, before Vault rotates it away. Idempotent.
-- No column holds plaintext: frames are AES-256-GCM, the data key is the
-- encrypted data key Vault returned (edk). Embeddings are plaintext by design
-- (the lab says so: embedding inversion is real).
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
  doc_id      text PRIMARY KEY CHECK (doc_id ~ '^[a-z][a-z0-9-]{1,30}$'),
  collection  text NOT NULL,
  header      jsonb NOT NULL,
  edk         text NOT NULL CHECK (edk LIKE 'vault:v%'),
  key_version int NOT NULL CHECK (key_version > 0),
  sealed_by   text NOT NULL,
  sealed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS frames (
  doc_id    text NOT NULL REFERENCES documents ON DELETE CASCADE,
  seq       int NOT NULL CHECK (seq >= 0),
  frame     bytea NOT NULL,
  embedding vector(768) NOT NULL,
  PRIMARY KEY (doc_id, seq)
);
CREATE INDEX IF NOT EXISTS frames_embedding ON frames USING hnsw (embedding vector_cosine_ops);

-- Append-only for the keeper (its role may SELECT and INSERT, nothing else):
-- a story reset forgets documents, never the custody of the night before.
CREATE TABLE IF NOT EXISTS custody (
  id     bigserial PRIMARY KEY,
  at     timestamptz NOT NULL DEFAULT now(),
  doc_id text,
  actor  text NOT NULL,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS custody_doc ON custody (doc_id, at);
