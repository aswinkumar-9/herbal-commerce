# Herbal Commerce Platform

E-commerce platform for herbal products: customer app and website, an admin console, and one backend API.

Status: early development. The backend API has its foundation (configuration, health checks, database, logging) and customer accounts: registration, email verification, login with 30-day sessions, token refresh, logout, password recovery by email and `GET /v1/me`. Every endpoint is protected unless marked public, and rate limited, with brute-force protection on login. There are no apps or website yet. See `docs/` for requirements, architecture, the API, security and decisions.

## Prerequisites

- Git
- Node.js 24 (LTS) and pnpm 12
- Docker Desktop, running (provides PostgreSQL, Valkey and the Mailpit mail catcher locally)
- Windows 11 with PowerShell is the tested setup (see `docs/decisions/0005-local-development-environment.md`)

## First-time setup

Run everything from the repository root unless stated otherwise.

1. Copy the environment template and set your own local values:
   ```powershell
   Copy-Item .env.example .env
   ```
   Use passwords made of letters and digits only. Special characters such as `@` or `:` break the connection URLs. The password in `DATABASE_URL` must match `POSTGRES_PASSWORD`, and the one in `VALKEY_URL` must match `VALKEY_PASSWORD`.

   Generate a random secret for signing access tokens and put it in `JWT_ACCESS_SECRET` (the API refuses to start with the placeholder):
   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```
2. Start PostgreSQL, Valkey and Mailpit:
   ```powershell
   docker compose up -d
   docker compose ps
   ```
   PostgreSQL and Valkey should show `(healthy)`. Mailpit has no health check and shows `Up`.
3. Install dependencies:
   ```powershell
   pnpm install
   ```
   If pnpm stops with `ERR_PNPM_IGNORED_BUILDS`, add the named package to `allowBuilds` in `pnpm-workspace.yaml` (only after checking that you recognise it), then run `pnpm install` again.

   pnpm only installs package versions that are at least 3 days old (`minimumReleaseAge` in `pnpm-workspace.yaml`). If it refuses a version as too new, wait a few days rather than making an exception.

4. Generate the database client and apply migrations (run from `apps/api`):
   ```powershell
   cd apps\api
   pnpm exec prisma generate
   pnpm exec prisma migrate deploy
   cd ..\..
   ```
5. Start the API:
   ```powershell
   pnpm api:dev
   ```

## Verify it works

With the API running, in a second terminal opened in the repository root:

```powershell
curl.exe -i http://localhost:3000/health
curl.exe -i http://localhost:3000/health/ready
```

`/health` returns `{"status":"ok"}`. `/health/ready` returns `200` with `"database":"up","valkey":"up"`, or `503` if either service is down.

Then run the end-to-end smoke test of customer sign-up and sign-in:

```powershell
pnpm api:smoke
```

It first clears the local rate-limit counters, so it can run again at once. Then it registers a throwaway customer (`smoke.<number>@example.com`) and reads the verification email from Mailpit. It checks:
- login, `GET /v1/me`, token refresh, refresh-token reuse detection and logout;
- password recovery: the reset link arrives only for a real account, the reset ends every session, the new password works at once and the old one doesn't, the link works only once, and the "password changed" email arrives;
- the rate limits: a per-IP limit that a faked `X-Forwarded-For` cannot get around, the block after 5 wrong passwords, and at most 5 emails per hour to one address.

Every line should say `PASS`, followed by `All checks passed.`

Emails sent in development never leave your machine. Read them in Mailpit at http://localhost:8025.

## Commands

| Command | Purpose |
|---------|---------|
| `pnpm api:dev` | Start the API with auto-restart |
| `pnpm api:test` | Run unit tests |
| `pnpm api:lint` | Run the linter |
| `pnpm api:build` | Compile the API |
| `pnpm api:smoke` | End-to-end check of sign-up, sign-in, password recovery and the rate limits (needs the API and Mailpit running) |
| `pnpm api:limits:clear` | Delete all rate-limit counters in the local Valkey (development only; refuses unless `NODE_ENV=development`) |
| `pnpm audit` | List known vulnerabilities in dependencies |
| `docker compose up -d` / `down` | Start / stop local services (data is kept) |
| `docker compose down -v` | Stop and **delete all local data** (development only) |

Before opening a pull request, run `pnpm api:test`, `pnpm api:lint`, `pnpm api:build`, `pnpm audit` and `pnpm api:smoke`.

Database commands (run from `apps/api`):

| Command | Purpose |
|---------|---------|
| `pnpm exec prisma generate` | Rebuild the client after the schema changes |
| `pnpm exec prisma migrate dev --name <name>` | Create and apply a new migration (development) |
| `pnpm exec prisma migrate deploy` | Apply existing migrations without creating new ones |
| `pnpm exec prisma migrate status` | Show migration state |

## Repository structure

```
.
├── apps/
│   └── api/                    NestJS backend (modular monolith)
│       ├── prisma/             schema and migrations
│       ├── scripts/            auth-smoke.cjs (smoke test), clear-rate-limits.cjs
│       └── src/
│           ├── auth/           registration, login, tokens, sessions, password reset, guard, /v1/me
│           ├── rate-limit/     limits, rate-limit guard, client IP
│           ├── valkey/         the shared Valkey connection
│           ├── mail/           email sending (SMTP; Mailpit in development)
│           ├── config/         environment validation
│           └── health/, logging/, prisma/, common/
├── docs/
│   ├── requirements.md
│   ├── architecture.md
│   ├── api-specification.md    endpoints, error format, token rules
│   ├── security.md             security controls and their status
│   └── decisions/              architecture decision records (ADRs)
├── docker-compose.yml          local PostgreSQL, Valkey and Mailpit
├── .env.example                template; the real .env is never committed
├── package.json                root commands (api:dev, api:test, api:smoke, api:limits:clear, ...)
└── pnpm-workspace.yaml         workspace, build approvals, 3-day minimum release age
```

## Security notes

- `.env` holds secrets and is ignored by Git. Never commit it or paste it into chats or tickets.
- `.env.example` is committed, so it holds placeholders only. Never put a real secret in it. If a secret is ever committed or shared, generate a new one.
- Access and refresh tokens are secrets too. Never paste them into chats, tickets or logs.
- Use synthetic data in development. Never log passwords, tokens or personal data.
- The generated database client (`apps/api/src/generated`) is not committed. Run `prisma generate` after cloning.
- The API listens on `127.0.0.1` only until it is deployed behind HTTPS (the remaining steps are listed in `docs/security.md`). To test on an Android phone, connect it over USB and run `adb reverse tcp:3000 tcp:3000`.
- Leave `TRUST_PROXY` empty unless the API runs behind a proxy you control. Then list that proxy's address. Never use a hop count: it would let anyone fake their IP and dodge the rate limits.
- The status of every security control is in `docs/security.md`.

## Troubleshooting

- **"failed to connect to the docker API":** Docker Desktop is not running. Open it and wait for "Engine running".
- **`pnpm` blocked in PowerShell:** run `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser` once, then open a new window.
- **`/health/ready` says a service is down while Docker is healthy:** check that the passwords in `DATABASE_URL` and `VALKEY_URL` match the ones in `.env`, then restart the API.
- **"port is already allocated" or `EADDRINUSE`:** another program (or a second copy of the API) is using the port. Change the port in `.env` or stop the other process.
- **Changed a database password after the first start:** run `docker compose down -v` then `docker compose up -d` (this wipes local data).
- **The API refuses to start with `Invalid environment configuration`:** the message names each setting that is wrong (never its value). For `JWT_ACCESS_SECRET`, generate a new secret with the command in step 1.
- **`pnpm api:smoke` says "Smoke test stopped":** start the API (`pnpm api:dev`) and Mailpit (`docker compose up -d`), then run it again.
- **`429 Too Many Requests` while testing by hand:** you used up a rate limit (the `Retry-After` header says for how long). Wait, or run `pnpm api:limits:clear`.
