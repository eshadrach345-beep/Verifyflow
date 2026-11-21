-- Add provider attribution for Squad while retaining historical Monnify rows.
BEGIN;
ALTER TABLE vf_wallet_topups ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'monnify';
ALTER TABLE vf_wallet_topups DROP CONSTRAINT IF EXISTS vf_wallet_topups_provider_check;
ALTER TABLE vf_wallet_topups ADD CONSTRAINT vf_wallet_topups_provider_check CHECK (provider IN ('monnify','squad'));
ALTER TABLE vf_payments ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'monnify';
ALTER TABLE vf_payments DROP CONSTRAINT IF EXISTS vf_payments_provider_check;
ALTER TABLE vf_payments ADD CONSTRAINT vf_payments_provider_check CHECK (provider IN ('monnify','squad'));
ALTER TABLE vf_payment_webhook_events DROP CONSTRAINT IF EXISTS vf_payment_webhook_events_provider_check;
ALTER TABLE vf_payment_webhook_events ADD CONSTRAINT vf_payment_webhook_events_provider_check CHECK (provider IN ('monnify','squad'));
CREATE INDEX IF NOT EXISTS vf_wallet_topups_provider_status_idx ON vf_wallet_topups(provider, status, created_at DESC);
CREATE INDEX IF NOT EXISTS vf_payments_provider_status_idx ON vf_payments(provider, status, created_at DESC);
COMMIT;
