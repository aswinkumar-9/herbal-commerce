# Architecture

Status: **Draft v0.8.** This document describes what exists today and the direction we intend to follow. Items marked "planned" are not built yet.

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
                           │            ├────────────────►  Valkey 8        (rate-limit counters, readiness check)
                           │            │
                           │            └────────────────►  SMTP            (Mailpit in development)
```

Built so far:

| Area | State |
|------|-------|
| Configuration | Environment variables validated at startup. The app refuses to start on invalid config and never prints secret values. In production it also refuses placeholder secrets and a non-HTTPS website URL (ADR 0008). Two strong secrets: `JWT_ACCESS_SECRET` and `MFA_ENCRYPTION_KEY`, which must differ. |
| Health | `GET /health` (liveness) and `GET /health/ready` (PostgreSQL and Valkey reachable, 503 otherwise) |
| Database | Prisma 7 with the PostgreSQL driver adapter. Tables: `users` (roles `CUSTOMER`, `ADMIN`, `SUPER_USER`), `email_verification_tokens`, `password_reset_tokens`, `staff_invitations`, `sessions`, `refresh_tokens` and `audit_log` |
| HTTP baseline | Security headers (helmet), JSON-only bodies up to 100 kB, compressed bodies refused, listening on `127.0.0.1` only (ADR 0008) |
| Valkey | One shared connection (`ValkeyService`) that fails fast while Valkey is down and logs only changes of state |
| Rate limiting | A global guard limits every route per client IP, and each sign-up and sign-in endpoint further. Login has three failure counters with temporary blocks, shared by the customer and the staff login (`LoginAttemptsService`), and register and resend are limited per email address. Counters live in Valkey, falling back to memory, with hashed keys. Only proxies in `TRUST_PROXY` may report the client IP (ADR 0009). |
| Password hashing | At most 2 argon2 operations at once and 50 waiting; beyond that `503 SERVER_BUSY` (ADR 0009) |
| Customer accounts | Registration, email verification and resend, without revealing which emails are registered (ADR 0007) |
| Password recovery | Forgot-password sends a 30-minute, single-use link (in the background, so every address answers equally fast). Reset-password sets the new password, marks the email verified, ends every session and lifts the login blocks (ADR 0010). |
| Customer sign-in | Login, refresh with rotation and reuse detection, logout. 15-minute access tokens (JWT, HS256, audience `customer`) and 30-day sessions (ADR 0007) |
| Data retention | An hourly job inside the API (`RetentionScheduler`) deletes ended sessions after 30 days, used refresh tokens after 7 days, expired verification, reset and Admin invitation links, and customer sign-ups still unverified after 7 days. It logs counts only (ADR 0011). |
| Audit log | The append-only `audit_log` table: database triggers refuse `UPDATE`, `DELETE` and `TRUNCATE`. `AuditService.record(tx, entry)` writes in the same transaction as the change and redacts secret-looking fields (ADR 0012). Entries made through the API carry the checked actor, the client IP and the request ID, from `@CurrentAuditContext()` (ADR 0015). |
| Super Users | Created only with `pnpm api:create-super-user`, a standalone Nest context without HTTP. At most 3, enforced by the app and a database trigger. Each creation is audited (ADR 0012). |
| Staff MFA | TOTP from authenticator apps (our own implementation, proven against the RFC test vectors), with no code accepted twice. Secrets are encrypted with `SecretBox` (AES-256-GCM, bound to the user). Set up only with `pnpm api:setup-staff-mfa`, which saves after a valid code, ends the person's sessions and is audited (ADR 0013). |
| Staff sign-in | `POST /v1/staff/auth/login` takes the password and a code together and gives one `401` for every failure. Staff tokens carry the audience `staff`, and staff sessions last 12 hours. Refresh and logout at `/v1/staff/auth/*`, and `GET /v1/staff/me` for the own account (ADR 0014). |
| Admin invitations | A Super User invites an Admin with `POST /v1/staff/admins`. That creates the account with a password nobody knows and emails a 72-hour, single-use link. The Admin chooses their own password at `POST /v1/staff/auth/accept-invite`, and a developer then sets up their MFA. Both steps are audited (ADR 0015). |
| Access control | A global deny-by-default guard. Each request needs a valid access token and a live session, unless its handler is `@Public()`. Each protected route has one audience: routes marked `@StaffOnly()` take staff tokens, every other route customer tokens. The caller's current role comes from the database with the session. A global roles guard then refuses Admins on routes marked `@SuperUserOnly()` (`403`, ADR 0015). `GET /v1/me` and `GET /v1/staff/me` return the caller's own account. |
| Email | Sent through SMTP behind a swappable mail service. Mailpit catches all mail in development. TLS is required in production. |
| Logging | Structured JSON logs with a request ID on every request (ADR 0006). No emails, passwords, codes or tokens in logs. |
| Errors | One consistent error format that includes the request ID, plus a `code` field where clients must react to a specific case, and `Retry-After` on `429` and `503` (ADR 0006, `docs/api-specification.md`) |
| Tests | Unit tests for every module (243 tests in 39 suites), a type check of all code including the tests (`pnpm api:typecheck`), and an end-to-end smoke test against the running API (`pnpm api:smoke`, 36 checks, including the rate limits, password recovery, that customers cannot use the staff routes or invite Admins, and that a made-up invitation link fails). The staff login and the invitation of an Admin are tested by hand with a phone (README). |

Not built yet: changing the password while signed in, managing Admins (list, disable, remove, invite again), product catalog, inventory, cart, orders, payments, admin console, customer app and website, notifications, support tickets, CI/CD.

## 3. Roles

Three roles: Customer, Admin, Super User (ADR 0004). Customers self-register. Admins are invited only by a Super User and choose their own password (ADR 0015). Super Users (maximum three) are created by developers with `pnpm api:create-super-user`, never through the application (ADR 0012).

Customers sign in at `/v1/auth/login`. Staff (Admins and Super Users) sign in at `/v1/staff/auth/login`, with the password and a code from their authenticator app together, once a developer has set up their MFA (`pnpm api:setup-staff-mfa`, ADR 0013). Staff tokens have their own audience and open only staff routes (ADR 0014). Staff routes come in two levels: `@StaffOnly()` for both staff roles, and `@SuperUserOnly()` for Super Users only, such as inviting Admins (ADR 0015).

## 4. Request flows

### 4.1 Health check

1. A request arrives. A request ID is taken from a valid `X-Request-Id` header or generated, and returned in the response header.
2. The rate-limit guard counts it against the per-IP baseline. The access-token guard lets it through, because both health handlers are `@Public()`.
3. The controller calls the health service, which runs `SELECT 1` through Prisma and a `PING` against Valkey, each with a 2-second limit.
4. The response is `200` or `503`. Errors use the common error format. Every log line carries the request ID.

### 4.2 Authenticated request (example: `GET /v1/me`)

1. helmet adds the security headers. Only a JSON body would be parsed.
2. The global guards run in the order they are listed in `AppModule`:
   1. **`RateLimitGuard`** counts the request for the client IP (`req.ip`, see `TRUST_PROXY`): first the baseline, then the route's own `@RateLimit()` limits. Once a limit is used up: `429` with `Retry-After`, before any token or database work.
   2. **`AccessTokenGuard`:**
      - `@Public()` on the handler: let it through.
      - Otherwise, take the route's audience: `staff` if the handler or its controller is marked `@StaffOnly()`, `customer` otherwise.
      - Read `Authorization: Bearer <token>` and verify the JWT: HS256 only, issuer `herbal-api`, the route's audience, at most 15 minutes old. A token for the other audience fails here.
      - Look up the session: it must exist, belong to the user, and be neither revoked nor expired. On a customer route the user must still be an active Customer; on a staff route, an active Admin or Super User with MFA set up.
      - The same query returns the user's current role.
      - Any failure: `401`. Success: the user (`id`, `sessionId`, `role`) is attached to the request, and the response gets `Cache-Control: no-store`.
   3. **`RolesGuard`:** on a route marked `@SuperUserOnly()`, anyone but a Super User gets `403 Only a Super User may do this.` It fails closed: without a checked user, such a route is refused too.
3. The handler reads the user with `@CurrentUser()`, never from the URL or the body. A handler that changes staff data also takes `@CurrentAuditContext()` (actor, IP, request ID) for its audit entry.

### 4.3 Sign-in lifecycle

1. **Login** first checks the three failed-login counters (email + IP, email, IP) and answers `429` if any is blocked. Then it checks the password (argon2id, at most 2 at once). A failure counts against all three counters; a success clears the email + IP one and creates a session that lasts 30 days. Login returns an access token (15 minutes) and a refresh token. Only the refresh token's SHA-256 hash is stored.
2. **Refresh** swaps the refresh token for a new pair. The old token is marked used in the same transaction. If a used token ever comes back, the whole session is revoked.
3. **Logout** revokes the session. Because the guard checks the session on every request, its access tokens stop working at once.
4. **Password reset** revokes **every** session of the account in the same transaction that sets the new password, so all devices are signed out at once. The customer then logs in again with the new password.
5. **Staff sign-in** works the same way, with these differences (ADR 0014):
   - the request also carries the code from the authenticator app, which is checked only after the right password and is used up;
   - every failure, a disabled account included, gets the same `401`;
   - the session lasts 12 hours;
   - refresh and logout use `/v1/staff/auth/*`, and a refresh token from the other sign-in path is refused without touching its session.

### 4.4 Becoming an Admin (ADR 0015)

1. **Invite.** A Super User sends `POST /v1/staff/admins` with the email and name. One transaction creates the Admin (with a random password nobody knows), the invitation (only the token's hash, 72 hours) and the `admin.invited` audit entry. The email with the link goes out after the commit. If it fails, the answer says `invitationSent: false`.
2. **Accept.** The Admin opens the link, and the admin console (later) posts the token with the chosen password to `POST /v1/staff/auth/accept-invite`. The invitation is claimed atomically. The same transaction sets the password, marks the email verified, ends any sessions and writes `admin.invite_accepted`. Every refused link gets the same `400`.
3. **MFA.** A developer runs `pnpm api:setup-staff-mfa` for the Admin (ADR 0013).
4. **Sign in** as staff (section 4.3). An Admin can use `@StaffOnly()` routes, and gets `403` on `@SuperUserOnly()` ones.

## 5. Conventions

- API: REST with OpenAPI documentation (ADR 0002). Business endpoints live under `/v1`. The documentation tooling will be added later.
- Database: forward-only migrations committed to Git (ADR 0003).
- Secrets: only in the untracked `.env` locally; `.env.example` holds placeholders.
- Module layout: one folder per module under `apps/api/src` (today `audit`, `auth`, `cli`, `config`, `health`, `logging`, `mail`, `prisma`, `rate-limit`, `retention`, `staff`, `valkey`, `common`), each with its controller, services and unit tests next to the code. `cli` holds developer commands, which run in their own Nest context without HTTP.
- New endpoints are protected by default. Mark a handler `@Public()` only on purpose, and never a whole controller.
- Staff endpoints go in `src/staff`, in controllers marked `@StaffOnly()` or `@SuperUserOnly()` as a whole, so a route added later cannot be missed. Every other protected endpoint is for customers.
- A change to staff data writes its audit entry in the same transaction, with the actor, IP and request ID from `@CurrentAuditContext()`.
- New endpoints get the per-IP baseline automatically. Add `@RateLimit()` to endpoints that are expensive or attractive to abuse, and add each new limit to `rate-limits.ts`.

## 6. Planned direction

See `docs/requirements.md` for scope and open decisions. Next in identity and access: managing Admins (list, disable and enable, remove, invite again) and a Super Users' view of the audit log, with every change audit-logged (part 3B-5). Scaling work (caching, queues, search, replicas) is introduced only when measurements justify it.
