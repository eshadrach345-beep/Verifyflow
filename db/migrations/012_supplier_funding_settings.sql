-- Store supplier-specific minimum top-up amounts for funding guidance.
CREATE TABLE IF NOT EXISTS vf_supplier_funding_settings (
  provider TEXT PRIMARY KEY CHECK (provider IN ('voidmob', 'herosms', 'peakerr', 'justanotherpanel')),
  minimum_deposit_minor BIGINT CHECK (minimum_deposit_minor IS NULL OR minimum_deposit_minor > 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
