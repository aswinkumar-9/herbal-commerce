-- Orders keep money in whole rupees, like the catalog, by the owner's choice
-- on 2026-11-07 (ADR 0026): the GST too, rounded to the nearest rupee. The
-- columns are renamed, never dropped and added again (ADR 0003), and the
-- orders placed so far are converted.

-- Every amount but the GST converts exactly. Refuse to run if one doesn't.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "orders"
     WHERE "itemsTotalPaise" % 100 <> 0
        OR "deliveryChargePaise" % 100 <> 0
        OR "totalPaise" % 100 <> 0
  ) OR EXISTS (
    SELECT 1 FROM "order_items"
     WHERE "mrpPaise" % 100 <> 0
        OR "pricePaise" % 100 <> 0
        OR "lineTotalPaise" % 100 <> 0
  ) THEN
    RAISE EXCEPTION 'an order holds an amount that is not whole rupees: convert it by hand first';
  END IF;
END;
$$;

ALTER TABLE "orders" RENAME COLUMN "itemsTotalPaise" TO "itemsTotalRupees";
ALTER TABLE "orders" RENAME COLUMN "itemsGstPaise" TO "itemsGstRupees";
ALTER TABLE "orders" RENAME COLUMN "deliveryChargePaise" TO "deliveryChargeRupees";
ALTER TABLE "orders" RENAME COLUMN "totalPaise" TO "totalRupees";
ALTER TABLE "order_items" RENAME COLUMN "mrpPaise" TO "mrpRupees";
ALTER TABLE "order_items" RENAME COLUMN "pricePaise" TO "priceRupees";
ALTER TABLE "order_items" RENAME COLUMN "lineTotalPaise" TO "lineTotalRupees";
ALTER TABLE "order_items" RENAME COLUMN "gstPaise" TO "gstRupees";

-- The check constraints follow the renamed columns. This function names
-- them in its text, so it is replaced with the new names.
CREATE OR REPLACE FUNCTION orders_keep_what_was_agreed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'an order is never deleted'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."id", NEW."reference", NEW."userId", NEW."idempotencyKey",
      NEW."deliveryName", NEW."deliveryPhone", NEW."deliveryLine1",
      NEW."deliveryLine2", NEW."deliveryCity", NEW."deliveryState",
      NEW."deliveryPincode", NEW."itemsTotalRupees", NEW."itemsGstRupees",
      NEW."deliveryChargeRupees", NEW."totalRupees", NEW."holdExpiresAt",
      NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."reference", OLD."userId", OLD."idempotencyKey",
      OLD."deliveryName", OLD."deliveryPhone", OLD."deliveryLine1",
      OLD."deliveryLine2", OLD."deliveryCity", OLD."deliveryState",
      OLD."deliveryPincode", OLD."itemsTotalRupees", OLD."itemsGstRupees",
      OLD."deliveryChargeRupees", OLD."totalRupees", OLD."holdExpiresAt",
      OLD."createdAt") THEN
    RAISE EXCEPTION 'what an order agreed to never changes: only its status may'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Convert the orders placed so far, in this transaction only, with their
-- guards off: orders and their lines never change otherwise. Each line's
-- GST is rounded to the nearest rupee, and an order's GST is the sum of
-- its lines'.
ALTER TABLE "order_items" DISABLE TRIGGER order_items_are_final;
ALTER TABLE "orders" DISABLE TRIGGER orders_keep_what_was_agreed;
UPDATE "order_items"
   SET "mrpRupees" = "mrpRupees" / 100,
       "priceRupees" = "priceRupees" / 100,
       "lineTotalRupees" = "lineTotalRupees" / 100,
       "gstRupees" = round("gstRupees" / 100.0);
UPDATE "orders" o
   SET "itemsTotalRupees" = o."itemsTotalRupees" / 100,
       "deliveryChargeRupees" = o."deliveryChargeRupees" / 100,
       "totalRupees" = o."totalRupees" / 100,
       "itemsGstRupees" = (
         SELECT COALESCE(sum(i."gstRupees"), 0) FROM "order_items" i
          WHERE i."orderId" = o."id"
       );
ALTER TABLE "orders" ENABLE TRIGGER orders_keep_what_was_agreed;
ALTER TABLE "order_items" ENABLE TRIGGER order_items_are_final;
