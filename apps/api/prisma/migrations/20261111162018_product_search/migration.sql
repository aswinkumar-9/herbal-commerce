-- The search for products (ADR 0030). pg_trgm compares words by their
-- three-letter pieces, so a part of a word, or a word with a typo, still
-- matches. It ships with PostgreSQL, and is trusted: the database's owner
-- may add it without being a superuser.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "products_name_trgm_idx" ON "products" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "products_summary_trgm_idx" ON "products" USING GIN ("summary" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "products_description_trgm_idx" ON "products" USING GIN ("description" gin_trgm_ops);

