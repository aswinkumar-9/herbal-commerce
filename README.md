# Herbal Commerce Platform

E-commerce platform for herbal products: customer app and website, an admin console, and one backend API.

Status: early development. Only the backend foundation exists so far (health checks, configuration, database setup). See `docs/` for requirements, architecture and decisions.

## Prerequisites

- Git
- Node.js 24 (LTS) and pnpm 11
- Docker Desktop, running (provides PostgreSQL and Valkey locally)
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
2. Start PostgreSQL and Valkey:
   ```powershell
   docker compose up -d
   docker compose ps
   ```
   Both services should show `(healthy)`.
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

## Commands

| Command | Purpose |
|---------|---------|
| `pnpm api:dev` | Start the API with auto-restart |
| `pnpm api:test` | Run unit tests |
| `pnpm api:lint` | Run the linter |
| `pnpm api:build` | Compile the API |
| `docker compose up -d` / `down` | Start / stop local services (data is kept) |
| `docker compose down -v` | Stop and **delete all local data** (development only) |

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
│   └── api/               NestJS backend (modular monolith)
│       ├── prisma/        schema and migrations
│       └── src/           config, health, logging, prisma, common
├── docs/
│   ├── requirements.md
│   ├── architecture.md
│   └── decisions/         architecture decision records (ADRs)
├── docker-compose.yml     local PostgreSQL and Valkey
├── .env.example           template; the real .env is never committed
└── pnpm-workspace.yaml
```

## Security notes

- `.env` holds secrets and is ignored by Git. Never commit it or paste it into chats or tickets.
- `.env.example` is committed, so it holds placeholders only. Never put a real secret in it. If a secret is ever committed or shared, generate a new one.
- Use synthetic data in development. Never log passwords, tokens or personal data.
- The generated database client (`apps/api/src/generated`) is not committed. Run `prisma generate` after cloning.

## Troubleshooting

- **"failed to connect to the docker API":** Docker Desktop is not running. Open it and wait for "Engine running".
- **`pnpm` blocked in PowerShell:** run `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser` once, then open a new window.
- **`/health/ready` says a service is down while Docker is healthy:** check that the passwords in `DATABASE_URL` and `VALKEY_URL` match the ones in `.env`, then restart the API.
- **"port is already allocated" or `EADDRINUSE`:** another program (or a second copy of the API) is using the port. Change the port in `.env` or stop the other process.
- **Changed a database password after the first start:** run `docker compose down -v` then `docker compose up -d` (this wipes local data).
