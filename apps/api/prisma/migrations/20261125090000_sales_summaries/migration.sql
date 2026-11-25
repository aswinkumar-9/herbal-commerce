-- Part 15C, step 3 (ADR 0046): what was sold each day in India, for the
-- reports. Filled only by rebuild_sales_summaries() below, from the paid
-- payments and their refunds; never written otherwise.

-- Each day's order lines, by what they are reported under (the order
-- line's own record of it, step 1), the state they went to, and how they
-- were paid (step 2; none for payments before part 15C). The rupees are the
-- lines' totals, GST included, as the orders show them; and the GST inside.
CREATE TABLE "daily_line_sales" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "day" DATE NOT NULL,
    "deliveryState" TEXT NOT NULL,
    "method" "PaymentMethod",
    "productId" UUID,
    "productName" TEXT NOT NULL,
    "topCategoryId" UUID,
    "topCategoryName" TEXT,
    "subcategoryId" UUID,
    "subcategoryName" TEXT,
    "brandId" UUID,
    "brandName" TEXT,
    "soldPacks" INTEGER NOT NULL,
    "soldRupees" INTEGER NOT NULL,
    "soldGstRupees" INTEGER NOT NULL,
    "refundedPacks" INTEGER NOT NULL,
    "refundedRupees" INTEGER NOT NULL,
    "refundedGstRupees" INTEGER NOT NULL,

    CONSTRAINT "daily_line_sales_pkey" PRIMARY KEY ("id")
);

-- Each day's orders, by the state they went to and how they were paid: the
-- delivery charge belongs to an order, not to its lines.
CREATE TABLE "daily_order_sales" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "day" DATE NOT NULL,
    "deliveryState" TEXT NOT NULL,
    "method" "PaymentMethod",
    "soldOrders" INTEGER NOT NULL,
    "soldItemsRupees" INTEGER NOT NULL,
    "soldGstRupees" INTEGER NOT NULL,
    "soldDeliveryRupees" INTEGER NOT NULL,
    "refundedOrders" INTEGER NOT NULL,
    "refundedItemsRupees" INTEGER NOT NULL,
    "refundedGstRupees" INTEGER NOT NULL,
    "refundedDeliveryRupees" INTEGER NOT NULL,

    CONSTRAINT "daily_order_sales_pkey" PRIMARY KEY ("id")
);

-- When the summaries were last rebuilt: one row, once they have been.
CREATE TABLE "sales_summary_refreshes" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "refreshedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_summary_refreshes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_summary_refreshes_one_row" CHECK ("id" = 1)
);

CREATE INDEX "daily_line_sales_day_idx" ON "daily_line_sales"("day");
CREATE INDEX "daily_order_sales_day_idx" ON "daily_order_sales"("day");

-- For finding a few days' payments and refunds.
CREATE INDEX "payments_paidAt_idx" ON "payments"("paidAt");
CREATE INDEX "refunds_createdAt_idx" ON "refunds"("createdAt");

-- Rebuilds the summaries of the days from first_day to last_day, both
-- included, or of every day up to last_day when first_day is null. The
-- owner's rules (2026-11-23):
-- - a payment counts on the day in India it was paid; orders never paid
--   don't count;
-- - its refund is taken off on the day in India the refund was made. Only
--   the refund of the payment that paid an order: the others give back
--   payments that never counted (a second payment, or one for an order
--   cancelled or expired before it was paid). Refunds are always in full;
--   one that Razorpay refused still counts, as staff give it back by hand.
-- India is always UTC+5:30, and the database keeps UTC. What a past day
-- holds never changes (payments, refunds and orders keep what was agreed),
-- so rebuilding a few recent days keeps every day right.
-- One statement, so both tables are made from the same moment; one rebuild
-- at a time, from any API instance.
CREATE FUNCTION rebuild_sales_summaries(first_day DATE, last_day DATE)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('rebuild_sales_summaries'));
  -- Each payment on the day it was paid (an unpaid one has no paidAt, so
  -- none of these days), and each refund of one on the day it was made.
  WITH "events" AS (
    SELECT p."orderId", p."method",
           (p."paidAt" + INTERVAL '330 minutes')::date AS "day",
           false AS "refunded"
      FROM "payments" p
     WHERE (first_day IS NULL
            OR p."paidAt" >= first_day - INTERVAL '330 minutes')
       AND p."paidAt" < (last_day + 1) - INTERVAL '330 minutes'
    UNION ALL
    SELECT p."orderId", p."method",
           (r."createdAt" + INTERVAL '330 minutes')::date,
           true
      FROM "refunds" r
      JOIN "payments" p ON p."razorpayPaymentId" = r."razorpayPaymentId"
     WHERE (first_day IS NULL
            OR r."createdAt" >= first_day - INTERVAL '330 minutes')
       AND r."createdAt" < (last_day + 1) - INTERVAL '330 minutes'
  ),
  "old_lines" AS (
    DELETE FROM "daily_line_sales"
     WHERE (first_day IS NULL OR "day" >= first_day) AND "day" <= last_day
  ),
  "old_orders" AS (
    DELETE FROM "daily_order_sales"
     WHERE (first_day IS NULL OR "day" >= first_day) AND "day" <= last_day
  ),
  "lines" AS (
    INSERT INTO "daily_line_sales" (
      "day", "deliveryState", "method", "productId", "productName",
      "topCategoryId", "topCategoryName", "subcategoryId", "subcategoryName",
      "brandId", "brandName",
      "soldPacks", "soldRupees", "soldGstRupees",
      "refundedPacks", "refundedRupees", "refundedGstRupees")
    SELECT e."day", o."deliveryState", e."method", i."productId",
           i."productName", i."topCategoryId", i."topCategoryName",
           i."subcategoryId", i."subcategoryName", i."brandId", i."brandName",
           SUM(CASE WHEN e."refunded" THEN 0 ELSE i."packs" END),
           SUM(CASE WHEN e."refunded" THEN 0 ELSE i."lineTotalRupees" END),
           SUM(CASE WHEN e."refunded" THEN 0 ELSE i."gstRupees" END),
           SUM(CASE WHEN e."refunded" THEN i."packs" ELSE 0 END),
           SUM(CASE WHEN e."refunded" THEN i."lineTotalRupees" ELSE 0 END),
           SUM(CASE WHEN e."refunded" THEN i."gstRupees" ELSE 0 END)
      FROM "events" e
      JOIN "orders" o ON o."id" = e."orderId"
      JOIN "order_items" i ON i."orderId" = o."id"
     GROUP BY e."day", o."deliveryState", e."method", i."productId",
              i."productName", i."topCategoryId", i."topCategoryName",
              i."subcategoryId", i."subcategoryName", i."brandId",
              i."brandName"
  )
  INSERT INTO "daily_order_sales" (
    "day", "deliveryState", "method",
    "soldOrders", "soldItemsRupees", "soldGstRupees", "soldDeliveryRupees",
    "refundedOrders", "refundedItemsRupees", "refundedGstRupees",
    "refundedDeliveryRupees")
  SELECT e."day", o."deliveryState", e."method",
         COUNT(*) FILTER (WHERE NOT e."refunded"),
         SUM(CASE WHEN e."refunded" THEN 0 ELSE o."itemsTotalRupees" END),
         SUM(CASE WHEN e."refunded" THEN 0 ELSE o."itemsGstRupees" END),
         SUM(CASE WHEN e."refunded" THEN 0 ELSE o."deliveryChargeRupees" END),
         COUNT(*) FILTER (WHERE e."refunded"),
         SUM(CASE WHEN e."refunded" THEN o."itemsTotalRupees" ELSE 0 END),
         SUM(CASE WHEN e."refunded" THEN o."itemsGstRupees" ELSE 0 END),
         SUM(CASE WHEN e."refunded" THEN o."deliveryChargeRupees" ELSE 0 END)
    FROM "events" e
    JOIN "orders" o ON o."id" = e."orderId"
   GROUP BY e."day", o."deliveryState", e."method";

  INSERT INTO "sales_summary_refreshes" ("id", "refreshedAt")
  VALUES (1, now() AT TIME ZONE 'UTC')
  ON CONFLICT ("id") DO UPDATE SET "refreshedAt" = EXCLUDED."refreshedAt";
END;
$$;
