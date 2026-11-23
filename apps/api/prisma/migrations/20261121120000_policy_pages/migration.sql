-- CreateEnum
CREATE TYPE "PolicyKind" AS ENUM ('PRIVACY', 'TERMS', 'REFUNDS', 'SHIPPING', 'CONTACT');

-- CreateTable
CREATE TABLE "policy_pages" (
    "kind" "PolicyKind" NOT NULL,
    "draft" TEXT,
    "draftUpdatedAt" TIMESTAMP(3),
    "draftUpdatedById" UUID,
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "policy_pages_pkey" PRIMARY KEY ("kind")
);

-- CreateTable
CREATE TABLE "policy_versions" (
    "id" UUID NOT NULL,
    "kind" "PolicyKind" NOT NULL,
    "version" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" UUID NOT NULL,

    CONSTRAINT "policy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "policy_pages_draftUpdatedById_idx" ON "policy_pages"("draftUpdatedById");

-- CreateIndex
CREATE INDEX "policy_versions_publishedById_idx" ON "policy_versions"("publishedById");

-- CreateIndex
CREATE UNIQUE INDEX "policy_versions_kind_version_key" ON "policy_versions"("kind", "version");

-- AddForeignKey
ALTER TABLE "policy_pages" ADD CONSTRAINT "policy_pages_draftUpdatedById_fkey" FOREIGN KEY ("draftUpdatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_kind_fkey" FOREIGN KEY ("kind") REFERENCES "policy_pages"("kind") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A policy page's draft (ADR 0040): its text, when and by whom it was saved,
-- all three or none. The text has 1 to 30000 characters, with Unix line
-- ends and no spaces or line breaks at its ends, as the API cleans it.
ALTER TABLE "policy_pages" ADD CONSTRAINT "policy_pages_draft_chk" CHECK (
    (("draft" IS NULL) = ("draftUpdatedAt" IS NULL))
    AND (("draft" IS NULL) = ("draftUpdatedById" IS NULL))
    AND ("draft" IS NULL
         OR (char_length("draft") BETWEEN 1 AND 30000
             AND strpos("draft", E'\r') = 0
             AND "draft" = btrim("draft", E' \t\n')))
    AND "revision" >= 0
);

-- A published version: numbered from 1, with the same rules for its text.
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_chk" CHECK (
    "version" >= 1
    AND char_length("body") BETWEEN 1 AND 30000
    AND strpos("body", E'\r') = 0
    AND "body" = btrim("body", E' \t\n')
);

-- Only a Super User saves a policy page's draft or publishes it.
CREATE FUNCTION policies_by_super_users() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor UUID;
BEGIN
  IF TG_TABLE_NAME = 'policy_pages' THEN
    actor := NEW."draftUpdatedById";
  ELSE
    actor := NEW."publishedById";
  END IF;
  IF actor IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM "users" u WHERE u."id" = actor AND u."role" = 'SUPER_USER'
     ) THEN
    RAISE EXCEPTION 'only a Super User writes the policy pages'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER policy_pages_by_super_users
  BEFORE INSERT OR UPDATE ON "policy_pages"
  FOR EACH ROW EXECUTE FUNCTION policies_by_super_users();

CREATE TRIGGER policy_versions_by_super_users
  BEFORE INSERT ON "policy_versions"
  FOR EACH ROW EXECUTE FUNCTION policies_by_super_users();

-- A page keeps its kind, and every change to it moves its revision on by
-- exactly one, so a Super User working on an older revision is always told.
CREATE FUNCTION policy_pages_move_forward() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a policy page is never deleted'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."kind" <> OLD."kind" THEN
    RAISE EXCEPTION 'a policy page keeps its kind'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."revision" <> OLD."revision" + 1 THEN
    RAISE EXCEPTION 'every change to a policy page moves its revision on by one'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER policy_pages_move_forward
  BEFORE UPDATE OR DELETE ON "policy_pages"
  FOR EACH ROW EXECUTE FUNCTION policy_pages_move_forward();

-- What customers were shown is kept as it was: a version is never changed
-- or deleted, and each page's versions are numbered 1, 2, 3 with no gaps.
CREATE FUNCTION policy_versions_kept() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'a published policy version is never changed or deleted'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."version" <> 1 + COALESCE(
       (SELECT max(v."version") FROM "policy_versions" v WHERE v."kind" = NEW."kind"), 0) THEN
    RAISE EXCEPTION 'a policy page''s versions are numbered with no gaps'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER policy_versions_kept
  BEFORE INSERT OR UPDATE OR DELETE ON "policy_versions"
  FOR EACH ROW EXECUTE FUNCTION policy_versions_kept();
