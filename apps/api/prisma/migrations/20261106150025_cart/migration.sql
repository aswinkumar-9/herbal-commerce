-- CreateTable
CREATE TABLE "carts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" UUID NOT NULL,
    "cartId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "packs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "carts_userId_key" ON "carts"("userId");

-- CreateIndex
CREATE INDEX "carts_updatedAt_idx" ON "carts"("updatedAt");

-- CreateIndex
CREATE INDEX "cart_items_variantId_idx" ON "cart_items"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cartId_variantId_key" ON "cart_items"("cartId", "variantId");

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A line holds 1 to 4 packs (ADR 0025).
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_packs_chk" CHECK (
    "packs" BETWEEN 1 AND 4
);

-- A cart holds at most 4 packs of one product, all its pack sizes
-- together, and at most 50 pack sizes (ADR 0025). The cart's row is locked
-- first, so two changes to one cart take turns and the second one counts
-- the first. This lock (NO KEY UPDATE) never waits for the foreign keys'
-- own locks, so two lines added at once cannot deadlock.
CREATE FUNCTION cart_items_limits() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  product_packs INTEGER;
  pack_sizes INTEGER;
BEGIN
  PERFORM 1 FROM "carts" WHERE "id" = NEW."cartId" FOR NO KEY UPDATE;
  SELECT COALESCE(sum(i."packs"), 0) INTO product_packs
    FROM "cart_items" i
    JOIN "product_variants" v ON v."id" = i."variantId"
   WHERE i."cartId" = NEW."cartId"
     AND v."productId" = (
       SELECT "productId" FROM "product_variants" WHERE "id" = NEW."variantId"
     );
  IF product_packs > 4 THEN
    RAISE EXCEPTION 'a cart holds at most 4 packs of one product'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*) INTO pack_sizes FROM "cart_items" WHERE "cartId" = NEW."cartId";
  IF pack_sizes > 50 THEN
    RAISE EXCEPTION 'a cart holds at most 50 pack sizes'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER cart_items_limits
  AFTER INSERT OR UPDATE OF "packs", "variantId", "cartId" ON "cart_items"
  FOR EACH ROW EXECUTE FUNCTION cart_items_limits();
