-- CreateEnum
CREATE TYPE "RefundReason" AS ENUM ('ORDER_EXPIRED', 'ORDER_CANCELLED', 'ALREADY_PAID');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'PENDING', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "razorpayOrderId" TEXT NOT NULL,
    "amountRupees" INTEGER NOT NULL,
    "razorpayPaymentId" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "razorpayPaymentId" TEXT NOT NULL,
    "amountRupees" INTEGER NOT NULL,
    "reason" "RefundReason" NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "razorpayRefundId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_orderId_key" ON "payments"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_razorpayOrderId_key" ON "payments"("razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_razorpayPaymentId_key" ON "payments"("razorpayPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_razorpayPaymentId_key" ON "refunds"("razorpayPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_razorpayRefundId_key" ON "refunds"("razorpayRefundId");

-- CreateIndex
CREATE INDEX "refunds_paymentId_idx" ON "refunds"("paymentId");

-- CreateIndex
CREATE INDEX "refunds_status_createdAt_idx" ON "refunds"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A payment is for its order's total in whole rupees, with Razorpay's IDs in
-- Razorpay's form. It is paid exactly when it names the Razorpay payment
-- that paid it (ADR 0027).
ALTER TABLE "payments" ADD CONSTRAINT "payments_details_chk" CHECK (
    "amountRupees" > 0
    AND "razorpayOrderId" ~ '^order_[A-Za-z0-9]{1,40}$'
    AND ("razorpayPaymentId" IS NULL OR "razorpayPaymentId" ~ '^pay_[A-Za-z0-9]{1,40}$')
    AND (("razorpayPaymentId" IS NULL) = ("paidAt" IS NULL))
);

-- A refund gives back a whole Razorpay payment. Once Razorpay has taken it,
-- it names Razorpay's refund.
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_details_chk" CHECK (
    "amountRupees" > 0
    AND "razorpayPaymentId" ~ '^pay_[A-Za-z0-9]{1,40}$'
    AND ("razorpayRefundId" IS NULL OR "razorpayRefundId" ~ '^rfnd_[A-Za-z0-9]{1,40}$')
    AND ("status" NOT IN ('PENDING', 'PROCESSED') OR "razorpayRefundId" IS NOT NULL)
);

-- A payment is made only for an order waiting for payment, and for its
-- total.
CREATE FUNCTION payments_match_their_order() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "orders"
     WHERE "id" = NEW."orderId"
       AND "status" = 'PENDING_PAYMENT'
       AND "totalRupees" = NEW."amountRupees"
  ) THEN
    RAISE EXCEPTION 'a payment is for an order waiting for payment, and for its total'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER payments_match_their_order
  BEFORE INSERT ON "payments"
  FOR EACH ROW EXECUTE FUNCTION payments_match_their_order();

-- A payment is never deleted, and what it is for never changes. Once paid,
-- it stays paid, by the same Razorpay payment.
CREATE FUNCTION payments_keep_what_was_agreed() RETURNS trigger
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
     AND (NEW."razorpayPaymentId", NEW."paidAt")
         IS DISTINCT FROM (OLD."razorpayPaymentId", OLD."paidAt") THEN
    RAISE EXCEPTION 'a paid payment stays paid, by the same Razorpay payment'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER payments_keep_what_was_agreed
  BEFORE UPDATE OR DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION payments_keep_what_was_agreed();

-- A refund gives back a whole payment: the amount of its Razorpay order.
CREATE FUNCTION refunds_match_their_payment() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "payments"
     WHERE "id" = NEW."paymentId" AND "amountRupees" = NEW."amountRupees"
  ) THEN
    RAISE EXCEPTION 'a refund gives back a whole payment'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER refunds_match_their_payment
  BEFORE INSERT ON "refunds"
  FOR EACH ROW EXECUTE FUNCTION refunds_match_their_payment();

-- A refund is never deleted, and what it gives back never changes. Its
-- status only moves forward: REQUESTED, then PENDING, then PROCESSED or
-- FAILED. Razorpay's refund, once named, stays the same.
CREATE FUNCTION refunds_move_forward() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a refund is never deleted'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."id", NEW."paymentId", NEW."razorpayPaymentId", NEW."amountRupees",
      NEW."reason", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."paymentId", OLD."razorpayPaymentId", OLD."amountRupees",
      OLD."reason", OLD."createdAt") THEN
    RAISE EXCEPTION 'what a refund gives back never changes'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."razorpayRefundId" IS NOT NULL
     AND NEW."razorpayRefundId" IS DISTINCT FROM OLD."razorpayRefundId" THEN
    RAISE EXCEPTION 'a refund keeps its Razorpay refund'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" <> OLD."status" AND NOT (
       (OLD."status" = 'REQUESTED' AND NEW."status" IN ('PENDING', 'PROCESSED', 'FAILED'))
    OR (OLD."status" = 'PENDING' AND NEW."status" IN ('PROCESSED', 'FAILED'))
  ) THEN
    RAISE EXCEPTION 'a refund''s status only moves forward'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER refunds_move_forward
  BEFORE UPDATE OR DELETE ON "refunds"
  FOR EACH ROW EXECUTE FUNCTION refunds_move_forward();

-- An order's status only moves forward. An order waiting for payment is
-- paid, cancelled, or expires; an expired one may still be paid, when its
-- stock can be taken again (the owner's rule, ADR 0027). Nothing comes back
-- from paid or cancelled. An order is paid only once its payment names the
-- Razorpay payment that paid it.
CREATE FUNCTION orders_status_moves_forward() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" = OLD."status" THEN
    RETURN NEW;
  END IF;
  IF NOT (
       (OLD."status" = 'PENDING_PAYMENT' AND NEW."status" IN ('PAID', 'CANCELLED', 'EXPIRED'))
    OR (OLD."status" = 'EXPIRED' AND NEW."status" = 'PAID')
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
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_status_moves_forward
  BEFORE UPDATE OF "status" ON "orders"
  FOR EACH ROW EXECUTE FUNCTION orders_status_moves_forward();
