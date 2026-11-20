-- Repair wallet tables/indexes and SMM supplier ID type after older partial migrations.
-- Safe to re-run. No payment is created or credited by this migration.
BEGIN;

-- Supplier IDs are provider-owned strings. Some early installs created the
-- column as UUID, which makes numeric/string supplier IDs fail with 22P02.
ALTER TABLE vf_smm_products
  ALTER COLUMN supplier_service_id TYPE TEXT
  USING supplier_service_id::TEXT;

-- Keep only the highest-priced active listing for each supplier service.
-- Lower-priced rows are soft-hidden so existing order history stays intact.
WITH ranked_services AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY provider, supplier_service_id
           ORDER BY retail_rate_minor_per_1000 DESC, updated_at DESC, created_at DESC, id ASC
         ) AS duplicate_rank
  FROM vf_smm_products
  WHERE is_active = TRUE AND supplier_service_id IS NOT NULL
)
UPDATE vf_smm_products p
SET is_active = FALSE, updated_at = NOW()
FROM ranked_services r
WHERE p.id = r.id AND r.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS vf_smm_products_one_active_supplier_service_uidx
  ON vf_smm_products(provider, supplier_service_id)
  WHERE is_active = TRUE;

-- Ensure the wallet account table exists, and create the unique user_id
-- constraint required by ensureWalletAccount's ON CONFLICT(user_id).
CREATE TABLE IF NOT EXISTS vf_wallet_accounts (
  user_id UUID NOT NULL REFERENCES vf_users(id) ON DELETE CASCADE,
  currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  balance_minor BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE vf_wallet_accounts
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS balance_minor BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Keep the most recently updated row if an incomplete install created duplicate
-- account rows. Account balances are not summed, avoiding accidental double credit.
WITH ranked_accounts AS (
  SELECT ctid,
         ROW_NUMBER() OVER (
           PARTITION BY user_id
           ORDER BY updated_at DESC NULLS LAST, balance_minor DESC, created_at DESC NULLS LAST, ctid
         ) AS duplicate_rank
  FROM vf_wallet_accounts
  WHERE user_id IS NOT NULL
)
DELETE FROM vf_wallet_accounts a
USING ranked_accounts r
WHERE a.ctid = r.ctid AND r.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS vf_wallet_accounts_user_id_repair_uidx
  ON vf_wallet_accounts(user_id);

-- Restore the immutable wallet ledger and its idempotency key.
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
ALTER TABLE vf_wallet_transactions
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS amount_minor BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS transaction_type TEXT,
  ADD COLUMN IF NOT EXISTS reference_type TEXT,
  ADD COLUMN IF NOT EXISTS reference_id TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT 'Wallet transaction',
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

WITH ranked_ledger AS (
  SELECT ctid,
         ROW_NUMBER() OVER (
           PARTITION BY user_id, reference_type, reference_id
           ORDER BY created_at ASC NULLS LAST, id ASC
         ) AS duplicate_rank
  FROM vf_wallet_transactions
  WHERE user_id IS NOT NULL AND reference_type IS NOT NULL AND reference_id IS NOT NULL
)
DELETE FROM vf_wallet_transactions t
USING ranked_ledger r
WHERE t.ctid = r.ctid AND r.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS vf_wallet_transactions_reference_repair_uidx
  ON vf_wallet_transactions(user_id, reference_type, reference_id);
CREATE INDEX IF NOT EXISTS vf_wallet_transactions_history_repair_idx
  ON vf_wallet_transactions(user_id, created_at DESC);

-- Restore the wallet deposit table missing from the live POST /api/wallet/deposit.
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
ALTER TABLE vf_wallet_topups
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS payment_reference TEXT,
  ADD COLUMN IF NOT EXISTS payment_currency CHAR(3) NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS payment_amount_minor BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS wallet_amount_minor BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'initiated',
  ADD COLUMN IF NOT EXISTS checkout_url TEXT,
  ADD COLUMN IF NOT EXISTS transaction_reference TEXT,
  ADD COLUMN IF NOT EXISTS provider_status TEXT,
  ADD COLUMN IF NOT EXISTS provider_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

WITH ranked_topups AS (
  SELECT ctid,
         ROW_NUMBER() OVER (
           PARTITION BY payment_reference
           ORDER BY created_at ASC NULLS LAST, id ASC
         ) AS duplicate_rank
  FROM vf_wallet_topups
  WHERE payment_reference IS NOT NULL
)
DELETE FROM vf_wallet_topups t
USING ranked_topups r
WHERE t.ctid = r.ctid AND r.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS vf_wallet_topups_payment_reference_repair_uidx
  ON vf_wallet_topups(payment_reference);
CREATE INDEX IF NOT EXISTS vf_wallet_topups_user_history_repair_idx
  ON vf_wallet_topups(user_id, created_at DESC);

COMMIT;
