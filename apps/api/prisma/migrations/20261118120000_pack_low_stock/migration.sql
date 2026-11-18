-- When a pack size's stock counts as low (ADR 0034): at this many packs
-- that may be sold, or fewer. 0 means never. Every pack size starts at 10.
ALTER TABLE "product_variants" ADD COLUMN "lowStockAt" INTEGER NOT NULL DEFAULT 10;

ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_low_stock_chk" CHECK (
    "lowStockAt" BETWEEN 0 AND 1000000
);
