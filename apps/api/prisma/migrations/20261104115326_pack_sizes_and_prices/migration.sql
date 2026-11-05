-- CreateEnum
CREATE TYPE "PackUnit" AS ENUM ('G', 'KG', 'ML', 'L', 'CAPSULES', 'TABLETS', 'PIECES');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "gstRate" INTEGER,
ADD COLUMN     "hsnCode" TEXT;

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit" "PackUnit" NOT NULL,
    "mrpRupees" INTEGER NOT NULL,
    "priceRupees" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_sku_key" ON "product_variants"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_productId_quantity_unit_key" ON "product_variants"("productId", "quantity", "unit");

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A pack size has a positive quantity and prices, and the shop never asks
-- more than the printed MRP (ADR 0022).
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_quantity_and_price_chk" CHECK (
    "quantity" > 0
    AND "mrpRupees" > 0
    AND "priceRupees" > 0
    AND "priceRupees" <= "mrpRupees"
);

-- A live product now also needs its HSN code and GST rate (ADR 0022).
ALTER TABLE "products" DROP CONSTRAINT "products_live_needs_details_chk";
ALTER TABLE "products" ADD CONSTRAINT "products_live_needs_details_chk" CHECK (
    NOT "isActive"
    OR (
        "type" IS NOT NULL
        AND "licenceNumber" IS NOT NULL
        AND "manufacturerName" IS NOT NULL
        AND "manufacturerAddress" IS NOT NULL
        AND "ingredients" IS NOT NULL
        AND "hsnCode" IS NOT NULL
        AND "gstRate" IS NOT NULL
    )
);
