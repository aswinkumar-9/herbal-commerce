-- CreateEnum
CREATE TYPE "StockReason" AS ENUM ('RECEIVED', 'DAMAGED', 'EXPIRED', 'CORRECTION');

-- CreateTable
CREATE TABLE "stock_batches" (
    "id" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "manufacturedOn" DATE NOT NULL,
    "expiresOn" DATE NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "change" INTEGER NOT NULL,
    "reason" "StockReason" NOT NULL,
    "note" TEXT,
    "actorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_batches_variantId_expiresOn_idx" ON "stock_batches"("variantId", "expiresOn");

-- CreateIndex
CREATE UNIQUE INDEX "stock_batches_variantId_batchNumber_key" ON "stock_batches"("variantId", "batchNumber");

-- CreateIndex
CREATE INDEX "stock_movements_batchId_createdAt_idx" ON "stock_movements"("batchId", "createdAt");

-- AddForeignKey
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "stock_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A batch has a batch number, expires after it was made, and never holds
-- less than nothing (ADR 0024).
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_details_chk" CHECK (
    length(btrim("batchNumber")) > 0
    AND "expiresOn" > "manufacturedOn"
    AND "quantity" >= 0
);

-- A movement changes something, a delivery only adds, and a write-off only
-- removes. A correction may go either way.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_change_chk" CHECK (
    "change" <> 0
    AND ("reason" <> 'RECEIVED' OR "change" > 0)
    AND ("reason" NOT IN ('DAMAGED', 'EXPIRED') OR "change" < 0)
);

-- Every movement is applied to its batch at once, in the same transaction.
-- The batch's row is locked by the update, so two movements of one batch
-- take turns, and the check above refuses one that would go below 0.
CREATE FUNCTION stock_movements_apply() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "stock_batches"
     SET "quantity" = "quantity" + NEW."change",
         "updatedAt" = CURRENT_TIMESTAMP
   WHERE "id" = NEW."batchId";
  RETURN NULL;
END;
$$;

CREATE TRIGGER stock_movements_apply
  AFTER INSERT ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION stock_movements_apply();

-- A batch's quantity is the sum of its movements and nothing else: a new
-- batch starts at 0, and only the trigger above may change it (it runs one
-- level deeper than a statement does).
CREATE FUNCTION stock_batches_quantity_from_movements() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW."quantity" <> 0 THEN
    RAISE EXCEPTION 'a new batch starts at 0: its stock arrives as a movement'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."quantity" <> OLD."quantity"
     AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'a batch''s quantity changes only through stock movements'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER stock_batches_quantity_from_movements
  BEFORE INSERT OR UPDATE OF "quantity" ON "stock_batches"
  FOR EACH ROW EXECUTE FUNCTION stock_batches_quantity_from_movements();

-- A movement is final: never changed, and never deleted on its own. It goes
-- only together with its batch, which is then no longer found here.
CREATE FUNCTION stock_movements_are_final() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'a stock movement is never changed: add a correction instead'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM "stock_batches" WHERE "id" = OLD."batchId") THEN
    RAISE EXCEPTION 'a stock movement is never deleted: add a correction instead'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER stock_movements_are_final
  BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION stock_movements_are_final();

-- A batch that still holds stock is never deleted, not even with its pack
-- size or its product: the goods are still on the shelf. Write them off
-- first (ADR 0024).
CREATE FUNCTION stock_batches_keep_stock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."quantity" > 0 THEN
    RAISE EXCEPTION 'a batch that still holds stock cannot be deleted'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER stock_batches_keep_stock
  BEFORE DELETE ON "stock_batches"
  FOR EACH ROW EXECUTE FUNCTION stock_batches_keep_stock();
