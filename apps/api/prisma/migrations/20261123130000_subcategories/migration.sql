-- Subcategories (part 15A): a category may sit inside a top category. Only
-- two levels, which the API checks with the rows locked. A category that
-- still has subcategories can't be deleted. Categories already in the
-- catalog stay top categories.

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "parentId" UUID;

-- CreateIndex
CREATE INDEX "categories_parentId_idx" ON "categories"("parentId");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A category never sits inside itself. The API checks this first, with a
-- clear error; this is the last line of defence.
ALTER TABLE "categories" ADD CONSTRAINT "categories_not_own_parent_chk" CHECK ("parentId" <> "id");
