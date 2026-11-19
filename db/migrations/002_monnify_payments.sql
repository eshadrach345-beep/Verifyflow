-- VerifyFlow Monnify checkout records. Wallet balances remain disabled.
CREATE TABLE IF NOT EXISTS vf_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES vf_orders(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL DEFAULT 'monnify' CHECK (provider = 'monnify'),
  payment_reference TEXT NOT NULL UNIQUE,
  transaction_reference TEXT,
  currency CHAR(3) NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  status TEXT NOT NULL DEFAULT 'initiated'
    CHECK (status IN ('initiated', 'pending', 'paid', 'failed', 'expired', 'amount_mismatch', 'reversed')),
  provider_status TEXT,
  checkout_url TEXT,
  provider_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS vf_payments_transaction_reference_uq
  ON vf_payments(transaction_reference) WHERE transaction_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS vf_payments_order_created_idx
  ON vf_payments(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vf_payments_status_idx ON vf_payments(status, created_at DESC);

CREATE TABLE IF NOT EXISTS vf_payment_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'monnify' CHECK (provider = 'monnify'),
  event_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payment_reference TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT vf_payment_webhook_event_uq UNIQUE (provider, event_key)
);
CREATE INDEX IF NOT EXISTS vf_payment_webhook_payment_idx
  ON vf_payment_webhook_events(payment_reference, received_at DESC);
