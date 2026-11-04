# 0003. PostgreSQL and Prisma 7

- Status: Accepted
- Date: 2026-10-20
- Updated: 2026-11-01 (part 3C-2: the preview feature `partialIndexes`, and a row lock in raw SQL, see ADR 0019)
- Updated: 2026-11-03 (part 4A: a second row lock, on a category being changed, see ADR 0020)
- Updated: 2026-11-04 (part 4B: a hand-written check constraint, a third row lock, and never editing an applied migration, see ADR 0021)

## Context

The platform needs transactions, relational integrity and mature migrations. The owner wants to own the data and avoid proprietary lock-in.

## Decision

- PostgreSQL 17 (local via Docker) as the single source of truth.
- Prisma ORM, pinned to **major version 7**, with the `@prisma/adapter-pg` driver adapter.
- The backend is CommonJS, so the Prisma generator sets `moduleFormat = "cjs"`.
- The generated client lives in `apps/api/src/generated/prisma` and is not committed. Run `prisma generate` after cloning and before building in CI.
- Prisma commands run from `apps/api`, and the configuration file loads the root `.env`.
- Migrations are SQL files committed to Git and are **forward-only**. Prisma Migrate has no automatic "down" migration.
- **Every index lives in the schema,** so Prisma never drops one at a later migration. A partial index uses the preview feature `partialIndexes` (since part 3C-2, ADR 0019). Things Prisma does not manage at all are added by hand to a migration: triggers (ADR 0012) and check constraints (the lowercase email, and since part 4B the rule for live products, ADR 0021).
  1. Create the migration with `migrate dev --create-only`.
  2. Add the SQL **after the last line**, keeping everything Prisma wrote.
  3. Then apply it.
- **Never edit a migration that has been applied.** Prisma keeps a checksum of each one, and a changed file makes it want to reset the database. A forgotten piece goes into a new migration instead (part 4B, ADR 0021).
- **Before naming a migration that `migrate dev` asks for unexpectedly,** look at what it would contain: `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` only reads.
- **Raw SQL only as a tagged template** (`` $queryRaw`... ${value} ...` ``), so values travel as parameters. Never `$queryRawUnsafe`.

## Why Prisma is pinned to 7

At the time of writing, the `latest` tag of the `prisma` package on npm pointed to a pre-release of a newer major version that lacked the `migrate` and `generate` commands we use. Install with `prisma@7` and `@prisma/client@7` and keep them on the same major version. Revisit when a newer major version is stable.

## Rollback strategy

- Development: `prisma migrate reset` wipes and replays migrations (never used on real data).
- Production: use backward-compatible changes (expand, migrate, contract) and restore from backups or point-in-time recovery if needed. Backup and restore procedures will be documented and rehearsed before launch.

## Consequences

- Strong typing and a clear migration history.
- Atomic stock updates and other hot paths may need explicit SQL, which Prisma supports. The first case is the row lock that keeps a customer's address changes in turn (ADR 0019), the second the lock that keeps changes to one category in turn (ADR 0020), and the third the same for a product (ADR 0021).
- The Prisma generator and driver setup differs between major versions, so upgrades are deliberate and tested.
