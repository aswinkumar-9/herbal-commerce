# Architecture

Status: **Draft v0.1.** This document describes what exists today and the direction we intend to follow. Items marked "planned" are not built yet.

## 1. Principles

- **Modular monolith first.** One deployable backend whose modules talk through interfaces and never through each other's database tables. Module boundaries are the future seams if a service ever needs to be extracted (ADR 0001).
- **One source of truth.** PostgreSQL decides what is real. Caches and search indexes are disposable copies.
- **Server-side authority.** Authorization, pricing and validation are enforced on the server. Clients are never trusted.
- **Verify before claiming.** Capacity and security claims are made only after they are tested.

## 2. Current state

```
 (planned)                         today
 Customer app / website  ──┐
 Admin console           ──┼──►  NestJS API (apps/api)  ──►  PostgreSQL 17  (via Prisma 7)
                           │            │
                           │            └────────────────►  Valkey 8        (readiness check only)
```

Built so far:

| Area | State |
|------|-------|
| Configuration | Environment variables validated at startup; the app refuses to start on invalid config and never prints secret values |
| Health | `GET /health` (liveness) and `GET /health/ready` (PostgreSQL and Valkey reachable, 503 otherwise) |
| Database | Prisma 7 with the PostgreSQL driver adapter; first migration creates the `users` table with the roles `CUSTOMER`, `ADMIN`, `SUPER_USER` |
| Logging | Structured JSON logs with a request ID on every request (ADR 0006) |
| Errors | One consistent error format that includes the request ID (ADR 0006) |
| Tests | Unit tests for configuration, request IDs, the error filter and the health controller |

Not built yet: authentication, product catalog, inventory, cart, orders, payments, admin console, customer app and website, notifications, support tickets, CI/CD.

## 3. Roles

Three roles: Customer, Admin, Super User (ADR 0004). Customers self-register. Admins are created only by a Super User. Super Users (maximum three) are created by developers with a command-line script, never through the application.

## 4. Request flow (health example)

1. A request arrives. A request ID is taken from a valid `X-Request-Id` header or generated, and returned in the response header.
2. The controller calls the health service.
3. The service runs `SELECT 1` through Prisma and a `PING` against Valkey, each with a 2-second limit.
4. The response is `200` or `503`. Errors use the common error format. Every log line carries the request ID.

## 5. Conventions

- API: REST with OpenAPI documentation (ADR 0002). Versioning and the documentation tooling will be added with the first business endpoints.
- Database: forward-only migrations committed to Git (ADR 0003).
- Secrets: only in the untracked `.env` locally; `.env.example` holds placeholders.
- Module layout (planned): one folder per module under `apps/api/src`, each with controller, service and data access, tested in isolation.

## 6. Planned direction

See `docs/requirements.md` for scope and open decisions. The next module is identity and access (customer registration, staff login with MFA, role enforcement). Scaling work (caching, queues, search, replicas) is introduced only when measurements justify it.
