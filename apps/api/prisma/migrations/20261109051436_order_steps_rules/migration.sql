-- The steps after payment (ADR 0028). The new statuses and refund reasons
-- come from the previous migration: PostgreSQL uses a new enum value only
-- once the transaction that added it has ended (ADR 0003).

-- Each step after payment has its time, in order. A shipped order names its
-- courier and tracking number. A packed order may still be cancelled, and
-- keeps when it was packed.
ALTER TABLE "orders" ADD CONSTRAINT "orders_steps_chk" CHECK (
    ("status" NOT IN ('PACKED', 'SHIPPED', 'DELIVERED') OR "packedAt" IS NOT NULL)
    AND ("packedAt" IS NULL OR "status" IN ('PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED'))
    AND (("shippedAt" IS NOT NULL) = ("status" IN ('SHIPPED', 'DELIVERED')))
    AND (("courierName" IS NOT NULL) = ("shippedAt" IS NOT NULL))
    AND (("trackingNumber" IS NOT NULL) = ("shippedAt" IS NOT NULL))
    AND (("deliveredAt" IS NOT NULL) = ("status" = 'DELIVERED'))
    AND ("shippedAt" IS NULL OR "shippedAt" >= "packedAt")
    AND ("deliveredAt" IS NULL OR "deliveredAt" >= "shippedAt")
    AND ("courierName" IS NULL
         OR (char_length("courierName") BETWEEN 2 AND 60 AND "courierName" = btrim("courierName")))
    AND ("trackingNumber" IS NULL OR "trackingNumber" ~ '^[A-Za-z0-9][A-Za-z0-9-]{3,39}$')
);

-- What an order agreed to never changes. Since part 9, staff record its
-- steps: each time is set once, in the update that takes its step. The
-- courier and tracking number come with shipping, and may be corrected only
-- while the order is on its way.
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
    RAISE EXCEPTION 'what an order agreed to never changes: only its status and its steps may'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."packedAt" IS DISTINCT FROM OLD."packedAt" AND NOT (
       OLD."packedAt" IS NULL AND OLD."status" = 'PAID' AND NEW."status" = 'PACKED'
  ) THEN
    RAISE EXCEPTION 'an order is packed once, when it is marked packed'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."shippedAt" IS DISTINCT FROM OLD."shippedAt" AND NOT (
       OLD."shippedAt" IS NULL AND OLD."status" = 'PACKED' AND NEW."status" = 'SHIPPED'
  ) THEN
    RAISE EXCEPTION 'an order is shipped once, when it is marked shipped'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."courierName", NEW."trackingNumber")
       IS DISTINCT FROM (OLD."courierName", OLD."trackingNumber")
     AND NOT (
       (OLD."status" = 'PACKED' AND NEW."status" = 'SHIPPED')
       OR (OLD."status" = 'SHIPPED' AND NEW."status" = 'SHIPPED')
     ) THEN
    RAISE EXCEPTION 'the courier and tracking number come with shipping, and change only on the way'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."deliveredAt" IS DISTINCT FROM OLD."deliveredAt" AND NOT (
       OLD."deliveredAt" IS NULL AND OLD."status" = 'SHIPPED' AND NEW."status" = 'DELIVERED'
  ) THEN
    RAISE EXCEPTION 'an order is delivered once, when it is marked delivered'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- An order's status only moves forward: paid, packed, shipped, delivered.
-- It may be cancelled while it waits for payment, and since part 9 also
-- once paid, until it ships, but only with its payment going back in full.
-- An expired order may still be paid late (ADR 0027).
CREATE OR REPLACE FUNCTION orders_status_moves_forward() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" = OLD."status" THEN
    RETURN NEW;
  END IF;
  IF NOT (
       (OLD."status" = 'PENDING_PAYMENT' AND NEW."status" IN ('PAID', 'CANCELLED', 'EXPIRED'))
    OR (OLD."status" = 'EXPIRED' AND NEW."status" = 'PAID')
    OR (OLD."status" = 'PAID' AND NEW."status" IN ('PACKED', 'CANCELLED'))
    OR (OLD."status" = 'PACKED' AND NEW."status" IN ('SHIPPED', 'CANCELLED'))
    OR (OLD."status" = 'SHIPPED' AND NEW."status" = 'DELIVERED')
  ) THEN
    RAISE EXCEPTION 'an order''s status only moves forward'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = 'PAID' AND NOT EXISTS (
    SELECT 1 FROM "payments"
     WHERE "orderId" = NEW."id" AND "razorpayPaymentId" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'an order is paid only when its payment is'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = 'CANCELLED' AND OLD."status" IN ('PAID', 'PACKED') AND NOT EXISTS (
    SELECT 1 FROM "payments" p
      JOIN "refunds" r
        ON r."paymentId" = p."id" AND r."razorpayPaymentId" = p."razorpayPaymentId"
     WHERE p."orderId" = NEW."id"
       AND r."reason" IN ('CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_STAFF')
  ) THEN
    RAISE EXCEPTION 'a paid order is cancelled only with its payment going back'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- A refund gives back a whole payment. Since part 9, cancelling a paid
-- order gives back the payment that paid it, before the order ships.
CREATE OR REPLACE FUNCTION refunds_match_their_payment() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "payments"
     WHERE "id" = NEW."paymentId" AND "amountRupees" = NEW."amountRupees"
  ) THEN
    RAISE EXCEPTION 'a refund gives back a whole payment'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."reason" IN ('CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_STAFF') AND NOT EXISTS (
    SELECT 1 FROM "payments" p
      JOIN "orders" o ON o."id" = p."orderId"
     WHERE p."id" = NEW."paymentId"
       AND p."razorpayPaymentId" = NEW."razorpayPaymentId"
       AND o."status" IN ('PAID', 'PACKED')
  ) THEN
    RAISE EXCEPTION 'a cancelled order gives back the payment that paid it, before it ships'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
