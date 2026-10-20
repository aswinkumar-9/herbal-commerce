# 0003. PostgreSQL and Prisma 7

- Status: Accepted
- Date: 2026-10-20

## Context

The platform needs transactions, relational integrity and mature migrations. The owner wants to own the data and avoid proprietary lock-in.

## Decision

- PostgreSQL 17 (local via Docker) as the single source of truth.
- Prisma ORM, pinned to **major version 7**, with the `@prisma/adapter-pg` driver adapter.
- The backend is CommonJS, so the Prisma generator sets `moduleFormat = "cjs"`.
- The generated client lives in `apps/api/src/generated/prisma` and is not committed. Run `prisma generate` after cloning and before building in CI.
- Prisma commands run from `apps/api`, and the configuration file loads the root `.env`.
- Migrations are SQL files committed to Git and are **forward-only**. Prisma Migrate has no automatic "down" migration.

## Why Prisma is pinned to 7

At the time of writing, the `latest` tag of the `prisma` package on npm pointed to a pre-release of a newer major version that lacked the `migrate` and `generate` commands we use. Install with `prisma@7` and `@prisma/client@7` and keep them on the same major version. Revisit when a newer major version is stable.

## Rollback strategy

- Development: `prisma migrate reset` wipes and replays migrations (never used on real data).
- Production: use backward-compatible changes (expand, migrate, contract) and restore from backups or point-in-time recovery if needed. Backup and restore procedures will be documented and rehearsed before launch.

## Consequences

- Strong typing and a clear migration history.
- Atomic stock updates and other hot paths may need explicit SQL, which Prisma supports.
- The Prisma generator and driver setup differs between major versions, so upgrades are deliberate and tested.
