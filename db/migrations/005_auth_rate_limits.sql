-- Persistent, privacy-conscious auth throttling for serverless deployments.
-- Only SHA-256 bucket hashes are stored; raw emails and IP addresses are not persisted.
CREATE TABLE IF NOT EXISTS vf_auth_rate_limits (
  bucket_key CHAR(64) PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vf_auth_rate_limits_updated_idx
  ON vf_auth_rate_limits(updated_at);
