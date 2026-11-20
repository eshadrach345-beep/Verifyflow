-- Repair partially-installed wallet and SMM schema left by older manual SQL runs.
-- Safe to run through npm run db:migrate; all objects use IF NOT EXISTS.

-- Some older installations created this provider-owned identifier as UUID.
-- Supplier service IDs are strings, so normalize them to TEXT before publishing.
ALTER TABLE vf_smm_products
  ALTER COLUMN supplier_service_id TYPE TEXT
  USING supplier_service_id::TEXT;

-- Keep the higher-priced duplicate in the same supplier's exact service entry.
-- Orders retain their product snapshots, so history is not rewritten.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY provider, supplier_service_id
           ORDER BY retail_rate_minor_per_1000 DESC, updated_at DESC, created_at DESC, id ASC
         ) AS duplicate_rank
  FROM vf_smm_products
)
DELETE FROM vf_smm_products p
USING ranked r
WHERE p.id = r.id AND r.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS vf_smm_products_provider_service_uidx
  ON vf_smm_products(provider, supplier_service_id);

-- Ensure wallet balance accounts exist and that ON CONFLICT(user_id) has
-- a real unique index, even when an earlier manual run created the table
-- without its primary-key constraint.
CREATE TABLE IF NOT EXISTS vf_wallet_accounts (
  user_id UUID NOT NULL REFERENCES vf_users(id) ON DELETE CASCADE,
  currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  balance_minor BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE vf_wallet_accounts ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'USD';
ALTER TABLE vf_wallet_accounts ADD COLUMN IF NOT EXISTS balance_minor BIGINT NOT NULL DEFAULT 0;
ALTER TABLE vf_wallet_accounts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE vf_wallet_accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE UNIQUE INDEX IF NOT EXISTS vf_wallet_accounts_user_id_uidx
  ON vf_wallet_accounts(user_id);

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
  payment_reference TEXT NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS vf_wallet_topups_payment_reference_uidx
  ON vf_wallet_topups(payment_reference);
CREATE INDEX IF NOT EXISTS vf_wallet_topups_user_history_idx
  ON vf_wallet_topups(user_id, created_at DESC);
