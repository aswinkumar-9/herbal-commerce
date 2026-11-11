-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('ORDER_PAID', 'ORDER_PACKED', 'ORDER_SHIPPED', 'SHIPMENT_CORRECTED', 'ORDER_DELIVERED', 'ORDER_CANCELLED', 'REFUND_PROCESSED', 'REFUND_FAILED');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('WAITING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "orderId" UUID NOT NULL,
    "refundId" UUID,
    "status" "NotificationStatus" NOT NULL DEFAULT 'WAITING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_status_nextAttemptAt_idx" ON "notifications"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_once_per_order" ON "notifications"("orderId", "kind") WHERE ("refundId" IS NULL AND "kind" != 'SHIPMENT_CORRECTED');

-- CreateIndex
CREATE UNIQUE INDEX "notifications_refundId_kind_key" ON "notifications"("refundId", "kind");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The emails about orders (ADR 0029). Above, Prisma's table; below, the
-- rules the database keeps, whichever code writes to it.

-- An email about a refund names its refund, and an email about an order
-- names none. A sent email says when, and an email that is sent or
-- failed was tried at least once.
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_details_chk" CHECK (
    (("refundId" IS NOT NULL) = ("kind" IN ('REFUND_PROCESSED', 'REFUND_FAILED')))
    AND (("sentAt" IS NOT NULL) = ("status" = 'SENT'))
    AND ("status" = 'WAITING' OR "attempts" >= 1)
);

-- An email tells only what is true when it is saved, in the same
-- transaction as the change: the order is in the status it tells of, and
-- a refund is one of the order's, given back or failed as it tells. A new
-- email waits to be sent, and has not been tried.
CREATE FUNCTION notifications_tell_the_truth() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" <> 'WAITING' OR NEW."attempts" <> 0 THEN
    RAISE EXCEPTION 'a new email waits to be sent'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."kind" IN ('REFUND_PROCESSED', 'REFUND_FAILED') THEN
    IF NOT EXISTS (
      SELECT 1 FROM "refunds" r
        JOIN "payments" p ON p."id" = r."paymentId"
       WHERE r."id" = NEW."refundId"
         AND p."orderId" = NEW."orderId"
         AND r."status" = CASE NEW."kind"
                            WHEN 'REFUND_PROCESSED' THEN 'PROCESSED'
                            ELSE 'FAILED'
                          END::"RefundStatus"
    ) THEN
      RAISE EXCEPTION 'an email about a refund tells what happened to one of its order''s refunds'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM "orders"
     WHERE "id" = NEW."orderId"
       AND "status" = CASE NEW."kind"
                        WHEN 'ORDER_PAID' THEN 'PAID'
                        WHEN 'ORDER_PACKED' THEN 'PACKED'
                        WHEN 'ORDER_SHIPPED' THEN 'SHIPPED'
                        WHEN 'SHIPMENT_CORRECTED' THEN 'SHIPPED'
                        WHEN 'ORDER_DELIVERED' THEN 'DELIVERED'
                        WHEN 'ORDER_CANCELLED' THEN 'CANCELLED'
                      END::"OrderStatus"
  ) THEN
    RAISE EXCEPTION 'an email about an order tells the status it is in'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER notifications_tell_the_truth
  BEFORE INSERT ON "notifications"
  FOR EACH ROW EXECUTE FUNCTION notifications_tell_the_truth();

-- An email is never deleted, and what it is about never changes. It waits
-- until it is sent or fails, and then stays as it is. Its tries only add up.
CREATE FUNCTION notifications_move_forward() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'an email about an order is never deleted'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."id", NEW."kind", NEW."orderId", NEW."refundId", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."kind", OLD."orderId", OLD."refundId", OLD."createdAt") THEN
    RAISE EXCEPTION 'what an email is about never changes'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" <> 'WAITING' THEN
    RAISE EXCEPTION 'an email that is sent or failed stays as it is'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."attempts" < OLD."attempts" THEN
    RAISE EXCEPTION 'an email''s tries only add up'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER notifications_move_forward
  BEFORE UPDATE OR DELETE ON "notifications"
  FOR EACH ROW EXECUTE FUNCTION notifications_move_forward();
