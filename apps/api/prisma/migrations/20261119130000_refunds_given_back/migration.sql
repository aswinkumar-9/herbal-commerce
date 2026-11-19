-- AlterTable
ALTER TABLE "refunds" ADD COLUMN     "givenBackAt" TIMESTAMP(3),
ADD COLUMN     "givenBackById" UUID,
ADD COLUMN     "givenBackNote" TEXT;

-- CreateIndex
CREATE INDEX "refunds_givenBackById_idx" ON "refunds"("givenBackById");

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_givenBackById_fkey" FOREIGN KEY ("givenBackById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A refund Razorpay could not give back, given back by hand (ADR 0038):
-- when, the note and who, all three or none, only for a FAILED refund. The
-- note has 1 to 500 characters, with no spaces or line breaks at its ends.
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_given_back_chk" CHECK (
    (("givenBackAt" IS NULL) = ("givenBackNote" IS NULL))
    AND (("givenBackAt" IS NULL) = ("givenBackById" IS NULL))
    AND ("givenBackAt" IS NULL OR "status" = 'FAILED')
    AND ("givenBackNote" IS NULL
         OR (char_length("givenBackNote") BETWEEN 1 AND 500
             AND "givenBackNote" = btrim("givenBackNote", E' \t\r\n')))
);

-- Only a Super User gives money back by hand: Admins never handle money
-- (ADR 0028).
CREATE FUNCTION refunds_given_back_by_super_users() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."givenBackById" IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW."givenBackById" IS DISTINCT FROM OLD."givenBackById")
     AND NOT EXISTS (
       SELECT 1 FROM "users" u
        WHERE u."id" = NEW."givenBackById" AND u."role" = 'SUPER_USER'
     ) THEN
    RAISE EXCEPTION 'only a Super User gives a refund back by hand'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER refunds_given_back_by_super_users
  BEFORE INSERT OR UPDATE ON "refunds"
  FOR EACH ROW EXECUTE FUNCTION refunds_given_back_by_super_users();

-- As before (payments), and a refund given back by hand stays so: when, the
-- note and who never change again.
CREATE OR REPLACE FUNCTION refunds_move_forward() RETURNS trigger
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
  IF OLD."givenBackAt" IS NOT NULL
     AND (NEW."givenBackAt", NEW."givenBackNote", NEW."givenBackById")
         IS DISTINCT FROM
         (OLD."givenBackAt", OLD."givenBackNote", OLD."givenBackById") THEN
    RAISE EXCEPTION 'a refund given back by hand stays so'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
