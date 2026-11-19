-- Storefront-managed social marketing products and supplier fulfilment support.
ALTER TABLE vf_orders DROP CONSTRAINT IF EXISTS vf_orders_provider_check;
ALTER TABLE vf_orders ADD CONSTRAINT vf_orders_provider_check
  CHECK (provider IN ('herosms', 'voidmob', 'manual', 'peakerr', 'justanotherpanel'));

ALTER TABLE vf_orders DROP CONSTRAINT IF EXISTS vf_orders_product_type_check;
ALTER TABLE vf_orders ADD CONSTRAINT vf_orders_product_type_check
  CHECK (product_type IN ('sms_otp', 'long_term_number', 'dedicated_number', 'esim', 'mobile_proxy', 'smm_service'));

ALTER TABLE vf_fulfilment_jobs DROP CONSTRAINT IF EXISTS vf_fulfilment_jobs_provider_check;
ALTER TABLE vf_fulfilment_jobs ADD CONSTRAINT vf_fulfilment_jobs_provider_check
  CHECK (provider IN ('voidmob', 'herosms', 'peakerr', 'justanotherpanel'));

CREATE TABLE IF NOT EXISTS vf_smm_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('peakerr', 'justanotherpanel')),
  supplier_service_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  product_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  supplier_rate NUMERIC(18,6),
  supplier_currency CHAR(3),
  min_quantity INTEGER NOT NULL CHECK (min_quantity > 0),
  max_quantity INTEGER NOT NULL CHECK (max_quantity >= min_quantity),
  retail_rate_minor_per_1000 BIGINT NOT NULL CHECK (retail_rate_minor_per_1000 > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vf_smm_products_active_platform_idx
  ON vf_smm_products(is_active, platform, created_at DESC);
CREATE INDEX IF NOT EXISTS vf_smm_products_supplier_service_idx
  ON vf_smm_products(provider, supplier_service_id);

