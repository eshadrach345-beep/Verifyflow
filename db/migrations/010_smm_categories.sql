-- Add normalized SMM category and subcategory metadata.
-- Existing platform values are retained as the initial main category.
BEGIN;
ALTER TABLE vf_smm_products
  ADD COLUMN IF NOT EXISTS subcategory TEXT NOT NULL DEFAULT 'Other',
  ADD COLUMN IF NOT EXISTS classification_status TEXT NOT NULL DEFAULT 'needs_review'
    CHECK (classification_status IN ('high','medium','low','needs_review'));
UPDATE vf_smm_products
SET subcategory = COALESCE(NULLIF(subcategory,''),'Other'),
    classification_status = CASE WHEN platform <> 'Other' THEN 'medium' ELSE 'needs_review' END
WHERE subcategory IS NULL OR subcategory = 'Other';
CREATE INDEX IF NOT EXISTS vf_smm_products_category_idx
  ON vf_smm_products(is_active, platform, subcategory, updated_at DESC);
COMMIT;
