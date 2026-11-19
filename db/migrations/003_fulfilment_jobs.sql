-- Durable supplier fulfilment queue. All purchase payloads are server-generated snapshots.
CREATE TABLE IF NOT EXISTS vf_fulfilment_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES vf_orders(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL DEFAULT 'voidmob' CHECK (provider = 'voidmob'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitting', 'unknown', 'submitted', 'completed', 'failed', 'skipped')),
  idempotency_key TEXT NOT NULL UNIQUE,
  supplier_order_id TEXT,
  supplier_cost_minor BIGINT CHECK (supplier_cost_minor IS NULL OR supplier_cost_minor >= 0),
  supplier_currency CHAR(3) NOT NULL DEFAULT 'USD',
  supplier_status TEXT,
  supplier_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  locked_at TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_message TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vf_fulfilment_jobs_status_created_idx
  ON vf_fulfilment_jobs(status, created_at ASC);
CREATE INDEX IF NOT EXISTS vf_fulfilment_jobs_supplier_idx
  ON vf_fulfilment_jobs(supplier_order_id) WHERE supplier_order_id IS NOT NULL;
