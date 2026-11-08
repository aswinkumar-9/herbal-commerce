-- Orders take packs from batches and give them back (ADR 0026). An ORDERED
-- movement only removes and a RELEASED one only adds; both name their
-- order, and no other movement names one. The new reasons were added by the
-- previous migration: PostgreSQL uses a new enum value only once the
-- transaction that added it has ended.
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_change_chk";
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_change_chk" CHECK (
    "change" <> 0
    AND ("reason" NOT IN ('RECEIVED', 'RELEASED') OR "change" > 0)
    AND ("reason" NOT IN ('DAMAGED', 'EXPIRED', 'ORDERED') OR "change" < 0)
    AND (("reason" IN ('ORDERED', 'RELEASED')) = ("orderId" IS NOT NULL))
);

-- An order gives back to a batch at most what it took from it.
CREATE FUNCTION stock_movements_release_what_was_ordered() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."reason" = 'RELEASED' AND NEW."change" + (
    SELECT COALESCE(sum("change"), 0) FROM "stock_movements"
     WHERE "orderId" = NEW."orderId" AND "batchId" = NEW."batchId"
  ) > 0 THEN
    RAISE EXCEPTION 'an order gives back at most what it took from a batch'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER stock_movements_release_what_was_ordered
  BEFORE INSERT ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION stock_movements_release_what_was_ordered();
