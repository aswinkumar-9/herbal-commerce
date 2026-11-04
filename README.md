# Herbal Commerce Platform

E-commerce platform for herbal products: customer app and website, an admin console, and one backend API.

Status: early development. The backend API has its foundation (configuration, health checks, database, logging) and customer accounts: registration, email verification, login with 30-day sessions, token refresh, logout, password recovery by email, and the customer's own account: reading it, changing the name and the password, signing out everywhere, and up to 10 delivery addresses. Every endpoint is protected unless marked public, and rate limited, with brute-force protection on login. Old sessions, expired links and unverified sign-ups are deleted automatically. Super Users are created with a developer command, staff set up MFA with an authenticator app and sign in on their own path with the password and a code together, and staff changes go into an append-only audit log. Staff tokens open only staff routes, and customer tokens only customer routes. Super Users invite Admins by email, each Admin chooses their own password from the link, and some staff routes are for Super Users only. Super Users also list, disable, enable and remove Admins, and send an invitation again. Every staff sign-in is recorded, and Super Users read the audit log page by page. The product catalog has categories and products: Admins and Super Users create, change, activate and deactivate them, and only Super Users delete them. A product goes live only with its licence and maker details and its ingredients. Anyone can browse the shop without signing in: the active categories, each category's live products, and each product's page. There are no apps or website yet. See `docs/` for requirements, architecture, the API, security and decisions.

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
- the customer's own account: changing the name (and nothing else), changing the password (a wrong current one is refused, and both of two signed-in "devices" are signed out), the second "password changed" email, and signing out everywhere;
- delivery addresses: two added at the same moment (both saved, exactly one default), the phone and PIN code cleaned, moving and removing the default, and a second customer who sees none of the first one's addresses and gets `404` on them;
- product categories: the public list shows only the name, slug and description of each active category, the same with or without a customer's token;
- the shop:
  - unknown pages answer `404`, and a category page refuses more than 50 products at once;
  - every live category page shows only the name, slug and summary of its products;
  - every product page shows its licence and maker details, and no IDs or staff fields;
- that a customer's password and tokens never open the staff routes, cannot invite or manage Admins, cannot read the audit log, and cannot list, create, change or delete categories or products;
- that a made-up invitation link is refused.

The staff login, a real invitation and managing categories and products need a phone, so they are tried by hand: see "Sign in as staff", "Invite an Admin", "Manage categories" and "Manage products". With an empty shop, the two page checks have nothing to look at. They are most useful while a product is live.

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
- Each successful sign-in is recorded in the audit log as `staff.signed_in`. Failed ones are only in the API log.

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

- The link works for 72 hours, once. To send a new one, see "Manage Admins".
- An Admin who calls a Super-User-only route, such as `POST /v1/staff/admins`, gets `403 Only a Super User may do this.`
- Each step is in the audit log: `admin.invited` (by the Super User), `admin.invite_accepted` (by the Admin) and `staff.mfa_set_up`.

## Manage Admins

Only a Super User can list, disable, enable and remove Admins, or send an invitation again (ADR 0016).

1. **Sign in as a Super User**, as in "Sign in as staff". Replace its last line with `Remove-Variable secure, code, body`: `$login` is needed here.
2. **List the Admins and pick one:**
   ```powershell
   $auth = @{ Authorization = "Bearer $($login.accessToken)" }
   $admins = (Invoke-RestMethod -Uri http://localhost:3000/v1/staff/admins -Headers $auth).admins
   $admins | Format-Table email, status, invitationAcceptedAt, invitationExpiresAt, mfaEnabledAt
   $id = ($admins | Where-Object email -eq 'dev.admin1@example.com').id
   "[$id]"
   ```
   The last line shows the Admin's ID in brackets. **If the brackets are empty, stop:** the email doesn't match, and the next commands would call the wrong URL.
3. **Run only the line you need:**
   ```powershell
   # Disable: ends every session of the Admin. Use "ACTIVE" to enable again.
   Invoke-RestMethod -Method Patch -Uri "http://localhost:3000/v1/staff/admins/$id" -Headers $auth -ContentType 'application/json' -Body '{"status":"DISABLED"}'
   # Send a pending Admin a new invitation: every older link stops working.
   Invoke-RestMethod -Method Post -Uri "http://localhost:3000/v1/staff/admins/$id/invitation" -Headers $auth
   # Remove a disabled or pending Admin.
   Invoke-RestMethod -Method Delete -Uri "http://localhost:3000/v1/staff/admins/$id" -Headers $auth
   ```
4. **Sign out and clean up:**
   ```powershell
   Invoke-RestMethod -Method Post -Uri http://localhost:3000/v1/staff/auth/logout -ContentType 'application/json' -Body (@{ refreshToken = $login.refreshToken } | ConvertTo-Json)
   Remove-Variable login, auth, admins, id
   ```

- An active Admin must be disabled before they can be removed. A pending one, who never accepted the invitation, can be removed straight away.
- Enabling a disabled Admin does not bring their old sessions back: they sign in again, with a new code.
- After a new invitation, only the newest link works. An older one fails like a made-up link (`unknown_token` in the log).
- The Super User's access token lasts 15 minutes. After that, sign in again (step 1).
- Every change is in the audit log: `admin.disabled`, `admin.enabled`, `admin.invitation_resent` and `admin.removed` (with who was removed).

## Read the audit log

Only a Super User can read the audit log (ADR 0017). It holds every staff change and every successful staff sign-in, newest first.

1. **Sign in as a Super User**, as in "Sign in as staff". Replace its last line with `Remove-Variable secure, code, body`: `$login` is needed here.
2. **Read the newest page:**
   ```powershell
   $auth = @{ Authorization = "Bearer $($login.accessToken)" }
   $page = Invoke-RestMethod -Uri 'http://localhost:3000/v1/staff/audit-log?limit=20' -Headers $auth
   $page.entries | Format-Table createdAt, action, @{ n = 'actor'; e = { $_.actor.email } }, @{ n = 'target'; e = { $_.target.email } }, ip
   ```
3. **The next, older page** continues just after the last entry. Run it again for each further page, until `nextBefore` is empty:
   ```powershell
   $page = Invoke-RestMethod -Uri "http://localhost:3000/v1/staff/audit-log?limit=20&before=$($page.nextBefore)" -Headers $auth
   $page.entries | Format-Table createdAt, action, @{ n = 'actor'; e = { $_.actor.email } }, @{ n = 'target'; e = { $_.target.email } }, ip
   ```
4. **Filter,** and combine filters as you like:
   - `?action=admin.removed`: one kind of entry;
   - `?actorId=<an account's ID>`: what that person did;
   - `?targetId=<an Admin's ID>`: that Admin's whole story, from invitation to removal;
   - `?targetId=<a category's ID>` or `?targetId=<a product's ID>`: that category's or product's story, from creation to deletion.

   The IDs come from the entries themselves, or from the lists in "Manage Admins", "Manage categories" and "Manage products".
5. **Sign out and clean up:**
   ```powershell
   Invoke-RestMethod -Method Post -Uri http://localhost:3000/v1/staff/auth/logout -ContentType 'application/json' -Body (@{ refreshToken = $login.refreshToken } | ConvertTo-Json)
   Remove-Variable login, auth, page
   ```

- An empty `actor` means a developer command, such as the MFA setup, or an account that no longer exists. An empty `target` means the target is not an account (a session, for example), or no longer exists. The IDs stay in `actorId` and `targetId` either way.
- A removed Admin's `admin.removed` entry keeps who they were, in `before`.
- Use `nextBefore` to page, never your own counting: new entries keep arriving at the top.

## Manage categories

Admins and Super Users create, change, activate and deactivate product categories. Only a Super User deletes one (ADR 0020). Customers see the active ones at `GET /v1/categories`, without signing in.

1. **Sign in as staff** (an Admin or a Super User), as in "Sign in as staff". Replace its last line with `Remove-Variable secure, code, body`: `$login` is needed here. Check that `$login.accessToken` is not empty before going on.
2. **List every category,** hidden ones too:
   ```powershell
   $auth = @{ Authorization = "Bearer $($login.accessToken)" }
   $categories = (Invoke-RestMethod -Uri http://localhost:3000/v1/staff/categories -Headers $auth).categories
   $categories | Format-Table name, slug, isActive, position, id
   ```
3. **Create one, or pick one from the list.** A new category's slug is made from its name (`Hair Care` becomes `hair-care`), and it starts hidden from customers.
   ```powershell
   # Either create one:
   $id = (Invoke-RestMethod -Method Post -Uri http://localhost:3000/v1/staff/categories -Headers $auth -ContentType 'application/json; charset=utf-8' -Body '{"name":"Hair Care","description":"Oils and powders for the hair"}').id
   # Or pick one by its slug:
   $id = ($categories | Where-Object slug -eq 'hair-care').id
   "[$id]"
   ```
   The last line shows the category's ID in brackets. **If the brackets are empty, stop:** the next commands would call the wrong URL.
4. **Run only the line you need:**
   ```powershell
   # Show it to customers. Use false to hide it again.
   Invoke-RestMethod -Method Patch -Uri "http://localhost:3000/v1/staff/categories/$id" -Headers $auth -ContentType 'application/json; charset=utf-8' -Body '{"isActive":true}'
   # Rename it. The slug stays, so links keep working.
   Invoke-RestMethod -Method Patch -Uri "http://localhost:3000/v1/staff/categories/$id" -Headers $auth -ContentType 'application/json; charset=utf-8' -Body '{"name":"Hair and Scalp"}'
   # Change its place in the list (lower first) and its slug.
   Invoke-RestMethod -Method Patch -Uri "http://localhost:3000/v1/staff/categories/$id" -Headers $auth -ContentType 'application/json; charset=utf-8' -Body '{"position":1,"slug":"hair-scalp"}'
   # Delete it for good: Super Users only. An Admin hides it instead.
   Invoke-RestMethod -Method Delete -Uri "http://localhost:3000/v1/staff/categories/$id" -Headers $auth
   ```
5. **What customers see,** without a token:
   ```powershell
   (Invoke-RestMethod http://localhost:3000/v1/categories).categories | Format-Table name, slug, description
   ```
6. **Sign out and clean up:**
   ```powershell
   Invoke-RestMethod -Method Post -Uri http://localhost:3000/v1/staff/auth/logout -ContentType 'application/json' -Body (@{ refreshToken = $login.refreshToken } | ConvertTo-Json)
   Remove-Variable login, auth, categories, id
   ```

- **Keep `charset=utf-8` in the content type.** Without it, Windows PowerShell 5.1 sends letters outside English wrongly: `é` arrives broken, and Devanagari as `??`.
- A name without Latin letters or digits, in Devanagari for example, needs its own slug: add `"slug":"ayurveda"` to the body.
- A change that sets the values a category already has changes nothing, and writes no audit entry.
- Every change is in the audit log: `category.created`, `category.updated` (with only what changed) and `category.deleted` (with what was deleted). See "Read the audit log", with `?targetId=$id`. Its `target` column stays empty for categories, because it names accounts only.
- The staff access token lasts 15 minutes. After that, sign in again (step 1).

## Manage products

Admins and Super Users create, change, activate and deactivate products. Only a Super User deletes one (ADR 0021). A product starts as a draft. It goes live only with its type, licence number, maker's name and address and its ingredients, and customers see it only while its category is active too.

1. **Sign in as staff**, as in "Sign in as staff". Replace its last line with `Remove-Variable secure, code, body`, and check that `$login.accessToken` is not empty. Then:
   ```powershell
   $auth = @{ Authorization = "Bearer $($login.accessToken)" }
   $api = 'http://localhost:3000/v1'
   $json = 'application/json; charset=utf-8'
   ```
2. **List the products,** one page at a time, drafts too:
   ```powershell
   $page = Invoke-RestMethod -Uri "$api/staff/products?limit=20" -Headers $auth
   $page.products | Format-Table name, slug, isActive, type, id
   "[$($page.nextAfter)]"
   ```
   - For the next page, add `&after=<the nextAfter value>`.
   - Add `&categoryId=<a category's ID>` for one category, or `&isActive=false` for the drafts only.
3. **Create a draft, or pick one by its slug.** The draft needs only a category (its ID, from "Manage categories") and a name:
   ```powershell
   # Either create one:
   $body = @{ categoryId = '<a category ID>'; name = 'Ashwagandha Capsules'; summary = 'For calm and strength' } | ConvertTo-Json
   $id = (Invoke-RestMethod -Method Post -Uri "$api/staff/products" -Headers $auth -ContentType $json -Body $body).id
   # Or pick one by its slug:
   $id = ($page.products | Where-Object slug -eq 'ashwagandha-capsules').id
   "[$id]"
   ```
   **If the brackets are empty, stop:** the next commands would call the wrong URL.
4. **Complete it and go live, in one request:**
   ```powershell
   $details = @{
     type = 'AYURVEDIC_MEDICINE'   # or FOOD_OR_SUPPLEMENT (FSSAI, 14 digits), or COSMETIC
     licenceNumber = '25D/123/2015'
     manufacturerName = 'Herbal Works Pvt Ltd'
     manufacturerAddress = '12, Industrial Area, Mysuru 570016'
     ingredients = 'Each capsule contains: Ashwagandha root extract 500 mg'
     usage = '1 capsule twice a day after meals'
     isActive = $true
   } | ConvertTo-Json
   Invoke-RestMethod -Method Patch -Uri "$api/staff/products/$id" -Headers $auth -ContentType $json -Body $details | Format-List name, isActive, licenceNumber
   ```
5. **Run only the line you need:**
   ```powershell
   # Take it out of the shop. Use true to show it again.
   Invoke-RestMethod -Method Patch -Uri "$api/staff/products/$id" -Headers $auth -ContentType $json -Body '{"isActive":false}'
   # Move it to another category.
   Invoke-RestMethod -Method Patch -Uri "$api/staff/products/$id" -Headers $auth -ContentType $json -Body '{"categoryId":"<another category ID>"}'
   # Delete it for good: Super Users only. An Admin takes it out of the shop instead.
   Invoke-RestMethod -Method Delete -Uri "$api/staff/products/$id" -Headers $auth
   ```
6. **What customers see,** without a token:
   ```powershell
   (Invoke-RestMethod "$api/categories/<a category slug>/products").products | Format-Table name, slug, summary
   Invoke-RestMethod "$api/products/ashwagandha-capsules" | Format-List
   ```
7. **Sign out and clean up:**
   ```powershell
   Invoke-RestMethod -Method Post -Uri "$api/staff/auth/logout" -ContentType 'application/json' -Body (@{ refreshToken = $login.refreshToken } | ConvertTo-Json)
   Remove-Variable login, auth, api, json, page, body, details, id -ErrorAction SilentlyContinue
   ```

- **A refused request prints a red error.** For a `400`, its body names each refused field. To see the body as JSON, wrap the request: `try { <the request> } catch { $_.ErrorDetails.Message }`. If that prints nothing, read the response itself: `(New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd()`.
- **Licence numbers are stored in one form:** spaces dropped, letters made capitals. An FSSAI licence (`FOOD_OR_SUPPLEMENT`) is exactly 14 digits.
- **Removing a detail from a live product is refused.** Take the product out of the shop first.
- Every change is in the audit log: `product.created`, `product.updated` (with only what changed) and `product.deleted`. Read a product's story with `?targetId=$id` (see "Read the audit log").
- A category that still has products cannot be deleted (`409`).

## Repository structure

```
.
├── apps/
│   └── api/                    NestJS backend (modular monolith)
│       ├── prisma/             schema and migrations
│       ├── scripts/            auth-smoke.cjs (smoke test), clear-rate-limits.cjs
│       └── src/
│           ├── addresses/      customers' delivery addresses
│           ├── audit/          the append-only audit log, a request's audit context, and reading the log page by page
│           ├── auth/           registration, login, tokens and sessions (customer and staff audiences), password reset and change, access and roles guards, /v1/me
│           ├── catalog/        categories and products: their rules (slug, going live), the staff routes and the public shop
│           ├── cli/            developer commands (create a Super User, set up staff MFA), without HTTP
│           ├── staff/          staff accounts: Super Users, MFA, staff sign-in, inviting and managing Admins, /v1/staff/me
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
- **An Admin route answers `403 Only a Super User may do this.`:** you are signed in as an Admin. Sign in as a Super User.
- **`accept-invite` answers `400 Invalid or expired invitation link`:** find `Admin invitation refused` in the API log. Its `reason` says why:
  - `unknown_token`: the token was copied incompletely;
  - `already_used`: the password was already set with this link;
  - `expired`: the 72 hours have passed;
  - `not_allowed`: the account is not an active Admin;
  - `lost_race`: the same link was sent twice at the same moment, and the other request set the password.

  A Super User can send the Admin a new link, or remove a pending Admin (see "Manage Admins").
- **Removing an Admin answers `409 Disable this Admin before removing them.`:** the Admin is active and has accepted the invitation. Disable them first, then remove them.
- **Inviting an Admin again answers `409`:** either `This Admin has already accepted the invitation.` (there is nothing to invite them to), or `Enable this Admin before inviting them again.`
- **An Admin route answers `404`:** read the body.
  - `Admin not found`: the API looked, and there is no Admin with this ID. A Super User's ID gets the same answer.
  - `Cannot DELETE /v1/staff/admins/` (or `PATCH`, or `POST`): the URL had no ID, so no route matched. Usually the PowerShell variable was empty. Print it in brackets first, for example `"[$id]"`.
- **An Admin route answers `400 Validation failed (uuid is expected)`:** the ID in the URL is not a UUID.
- **The audit log answers `400 Validation failed`:** the `errors` list names the parameter. `limit` must be 1 to 100, `before` must be a `nextBefore` value from an earlier page, `actorId` must be a UUID, and `action` looks like `admin.removed`.
- **A sign-in is missing from the audit log:** only successful staff sign-ins are recorded. A failed one is in the API log, as `Staff sign-in failed` with its reason.
- **A pasted password is refused:** count the `*` that `Read-Host` showed, one per character. A much longer count than the password means something extra was pasted with it.
- **Changing the password answers `400 The current password is wrong.`:** it counts as a failed login. The 6th wrong password in an hour answers `429`, and then both the change and the login refuse for 15 minutes.
- **After changing the password or signing out everywhere, every request answers `401`:** that is intended. Every session ended, this one too: sign in again.
- **Adding an address answers `409`:** the customer already has 10. Remove one first.
- **An address answers `404 Address not found`:** it was removed, or it belongs to another customer. Addresses are only ever reachable by their owner.
- **A new address answers `400` for the state:** it must be spelled exactly as in the list (`Karnataka`, not `karnataka` or `Bangalore`).
- **A staff route answers `401 Missing access token` right after signing in:** `$login` is empty. Either the sign-in failed (its red error says why, see "The staff login answers `401`" above), or the commands ran in another PowerShell window. Sign in again, and check that `$login.accessToken` is not empty before going on.
- **Creating or changing a category answers `409`:** another category already has that slug. Send a different `slug`. Without one, it is made from the name, so a second "Hair Care" needs its own slug.
- **Creating a category answers `400` for `slug`:** either the name has no Latin letters or digits (send a `slug` too), or the slug sent has capitals, spaces, underscores or double hyphens. A slug looks like `hair-care`.
- **A category's name arrives garbled (`Caf�`, or `??` for Devanagari):** the request was sent with `application/json` without `charset=utf-8`. Change the name again with the content type from "Manage categories".
- **Deleting a category answers `403 Only a Super User may do this.`:** you are signed in as an Admin. Hide it instead (`{"isActive":false}`), or ask a Super User.
- **A category answers `404 Category not found`:** it was deleted, or the ID is wrong. List the categories and pick the ID again.
- **Deleting a category answers `409 This category still has products.`:** move its products to another category (`{"categoryId":"..."}`) or delete them first. To hide it from the shop, deactivate it instead: that hides its products too.
- **Activating a product answers `400` with "Needed before the product can go live":** the `errors` list names each missing detail (type, licence number, maker's name and address, ingredients). Send them in the same request as `"isActive":true`, or first.
- **A product answers `400` "An FSSAI licence number has exactly 14 digits":** the type is `FOOD_OR_SUPPLEMENT`, and the licence isn't 14 digits. Fix the number, or choose the right type.
- **Creating or moving a product answers `400` for `categoryId` "No category with this ID":** the category was deleted, or the ID is wrong.
- **Creating or changing a product answers `409`:** another product already has that slug. Send a different `slug`.
- **A live product's page answers `404`:** its category is hidden. A product shows in the shop only while both it and its category are active.
- **`prisma migrate dev` asks "Enter a name for the new migration" right after applying one:** the schema and the database still differ, usually because something was lost from the migration you edited. Press `Ctrl+C`, then see what a new migration would contain: `pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` (in `apps/api`; it only reads). Put a missing piece into a **new** migration. Never edit one that has been applied: Prisma would then want to reset the database.
