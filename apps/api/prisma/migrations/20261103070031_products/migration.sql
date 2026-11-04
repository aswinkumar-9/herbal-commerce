-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('AYURVEDIC_MEDICINE', 'FOOD_OR_SUPPLEMENT', 'COSMETIC');

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "summary" TEXT,
    "description" TEXT,
    "ingredients" TEXT,
    "usage" TEXT,
    "type" "ProductType",
    "licenceNumber" TEXT,
    "manufacturerName" TEXT,
    "manufacturerAddress" TEXT,
    "countryOfOrigin" TEXT NOT NULL DEFAULT 'India',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_categoryId_idx" ON "products"("categoryId");


-- A product goes live only with its licence and maker details and its
-- ingredients (ADR 0021). The API checks the same rule first, with clear
-- errors; this is the last line of defence.
ALTER TABLE "products" ADD CONSTRAINT "products_live_needs_details_chk" CHECK (
    NOT "isActive"
    OR (
        "type" IS NOT NULL
        AND "licenceNumber" IS NOT NULL
        AND "manufacturerName" IS NOT NULL
        AND "manufacturerAddress" IS NOT NULL
        AND "ingredients" IS NOT NULL
    )
);
