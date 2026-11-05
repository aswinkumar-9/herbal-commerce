-- Product images (ADR 0023). From now on a live product needs at least one
-- image, and a product that is already live would have none. So this
-- migration refuses to run while any product is live: take them offline
-- first, then add their images after it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "products" WHERE "isActive") THEN
    RAISE EXCEPTION 'a product is live without an image: take every product offline first (ADR 0023)';
  END IF;
END $$;

-- CreateTable
CREATE TABLE "product_images" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "fileKey" UUID NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "altText" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_images_fileKey_key" ON "product_images"("fileKey");

-- CreateIndex
CREATE INDEX "product_images_productId_idx" ON "product_images"("productId");

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A product has at most 6 images (ADR 0023). The API checks first, for a
-- clear message; this trigger is the backstop that no code path can skip.
CREATE FUNCTION product_images_at_most_six() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- One check at a time per product, so two parallel uploads cannot both
  -- see room for one more.
  PERFORM 1 FROM "products" WHERE "id" = NEW."productId" FOR UPDATE;
  IF (SELECT count(*) FROM "product_images"
      WHERE "productId" = NEW."productId" AND "id" <> NEW."id") >= 6 THEN
    RAISE EXCEPTION 'a product has at most 6 images'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER product_images_at_most_six
  BEFORE INSERT OR UPDATE OF "productId" ON "product_images"
  FOR EACH ROW EXECUTE FUNCTION product_images_at_most_six();

-- A live product has at least one image (ADR 0023): checked when a product
-- goes live, and when a product loses an image. The API checks first; these
-- two triggers are the backstop.
CREATE FUNCTION products_live_needs_an_image() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "product_images" WHERE "productId" = NEW."id") THEN
    RAISE EXCEPTION 'a live product needs at least one image'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER products_live_needs_an_image
  AFTER INSERT OR UPDATE OF "isActive" ON "products"
  FOR EACH ROW WHEN (NEW."isActive")
  EXECUTE FUNCTION products_live_needs_an_image();

CREATE FUNCTION product_images_keep_one_while_live() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Lock the product first, so a change to it that is in progress (such as
  -- going live) finishes before the check looks at it.
  PERFORM 1 FROM "products" WHERE "id" = OLD."productId" FOR UPDATE;
  -- A product deleted together with its images is no longer found here.
  IF EXISTS (SELECT 1 FROM "products"
             WHERE "id" = OLD."productId" AND "isActive")
     AND NOT EXISTS (SELECT 1 FROM "product_images"
                     WHERE "productId" = OLD."productId") THEN
    RAISE EXCEPTION 'a live product needs at least one image'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER product_images_keep_one_while_live
  AFTER DELETE OR UPDATE OF "productId" ON "product_images"
  FOR EACH ROW EXECUTE FUNCTION product_images_keep_one_while_live();
