-- Prices are whole rupees now, not paise (ADR 0022): staff type 499 for
-- Rs 499. The columns are renamed, not dropped and added again, so the check
-- constraint product_variants_quantity_and_price_chk stays and follows the
-- new names.

-- No pack size may exist yet: its paise would be read as rupees.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "product_variants") THEN
    RAISE EXCEPTION 'product_variants is not empty: its paise would be read as rupees';
  END IF;
END $$;

ALTER TABLE "product_variants" RENAME COLUMN "mrpRupees" TO "mrpRupees";
ALTER TABLE "product_variants" RENAME COLUMN "priceRupees" TO "priceRupees";
