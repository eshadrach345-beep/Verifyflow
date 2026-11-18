-- VerifyFlow customer foundation
-- Migration: 001_customer_accounts
-- Safe to apply more than once. No payment or supplier-purchase functions are created here.

CREATE TABLE IF NOT EXISTS vf_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_verification'
    CHECK (status IN ('pending_verification', 'active', 'suspended')),
  email_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS vf_users_email_lower_uq
  ON vf_users (LOWER(email));

CREATE TABLE IF NOT EXISTS vf_customer_profiles (
  user_id UUID PRIMARY KEY REFERENCES vf_users(id) ON DELETE CASCADE,
  display_name TEXT,
  country_code CHAR(2),
  preferred_currency CHAR(3) NOT NULL DEFAULT 'USD',
  timezone TEXT NOT NULL DEFAULT 'Africa/Lagos',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vf_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES vf_users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vf_sessions_user_idx ON vf_sessions(user_id);
CREATE INDEX IF NOT EXISTS vf_sessions_expiry_idx ON vf_sessions(expires_at);

CREATE TABLE IF NOT EXISTS vf_email_verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES vf_users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vf_email_verification_user_idx
  ON vf_email_verification_tokens(user_id);

CREATE TABLE IF NOT EXISTS vf_password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES vf_users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vf_password_reset_user_idx
  ON vf_password_reset_tokens(user_id);

-- Balance accounts are deliberately disabled until payment-provider approval.
-- Values are stored in minor units (e.g. kobo/cents), never floating point.
CREATE TABLE IF NOT EXISTS vf_wallet_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES vf_users(id) ON DELETE CASCADE,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  balance_minor BIGINT NOT NULL DEFAULT 0 CHECK (balance_minor >= 0),
  status TEXT NOT NULL DEFAULT 'disabled'
    CHECK (status IN ('disabled', 'active', 'frozen')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT vf_wallet_one_per_user_currency UNIQUE (user_id, currency)
);

CREATE TABLE IF NOT EXISTS vf_wallet_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES vf_wallet_accounts(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('credit', 'debit', 'adjustment')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency CHAR(3) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'posted', 'reversed')),
  reference TEXT UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vf_wallet_ledger_wallet_idx
  ON vf_wallet_ledger(wallet_id, created_at DESC);

CREATE TABLE IF NOT EXISTS vf_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES vf_users(id) ON DELETE RESTRICT,
  order_number TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL CHECK (provider IN ('herosms', 'voidmob', 'manual')),
  product_type TEXT NOT NULL
    CHECK (product_type IN ('sms_otp', 'long_term_number', 'dedicated_number', 'esim', 'mobile_proxy')),
  product_name TEXT NOT NULL,
  supplier_order_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'awaiting_payment', 'paid', 'processing', 'completed', 'failed', 'cancelled', 'refunded')),
  currency CHAR(3) NOT NULL,
  subtotal_minor BIGINT NOT NULL DEFAULT 0 CHECK (subtotal_minor >= 0),
  total_minor BIGINT NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
  idempotency_key TEXT UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vf_orders_user_created_idx
  ON vf_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vf_orders_status_idx ON vf_orders(status);
CREATE INDEX IF NOT EXISTS vf_orders_supplier_idx
  ON vf_orders(provider, supplier_order_id);

CREATE TABLE IF NOT EXISTS vf_order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES vf_orders(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  message TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vf_order_events_order_idx
  ON vf_order_events(order_id, created_at ASC);

-- Do not grant public access. API routes use the server-side DATABASE_URL only.
