# Herbal Commerce Platform

E-commerce platform for herbal products: customer app and website, an admin console, and one backend API.

Status: early development. The backend API has its foundation (configuration, health checks, database, logging) and customer accounts: registration, email verification, login with 30-day sessions, token refresh, logout, password recovery by email and `GET /v1/me`. Every endpoint is protected unless marked public, and rate limited, with brute-force protection on login. Old sessions, expired links and unverified sign-ups are deleted automatically. Super Users are created with a developer command, staff set up MFA with an authenticator app and sign in on their own path with the password and a code together, and staff changes go into an append-only audit log. Staff tokens open only staff routes, and customer tokens only customer routes. Super Users invite Admins by email, each Admin chooses their own password from the link, and some staff routes are for Super Users only. There are no apps or website yet. See `docs/` for requirements, architecture, the API, security and decisions.

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
   Run the same command again for `MFA_ENCRYPTION_KEY`, which encrypts staff MFA secrets. It must be a **different** value: the API refuses to start if the two are the same. Keep it safe: if it is lost, every staff member has to set up MFA again.
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
- the rate limits: a per-IP limit that a faked `X-Forwarded-For` cannot get around, the block after 5 wrong passwords, and at most 5 emails per hour to one address;
- that a customer's password and tokens never open the staff routes, and cannot invite an Admin;
- that a made-up invitation link is refused.

The staff login and a real invitation need a phone, so they are tried by hand: see "Sign in as staff" and "Invite an Admin".

Every line should say `PASS`, followed by `All checks passed.`

Emails sent in development never leave your machine. Read them in Mailpit at http://localhost:8025.

## Commands

| Command | Purpose |
|---------|---------|
| `pnpm api:dev` | Start the API with auto-restart |
| `pnpm api:test` | Run unit tests |
| `pnpm api:lint` | Run the linter |
| `pnpm api:typecheck` | Type-check all API code, tests included (the tests themselves run without a type check) |
| `pnpm api:build` | Compile the API |
| `pnpm api:smoke` | End-to-end check of sign-up, sign-in, password recovery and the rate limits (needs the API and Mailpit running) |
| `pnpm api:limits:clear` | Delete all rate-limit counters in the local Valkey (development only; refuses unless `NODE_ENV=development`) |
| `pnpm api:create-super-user` | Create a Super User (developers only, at most 3). See "Create a Super User" below. |
| `pnpm api:setup-staff-mfa` | Set up, or replace, a staff member's authenticator app. See "Set up staff MFA" below. |
| `pnpm audit` | List known vulnerabilities in dependencies |
| `docker compose up -d` / `down` | Start / stop local services (data is kept) |
| `docker compose down -v` | Stop and **delete all local data** (development only) |

Before opening a pull request, run `pnpm api:typecheck`, `pnpm api:test`, `pnpm api:lint`, `pnpm api:build`, `pnpm audit` and `pnpm api:smoke`.

Database commands (run from `apps/api`):

| Command | Purpose |
|---------|---------|
| `pnpm exec prisma generate` | Rebuild the client after the schema changes |
| `pnpm exec prisma migrate dev --name <name>` | Create and apply a new migration (development) |
| `pnpm exec prisma migrate dev --create-only --name <name>` | Create a migration without applying it, so you can add SQL by hand (for example triggers), then apply it with `pnpm exec prisma migrate dev` |
| `pnpm exec prisma migrate deploy` | Apply existing migrations without creating new ones |
| `pnpm exec prisma migrate status` | Show migration state |

After every change to `schema.prisma`, run both `migrate dev` (changes the database) and `generate` (updates the TypeScript client).

## Create a Super User

Super Users can only be created this way, by a developer, never through the API (ADR 0004, ADR 0012). There can be at most 3. Each one is written to the audit log.

Stop `pnpm api:dev` first, because the command rebuilds the API. Then, in the repository root:

```powershell
$env:SUPER_USER_EMAIL = 'dev.super1@example.com'
$env:SUPER_USER_NAME = 'Dev Super One'
$env:SUPER_USER_PASSWORD = [System.Net.NetworkCredential]::new('', (Read-Host 'Super User password' -AsSecureString)).Password
pnpm api:create-super-user
Remove-Item Env:SUPER_USER_EMAIL, Env:SUPER_USER_NAME, Env:SUPER_USER_PASSWORD
```

- The password needs at least 16 characters. `Read-Host -AsSecureString` keeps it hidden, so it never appears on the screen or in the PowerShell history.
- The email must not already have an account: customers are never turned into staff.
- In development, use made-up `example.com` addresses.

## Set up staff MFA

Every staff member needs an authenticator app (Google Authenticator, Microsoft Authenticator or similar) before they can sign in. Only a developer can set it up (ADR 0013).

Stop `pnpm api:dev` first, then in the repository root:

```powershell
$env:STAFF_EMAIL = 'dev.super1@example.com'
pnpm api:setup-staff-mfa
```

1. The command shows a **key** in 8 groups of 4.
2. In the app, add an account with **"Enter a setup key"**, type the key and choose **Time based**.
3. Type the 6-digit code the app shows into the waiting command. Only a valid code saves the key. Saving also ends that person's sessions and is written to the audit log.
4. Then run `Clear-Host` and `Remove-Item Env:STAFF_EMAIL`.

- Running it again gives a new key, and the old one stops working. That's how a lost phone is handled for now. **Only the newest key works:** delete every older entry for that account from the app, or its codes will be refused.
- **Each staff account has its own entry.** Keep the entries of other accounts: a deleted entry cannot be brought back, only replaced by running the setup again for that account.
- The key only contains the letters `A`–`Z` and the digits `2`–`7`. A round character is the letter **O**, and a straight one the letter **I**.
- Never paste the key into chats or tickets.

## Sign in as staff

There is no admin console yet, so the staff login is tried by hand (ADR 0014). With the API running, in PowerShell:

```powershell
$secure = Read-Host 'Staff password' -AsSecureString
$code = Read-Host 'The code your authenticator app shows now'
$body = @{ email = 'dev.super1@example.com'; password = [System.Net.NetworkCredential]::new('', $secure).Password; code = $code } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri http://localhost:3000/v1/staff/auth/login -ContentType 'application/json' -Body $body
Invoke-RestMethod -Uri http://localhost:3000/v1/staff/me -Headers @{ Authorization = "Bearer $($login.accessToken)" }
Remove-Variable secure, code, body, login
```

- Type the code last, just after the app shows a new one. Each code works once, for about a minute.
- `Read-Host` shows the question in quotes; type your answer after it. Never put the code or the password in the command itself.
- A `401 Invalid email, password or code` never says which part was wrong. The API log does: see Troubleshooting.
- Staff sessions last 12 hours, and staff tokens work only on `/v1/staff/...` routes.

## Invite an Admin

Only a Super User can invite an Admin (ADR 0015). The Admin then chooses their own password with the link from the email, and a developer sets up their MFA. There is no admin console yet, so the link is not clicked: the token is read from Mailpit instead.

1. **Sign in as a Super User**, as in "Sign in as staff". Replace its last line with `Remove-Variable secure, code, body`: `$login` is needed in the next step.
2. **Send the invitation, then sign the Super User out:**
   ```powershell
   $invite = @{ email = 'dev.admin1@example.com'; fullName = 'Dev Admin One' } | ConvertTo-Json
   Invoke-RestMethod -Method Post -Uri http://localhost:3000/v1/staff/admins -ContentType 'application/json' -Body $invite -Headers @{ Authorization = "Bearer $($login.accessToken)" }
   Invoke-RestMethod -Method Post -Uri http://localhost:3000/v1/staff/auth/logout -ContentType 'application/json' -Body (@{ refreshToken = $login.refreshToken } | ConvertTo-Json)
   Remove-Variable invite, login
   ```
   The answer shows `role` `ADMIN`, `invitationExpiresAt` (72 hours from now) and `invitationSent` `True`. It never shows the token.
3. **Read the token from the email** in Mailpit, without printing it:
   ```powershell
   $query = [uri]::EscapeDataString('to:dev.admin1@example.com subject:"You are invited"')
   $found = Invoke-RestMethod "http://localhost:8025/api/v1/search?query=$query"
   $message = Invoke-RestMethod "http://localhost:8025/api/v1/message/$($found.messages[0].ID)"
   $inviteToken = [regex]::Match($message.Text, 'token=([A-Za-z0-9_-]+)').Groups[1].Value
   $inviteToken.Length
   ```
   It should say `43`.
4. **Choose the Admin's password** (at least 16 characters, different from every other account's). Save it where you keep your dev passwords first. You type it twice, because nothing on screen shows a typo:
   ```powershell
   $first = Read-Host 'New password for the Admin (16+ characters)' -AsSecureString
   $second = Read-Host 'The same password again' -AsSecureString
   $password = [System.Net.NetworkCredential]::new('', $first).Password
   if ($password -ceq [System.Net.NetworkCredential]::new('', $second).Password) {
     $accept = @{ token = $inviteToken; password = $password } | ConvertTo-Json
     Invoke-RestMethod -Method Post -Uri http://localhost:3000/v1/staff/auth/accept-invite -ContentType 'application/json' -Body $accept
   } else { 'The two passwords differ. Nothing was sent: run these lines again.' }
   Remove-Variable first, second, password, accept, inviteToken, query, found, message -ErrorAction SilentlyContinue
   ```
   The answer says the password has been set. `-ceq` compares case-sensitively; PowerShell's `-eq` ignores case.
5. **Set up the Admin's MFA** as in "Set up staff MFA", with `$env:STAFF_EMAIL = 'dev.admin1@example.com'`. Add it as a **new** entry in the app, next to the Super User's.
6. **Sign in as the Admin**, as in "Sign in as staff", with the Admin's email, password and app entry.

- The link works for 72 hours, once. Sending an invitation again comes in part 3B-5.
- An Admin who calls a Super-User-only route, such as `POST /v1/staff/admins`, gets `403 Only a Super User may do this.`
- Each step is in the audit log: `admin.invited` (by the Super User), `admin.invite_accepted` (by the Admin) and `staff.mfa_set_up`.

## Repository structure

```
.
├── apps/
│   └── api/                    NestJS backend (modular monolith)
│       ├── prisma/             schema and migrations
│       ├── scripts/            auth-smoke.cjs (smoke test), clear-rate-limits.cjs
│       └── src/
│           ├── audit/          the append-only audit log and a request's audit context
│           ├── auth/           registration, login, tokens and sessions (customer and staff audiences), password reset, access and roles guards, /v1/me
│           ├── cli/            developer commands (create a Super User, set up staff MFA), without HTTP
│           ├── staff/          staff accounts: Super Users, MFA, staff sign-in, Admin invitations and /v1/staff/me
│           ├── rate-limit/     limits, rate-limit guard, client IP
│           ├── retention/      hourly cleanup of data past its retention period
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
- Never put Super User credentials in `.env` or type the password on the command line. Use `Read-Host` as shown above, and remove the variables afterwards.
- Treat an MFA setup key like a password: it is shown once, typed into the app, and then cleared from the screen. Back up `MFA_ENCRYPTION_KEY` with the other production secrets.
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
- **TypeScript says a Prisma model or field does not exist, although the migration ran:** the client is out of date. Run `pnpm exec prisma generate` in `apps/api`.
- **The API refuses to start: `MFA_ENCRYPTION_KEY: ...`:** add your own value to `.env` (see First-time setup, step 1). It must differ from `JWT_ACCESS_SECRET`.
- **The authenticator app says "illegal character":** a `0`, `1`, `8` or `9` was typed. The key only has `A`–`Z` and `2`–`7`, so type the letters O, I or B instead.
- **The setup command refuses every code:** the key in the app differs from the one shown (often `0` for O), or the entry is not **Time based**, or the phone's clock is off. Set the phone's time automatically, delete the app entry and run the command again.
- **`429 Too Many Requests` while testing by hand:** you used up a rate limit (the `Retry-After` header says for how long). Wait, or run `pnpm api:limits:clear`.
- **The staff login answers `401`:** find `Staff sign-in failed` in the API log. Its `reason` says why, without the email, password or code:
  - `wrong_code` (the password was right): usually the app shows codes from an **older** key. After a second setup, only the newest key works. Delete the old entries from the app, or run `pnpm api:setup-staff-mfa` again if you're unsure which one is right. Also check that the code comes from the entry with **this** account's email.
  - `wrong_password`: not the password chosen when the account was created (for an Admin: when the invitation was accepted). Each staff account has its own password: check that it isn't another account's.
  - `mfa_not_set_up`: run `pnpm api:setup-staff-mfa` first.

  After 5 failures in an hour, the login answers `429` for 15 minutes, even with the right password. So find the reason before trying again.
- **A staff member's entry was deleted from the authenticator app:** it cannot be brought back. Run `pnpm api:setup-staff-mfa` again for that account and add the new entry.
- **Inviting an Admin answers `409`:** the email already has an account, maybe a customer's. Customers are never turned into staff, so use another address.
- **Inviting an Admin answers `403 Only a Super User may do this.`:** you are signed in as an Admin. Sign in as a Super User.
- **`accept-invite` answers `400 Invalid or expired invitation link`:** find `Admin invitation refused` in the API log. Its `reason` says why:
  - `unknown_token`: the token was copied incompletely;
  - `already_used`: the password was already set with this link;
  - `expired`: the 72 hours have passed;
  - `not_allowed`: the account is not an active Admin;
  - `lost_race`: the same link was sent twice at the same moment, and the other request set the password.

  Sending an invitation again comes in part 3B-5. Until then, in development only, delete the pending Admin and invite again. Its invitation and sessions go with it; its audit entries stay. (`herbal_app` and `herbal_dev` are the `POSTGRES_USER` and `POSTGRES_DB` from `.env.example`; use yours if you changed them.)
  ```powershell
  docker exec herbal-postgres psql -U herbal_app -d herbal_dev -c "DELETE FROM users WHERE email = 'dev.admin1@example.com' AND role = 'ADMIN';"
  ```
