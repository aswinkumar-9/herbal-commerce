-- Part 15C, step 2 (ADR 0046): each payment keeps how it was paid, as
-- Razorpay says when the payment is settled. Payments paid before part 15C
-- stay without: "Not recorded" in reports (the owner's choice on
-- 2026-11-24).
CREATE TYPE "PaymentMethod" AS ENUM ('UPI', 'CARD', 'NETBANKING', 'WALLET', 'EMI', 'PAY_LATER', 'OTHER');

ALTER TABLE "payments" ADD COLUMN "method" "PaymentMethod";

-- Only a paid payment has a method.
ALTER TABLE "payments" ADD CONSTRAINT "payments_method_when_paid"
  CHECK ("method" IS NULL OR "razorpayPaymentId" IS NOT NULL);

-- The guard as before, and: a payment paid from now on is paid with its
-- method, and a paid payment's method never changes, nor is one added to a
-- payment paid before.
CREATE OR REPLACE FUNCTION payments_keep_what_was_agreed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a payment is never deleted'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."id", NEW."orderId", NEW."razorpayOrderId", NEW."amountRupees",
      NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."orderId", OLD."razorpayOrderId", OLD."amountRupees",
      OLD."createdAt") THEN
    RAISE EXCEPTION 'what a payment is for never changes'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."razorpayPaymentId" IS NOT NULL
     AND (NEW."razorpayPaymentId", NEW."paidAt", NEW."method")
         IS DISTINCT FROM (OLD."razorpayPaymentId", OLD."paidAt", OLD."method") THEN
    RAISE EXCEPTION 'a paid payment stays paid, by the same Razorpay payment and method'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."razorpayPaymentId" IS NULL
     AND NEW."razorpayPaymentId" IS NOT NULL
     AND NEW."method" IS NULL THEN
    RAISE EXCEPTION 'a payment is paid with its method'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
