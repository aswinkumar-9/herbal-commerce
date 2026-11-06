# 0003. PostgreSQL and Prisma 7

- Status: Accepted
- Date: 2026-10-20
- Updated: 2026-11-01 (part 3C-2: the preview feature `partialIndexes`, and a row lock in raw SQL, see ADR 0019)
- Updated: 2026-11-03 (part 4A: a second row lock, on a category being changed, see ADR 0020)
- Updated: 2026-11-04 (part 4B: a hand-written check constraint, a third row lock, and never editing an applied migration, see ADR 0021)
- Updated: 2026-11-05 (part 4C: renaming a column by hand, a guard in a migration, a fourth row lock, and keeping search and replace away from applied migrations, see ADR 0022)
- Updated: 2026-11-06 (part 4D: triggers for rules across rows, a hash check before applying a migration, SQL tests as files, and the image row locks, see ADR 0023)

## Context

The platform needs transactions, relational integrity and mature migrations. The owner wants to own the data and avoid proprietary lock-in.

## Decision

- PostgreSQL 17 (local via Docker) as the single source of truth.
- Prisma ORM, pinned to **major version 7**, with the `@prisma/adapter-pg` driver adapter.
- The backend is CommonJS, so the Prisma generator sets `moduleFormat = "cjs"`.
- The generated client lives in `apps/api/src/generated/prisma` and is not committed. Run `prisma generate` after cloning and before building in CI.
- Prisma commands run from `apps/api`, and the configuration file loads the root `.env`.
- Migrations are SQL files committed to Git and are **forward-only**. Prisma Migrate has no automatic "down" migration.
- **Every index lives in the schema,** so Prisma never drops one at a later migration. A partial index uses the preview feature `partialIndexes` (since part 3C-2, ADR 0019). Things Prisma does not manage at all are added by hand to a migration: triggers (ADR 0012, and since part 4D the image rules, ADR 0023) and check constraints (the lowercase email, since part 4B the rule for live products, ADR 0021, and since part 4C the price within the MRP, ADR 0022).
  - **A check constraint sees one row; a trigger can look at other rows.** A rule that counts the rows of another table, such as "at most 6 images" or "a live product has an image", needs a trigger. A trigger that counts locks the parent row first, so two changes at the same moment take turns (part 4D, ADR 0023).
  1. Create the migration with `migrate dev --create-only`.
  2. Add the SQL **after the last line**, keeping everything Prisma wrote.
  3. Then apply it.
- **Never edit a migration that has been applied.** Prisma keeps a checksum of each one, and a changed file makes it want to reset the database. A forgotten piece goes into a new migration instead (part 4B, ADR 0021).
  - **This includes a project-wide search and replace.** Limit it to the folders meant, and compare the number of matches with the expected one before replacing (part 4C, ADR 0022).
  - `prisma migrate status` does not compare checksums. `prisma migrate dev` does, and it also replays every migration on a temporary "shadow" database, so `Already in sync` proves both.
  - A migration that is created but **not yet applied** may still be corrected.
  - **Check a hand-written migration before applying it:** its SHA-256 (`Get-FileHash`) must match the file that was tested. A paste mistake is then caught while the file can still be fixed (part 4D, ADR 0023).
- **Renaming a column:** Prisma cannot tell a rename from a removed column and a new one, so it writes `DROP COLUMN` and `ADD COLUMN`. That loses the data, and everything that refers to the column, such as a check constraint. Create the migration with `--create-only` and replace its SQL with `ALTER TABLE … RENAME COLUMN …` before applying it (part 4C, ADR 0022).
- **A migration that could misread existing data refuses to run.** A `DO $$ … RAISE EXCEPTION … $$` block checks first. Example: prices changed from paise to rupees only while no pack size existed (part 4C).
- **Test new SQL inside a transaction that is rolled back,** on temporary tables, and write the test as a file that starts with `\set ON_ERROR_STOP on` and `BEGIN;`. Then nothing runs unless the transaction has really begun. A test typed through several layers of shell quoting once lost its `BEGIN`, ran outside any transaction, and left three functions behind that had to be removed (part 4D).
- **Before naming a migration that `migrate dev` asks for unexpectedly,** look at what it would contain: `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` only reads.
- **Raw SQL only as a tagged template** (`` $queryRaw`... ${value} ...` ``), so values travel as parameters. Never `$queryRawUnsafe`.

## Why Prisma is pinned to 7

At the time of writing, the `latest` tag of the `prisma` package on npm pointed to a pre-release of a newer major version that lacked the `migrate` and `generate` commands we use. Install with `prisma@7` and `@prisma/client@7` and keep them on the same major version. Revisit when a newer major version is stable.

## Rollback strategy

- Development: `prisma migrate reset` wipes and replays migrations (never used on real data).
- Production: use backward-compatible changes (expand, migrate, contract) and restore from backups or point-in-time recovery if needed. Backup and restore procedures will be documented and rehearsed before launch.

## Consequences

- Strong typing and a clear migration history.
- Atomic stock updates and other hot paths may need explicit SQL, which Prisma supports. The first case is the row lock that keeps a customer's address changes in turn (ADR 0019), the second the lock that keeps changes to one category in turn (ADR 0020), the third the same for a product (ADR 0021), the fourth for a pack size (ADR 0022), and the fifth and sixth for a product's images: the product is locked before an image is added or deleted, and an image before it is changed (ADR 0023).
- The Prisma generator and driver setup differs between major versions, so upgrades are deliberate and tested.
