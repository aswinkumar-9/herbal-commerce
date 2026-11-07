-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'CANCELLED', 'EXPIRED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockReason" ADD VALUE 'ORDERED';
ALTER TYPE "StockReason" ADD VALUE 'RELEASED';

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "orderId" UUID;

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "idempotencyKey" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "deliveryName" TEXT NOT NULL,
    "deliveryPhone" TEXT NOT NULL,
    "deliveryLine1" TEXT NOT NULL,
    "deliveryLine2" TEXT,
    "deliveryCity" TEXT NOT NULL,
    "deliveryState" TEXT NOT NULL,
    "deliveryPincode" TEXT NOT NULL,
    "itemsTotalPaise" INTEGER NOT NULL,
    "itemsGstPaise" INTEGER NOT NULL,
    "deliveryChargePaise" INTEGER NOT NULL,
    "totalPaise" INTEGER NOT NULL,
    "holdExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "productName" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit" "PackUnit" NOT NULL,
    "hsnCode" TEXT NOT NULL,
    "gstRate" INTEGER NOT NULL,
    "mrpPaise" INTEGER NOT NULL,
    "pricePaise" INTEGER NOT NULL,
    "packs" INTEGER NOT NULL,
    "lineTotalPaise" INTEGER NOT NULL,
    "gstPaise" INTEGER NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_reference_key" ON "orders"("reference");

-- CreateIndex
CREATE INDEX "orders_userId_createdAt_idx" ON "orders"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "orders_status_holdExpiresAt_idx" ON "orders"("status", "holdExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "orders_userId_idempotencyKey_key" ON "orders"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_orderId_variantId_key" ON "order_items"("orderId", "variantId");

-- CreateIndex
CREATE INDEX "stock_movements_orderId_idx" ON "stock_movements"("orderId");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- An order's money adds up, in whole paise (ADR 0026).
ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_chk" CHECK (
    "itemsTotalPaise" > 0
    AND "itemsGstPaise" BETWEEN 0 AND "itemsTotalPaise"
    AND "deliveryChargePaise" >= 0
    AND "totalPaise" = "itemsTotalPaise" + "deliveryChargePaise"
);

-- A line is 1 to 4 packs at a price within the MRP. Its total is the packs
-- times the price, and the GST is inside that total.
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_amounts_chk" CHECK (
    "position" >= 0
    AND "packs" BETWEEN 1 AND 4
    AND "pricePaise" > 0
    AND "pricePaise" <= "mrpPaise"
    AND "lineTotalPaise" = "pricePaise" * "packs"
    AND "gstRate" BETWEEN 0 AND 100
    AND "gstPaise" BETWEEN 0 AND "lineTotalPaise"
);

-- What the customer agreed to never changes, and an order is never
-- deleted: of an order, only its status may change (ADR 0026).
CREATE FUNCTION orders_keep_what_was_agreed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'an order is never deleted'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."id", NEW."reference", NEW."userId", NEW."idempotencyKey",
      NEW."deliveryName", NEW."deliveryPhone", NEW."deliveryLine1",
      NEW."deliveryLine2", NEW."deliveryCity", NEW."deliveryState",
      NEW."deliveryPincode", NEW."itemsTotalPaise", NEW."itemsGstPaise",
      NEW."deliveryChargePaise", NEW."totalPaise", NEW."holdExpiresAt",
      NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."reference", OLD."userId", OLD."idempotencyKey",
      OLD."deliveryName", OLD."deliveryPhone", OLD."deliveryLine1",
      OLD."deliveryLine2", OLD."deliveryCity", OLD."deliveryState",
      OLD."deliveryPincode", OLD."itemsTotalPaise", OLD."itemsGstPaise",
      OLD."deliveryChargePaise", OLD."totalPaise", OLD."holdExpiresAt",
      OLD."createdAt") THEN
    RAISE EXCEPTION 'what an order agreed to never changes: only its status may'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_keep_what_was_agreed
  BEFORE UPDATE OR DELETE ON "orders"
  FOR EACH ROW EXECUTE FUNCTION orders_keep_what_was_agreed();

-- An order's lines are final: never changed, never deleted.
CREATE FUNCTION order_items_are_final() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'an order''s lines never change'
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER order_items_are_final
  BEFORE UPDATE OR DELETE ON "order_items"
  FOR EACH ROW EXECUTE FUNCTION order_items_are_final();
