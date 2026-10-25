# Architecture

Status: **Draft v0.2.** This document describes what exists today and the direction we intend to follow. Items marked "planned" are not built yet.

## 1. Principles

- **Modular monolith first.** One deployable backend whose modules talk through interfaces and never through each other's database tables. Module boundaries are the future seams if a service ever needs to be extracted (ADR 0001).
- **One source of truth.** PostgreSQL decides what is real. Caches and search indexes are disposable copies.
- **Server-side authority.** Authorization, pricing and validation are enforced on the server. Clients are never trusted.
- **Secure by default.** Every endpoint is protected unless it is explicitly marked public, and every request inherits the same security baseline (ADR 0008, `docs/security.md`).
- **Verify before claiming.** Capacity and security claims are made only after they are tested.

## 2. Current state

```
 (planned)                         today
 Customer app / website  ──┐
 Admin console           ──┼──►  NestJS API (apps/api)  ──►  PostgreSQL 17  (via Prisma 7)
                           │            │
                           │            ├────────────────►  Valkey 8        (readiness check only)
                           │            │
                           │            └────────────────►  SMTP            (Mailpit in development)
```

Built so far:

| Area | State |
|------|-------|
| Configuration | Environment variables validated at startup. The app refuses to start on invalid config and never prints secret values. In production it also refuses placeholder secrets and a non-HTTPS website URL (ADR 0008). |
| Health | `GET /health` (liveness) and `GET /health/ready` (PostgreSQL and Valkey reachable, 503 otherwise) |
| Database | Prisma 7 with the PostgreSQL driver adapter. Tables: `users` (roles `CUSTOMER`, `ADMIN`, `SUPER_USER`), `email_verification_tokens`, `sessions` and `refresh_tokens` |
| HTTP baseline | Security headers (helmet), JSON-only bodies up to 100 kB, compressed bodies refused, listening on `127.0.0.1` only (ADR 0008) |
| Customer accounts | Registration, email verification and resend, without revealing which emails are registered (ADR 0007) |
| Customer sign-in | Login, refresh with rotation and reuse detection, logout. 15-minute access tokens (JWT, HS256) and 30-day sessions (ADR 0007) |
| Access control | A global deny-by-default guard. Each request needs a valid access token and a live session, unless its handler is `@Public()`. `GET /v1/me` returns the caller's own account. |
| Email | Sent through SMTP behind a swappable mail service. Mailpit catches all mail in development. TLS is required in production. |
| Logging | Structured JSON logs with a request ID on every request (ADR 0006). No emails, passwords or tokens in logs. |
| Errors | One consistent error format that includes the request ID, plus a `code` field where clients must react to a specific case (ADR 0006, `docs/api-specification.md`) |
| Tests | Unit tests for every module (84 tests in 16 suites), plus an end-to-end smoke test of the sign-in flow against the running API (`pnpm api:smoke`) |

Not built yet: password recovery, staff authentication with MFA, rate limiting, product catalog, inventory, cart, orders, payments, admin console, customer app and website, notifications, support tickets, CI/CD.

## 3. Roles

Three roles: Customer, Admin, Super User (ADR 0004). Customers self-register. Admins are created only by a Super User. Super Users (maximum three) are created by developers with a command-line script, never through the application.

Only Customers can sign in so far. Staff will get a separate login path with MFA and their own token audience.

## 4. Request flows

### 4.1 Health check

1. A request arrives. A request ID is taken from a valid `X-Request-Id` header or generated, and returned in the response header.
2. The guard lets it through, because both health handlers are `@Public()`.
3. The controller calls the health service, which runs `SELECT 1` through Prisma and a `PING` against Valkey, each with a 2-second limit.
4. The response is `200` or `503`. Errors use the common error format. Every log line carries the request ID.

### 4.2 Authenticated request (example: `GET /v1/me`)

1. helmet adds the security headers. Only a JSON body would be parsed.
2. The global `AccessTokenGuard` runs before every handler:
   - `@Public()` on the handler: let it through.
   - Otherwise read `Authorization: Bearer <token>` and verify the JWT: HS256 only, issuer `herbal-api`, audience `customer`, at most 15 minutes old.
   - Look up the session: it must exist, belong to the user, be neither revoked nor expired, and the user must still be an active Customer.
   - Any failure: `401`. Success: the user (`id`, `sessionId`) is attached to the request, and the response gets `Cache-Control: no-store`.
3. The handler reads the user with `@CurrentUser()`, never from the URL or the body.

### 4.3 Sign-in lifecycle

1. **Login** checks the password (argon2id) and creates a session that lasts 30 days. It returns an access token (15 minutes) and a refresh token. Only the refresh token's SHA-256 hash is stored.
2. **Refresh** swaps the refresh token for a new pair. The old token is marked used in the same transaction. If a used token ever comes back, the whole session is revoked.
3. **Logout** revokes the session. Because the guard checks the session on every request, its access tokens stop working at once.

## 5. Conventions

- API: REST with OpenAPI documentation (ADR 0002). Business endpoints live under `/v1`. The documentation tooling will be added later.
- Database: forward-only migrations committed to Git (ADR 0003).
- Secrets: only in the untracked `.env` locally; `.env.example` holds placeholders.
- Module layout: one folder per module under `apps/api/src` (today `auth`, `config`, `health`, `logging`, `mail`, `prisma`, `common`), each with its controller, services and unit tests next to the code.
- New endpoints are protected by default. Mark a handler `@Public()` only on purpose, and never a whole controller.

## 6. Planned direction

See `docs/requirements.md` for scope and open decisions. Next in identity and access: password recovery, rate limiting and brute-force protection (part 3D), then staff login with MFA and role enforcement. Scaling work (caching, queues, search, replicas) is introduced only when measurements justify it.
