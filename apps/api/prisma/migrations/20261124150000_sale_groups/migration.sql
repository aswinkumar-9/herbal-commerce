-- Part 15C, step 1 (ADR 0046): each order line keeps what its sale is
-- reported under, as it was when the order was placed: the product, the
-- top category and the subcategory of its main category, and its brand,
-- each by ID and by name. No foreign keys, like the pack size's ID: the
-- order outlives the catalog.
ALTER TABLE "order_items"
  ADD COLUMN "productId" UUID,
  ADD COLUMN "topCategoryId" UUID,
  ADD COLUMN "topCategoryName" TEXT,
  ADD COLUMN "subcategoryId" UUID,
  ADD COLUMN "subcategoryName" TEXT,
  ADD COLUMN "brandId" UUID,
  ADD COLUMN "brandName" TEXT;

-- An ID always comes with its name, and a subcategory only inside a top
-- category.
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_top_category_named"
    CHECK (("topCategoryId" IS NULL) = ("topCategoryName" IS NULL)),
  ADD CONSTRAINT "order_items_subcategory_named"
    CHECK (("subcategoryId" IS NULL) = ("subcategoryName" IS NULL)),
  ADD CONSTRAINT "order_items_brand_named"
    CHECK (("brandId" IS NULL) = ("brandName" IS NULL)),
  ADD CONSTRAINT "order_items_subcategory_in_top"
    CHECK ("subcategoryId" IS NULL OR "topCategoryId" IS NOT NULL);

-- The lines placed before part 15C get them from the catalog as it is now:
-- the owner's choice on 2026-11-24, while the shop is not live yet. A line
-- whose pack size has been deleted stays without. In this transaction
-- only, with the guard off: an order's lines never change otherwise.
ALTER TABLE "order_items" DISABLE TRIGGER order_items_are_final;
UPDATE "order_items" AS oi
   SET "productId" = p."id",
       "topCategoryId" = COALESCE(top."id", c."id"),
       "topCategoryName" = COALESCE(top."name", c."name"),
       "subcategoryId" = CASE WHEN top."id" IS NULL THEN NULL ELSE c."id" END,
       "subcategoryName" = CASE WHEN top."id" IS NULL THEN NULL ELSE c."name" END,
       "brandId" = b."id",
       "brandName" = b."name"
  FROM "product_variants" v
  JOIN "products" p ON p."id" = v."productId"
  JOIN "categories" c ON c."id" = p."categoryId"
  LEFT JOIN "categories" top ON top."id" = c."parentId"
  LEFT JOIN "brands" b ON b."id" = p."brandId"
 WHERE v."id" = oi."variantId";
ALTER TABLE "order_items" ENABLE TRIGGER order_items_are_final;

-- From now on every new line has its product and its top category. The
-- lines from before are not checked (NOT VALID), as a deleted pack size
-- left some without.
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_reported"
    CHECK ("productId" IS NOT NULL AND "topCategoryId" IS NOT NULL) NOT VALID;
