-- VerifyFlow customer wallet, immutable ledger and Monnify deposits.
CREATE TABLE IF NOT EXISTS vf_wallet_accounts (
  user_id UUID PRIMARY KEY REFERENCES vf_users(id) ON DELETE CASCADE,
  currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  balance_minor BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vf_wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES vf_users(id) ON DELETE CASCADE,
  amount_minor BIGINT NOT NULL CHECK (amount_minor <> 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('deposit','purchase','refund','reversal','adjustment')),
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  description TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS vf_wallet_transactions_reference_idx
  ON vf_wallet_transactions(user_id, reference_type, reference_id);
CREATE INDEX IF NOT EXISTS vf_wallet_transactions_history_idx
  ON vf_wallet_transactions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS vf_wallet_topups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES vf_users(id) ON DELETE CASCADE,
  payment_reference TEXT NOT NULL UNIQUE,
  payment_currency CHAR(3) NOT NULL,
  payment_amount_minor BIGINT NOT NULL CHECK (payment_amount_minor > 0),
  wallet_amount_minor BIGINT NOT NULL CHECK (wallet_amount_minor > 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  status TEXT NOT NULL DEFAULT 'initiated'
    CHECK (status IN ('initiated','pending','paid','failed','expired','reversed','amount_mismatch')),
  checkout_url TEXT,
  transaction_reference TEXT,
  provider_status TEXT,
  provider_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vf_wallet_topups_user_history_idx
  ON vf_wallet_topups(user_id, created_at DESC);
