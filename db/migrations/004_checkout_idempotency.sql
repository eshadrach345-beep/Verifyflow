ALTER TABLE vf_orders ADD COLUMN IF NOT EXISTS checkout_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS vf_orders_user_checkout_key_uq
  ON vf_orders(user_id, checkout_key) WHERE checkout_key IS NOT NULL;
