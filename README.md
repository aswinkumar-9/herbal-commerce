# Herbal Commerce Platform

E-commerce platform for herbal products: customer app and website, an admin console, and one backend API.

Status: early development. The backend API has its foundation (configuration, health checks, database, logging) and customer accounts: registration, email verification, login with 30-day sessions, token refresh, logout, password recovery by email, and the customer's own account: reading it, changing the name and the password, signing out everywhere, and up to 10 delivery addresses. Every endpoint is protected unless marked public, and rate limited, with brute-force protection on login. Old sessions, expired links, unverified sign-ups and carts nobody changed for 90 days are deleted automatically. Super Users are created with a developer command, staff set up MFA with an authenticator app and sign in on their own path with the password and a code together, and staff changes go into an append-only audit log. Staff tokens open only staff routes, and customer tokens only customer routes. Super Users invite Admins by email, each Admin chooses their own password from the link, and some staff routes are for Super Users only. Super Users also list, disable, enable and remove Admins, and send an invitation again. Every staff sign-in is recorded, and Super Users read the audit log page by page. The product catalog has categories, products and their pack sizes with prices: Admins and Super Users create, change, activate and deactivate them, and only Super Users delete them. A product goes live only with its licence and maker details, its ingredients, its HSN code and GST rate, and at least one image. Each pack has an MRP and a price in whole rupees, never above the MRP, and every price change is audited. Staff upload up to 6 photos per product, which the API checks and re-encodes to WebP in two sizes, without the photo's hidden details; Admins may delete images too. Stock is kept per batch, with the batch number and dates from the label, in one warehouse: staff receive deliveries and write stock off, every change is kept as a movement, and a batch sells only with at least 6 months left. Anyone can browse the shop without signing in: the active categories, each category's live products with their lowest price and main photo, and each product's page with its packs on sale, whether each is in stock, and its images. Signed-in customers keep a cart: at most 4 packs of one product, all its pack sizes together, always with today's prices and whether each line can be bought. They place an order from the whole cart, to one of their addresses: every amount in whole rupees, with the GST inside the prices shown, ₹49 delivery below ₹499, and the stock held for 15 minutes while they pay. A double tap places one order, and an unpaid order expires on its own and gives its stock back. They pay through Razorpay, in its test mode for now: the server confirms every payment with Razorpay itself, Razorpay's signed webhooks cover an app closed too soon, a payment that comes after its order expired is kept while the stock is free, and a payment that can't be kept goes back in full on its own. The admin console has begun (part 12A): staff sign in with the password and the authenticator code, stay signed in through a cookie the page cannot read, see the menu for their role, and are signed out after 30 minutes without activity. Its pages come next. There is no customer app or website yet. See `docs/` for requirements, architecture, the API, security and decisions.

## Prerequisites

- Git
- Node.js 24 (LTS) and pnpm 12
- Docker Desktop, running (provides PostgreSQL, Valkey and the Mailpit mail catcher locally)
- A Razorpay account, for its free test keys: no business details are needed for test mode (ADR 0027)
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

   **The API needs Razorpay's test keys to start** (ADR 0027). In the Razorpay dashboard, in Test Mode, open Account & Settings > API Keys and generate a key:
   - the Key Id, `rzp_test_…`, goes into `RAZORPAY_KEY_ID`;
   - the Key Secret, shown only once, goes into `RAZORPAY_KEY_SECRET`;
   - run the command above a third time for `RAZORPAY_WEBHOOK_SECRET`. It must differ from the other two secrets. It is our own: Razorpay gets it only when its webhook is set up, once the API is deployed.

   **Real values go only into `.env`, never into `.env.example`.** If the Key Secret is ever shown or shared, a screenshot included, generate a new key in the dashboard.
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
  - every live category page shows only the name, slug, summary, lowest price and image of its products;
  - every product page shows its licence and maker details, and no IDs or staff fields;
  - every pack on a product page shows only its SKU, size, prices and whether it is in stock, never a price above its MRP, and each card's lowest price matches its product page;
  - every product page shows at least one image, each with only its addresses, size and description, and each card's image is the small file of its product's main photo;
  - every image file, large and small, is served as WebP for any site to show, and the image folders are never listed;
- search: a 1-letter word, relevance without words, a lowest price above the highest, and more than 50 at once are refused; searching without words lists every live product once, those in stock first, each card agreeing with its category card and product page; and a live product is found by the start of a word in its name, by that word with a typo, and by its category, type and price;
- the cart: it needs a customer token and starts empty, refuses an unknown pack size and more than 4 packs, puts a pack in stock into one customer's cart only (with today's price and no IDs), and answers `204` when a pack is removed or the cart emptied;
- orders: the checkout needs a customer token, an empty cart can be neither checked out nor ordered, and an order needs an `Idempotency-Key` and a valid body. With a pack in stock, an order is placed at the checkout's total, holds its stock for 15 minutes and empties the cart; the same key answers the same order, which a second customer can't see; cancelling gives the stock back, the customer is emailed at once that the order is cancelled, and cancelling again answers `409 This order can no longer be cancelled.`; and the order shows its customer that it isn't packed, shipped or delivered yet. Orders are never deleted, so each such run leaves one cancelled order behind;
- paying: with a pack in stock, starting to pay for that order answers in rupees only, with a Razorpay test key and the same Razorpay order every time; only its owner can pay for it; a wrong or missing confirmation is refused; the order shows its payment without Razorpay's IDs; and once cancelled it can no longer be paid. This calls Razorpay's test mode, so the smoke test needs the internet, and each run leaves a test order in the Razorpay dashboard;
- Razorpay's webhooks: one without a signature, with a wrong one, or re-spaced after signing is refused, and one signed with `RAZORPAY_WEBHOOK_SECRET` from `.env` is taken;
- that a customer's password and tokens never open the staff routes, cannot invite or manage Admins, cannot read the audit log, cannot list, create, change or delete categories, products, pack sizes or images, cannot see or change stock, and cannot see orders or refunds as staff, or pack, ship, deliver or cancel an order there. Without a token, those order and refund routes answer `401` too;
- that a made-up invitation link is refused;
- the admin console's session cookie: from the console's address, staff renewal and sign-out use only the cookie and ignore a token in the body, both tell the browser to forget a missing cookie, and a failed staff sign-in sets none.

The staff login, a real invitation, managing categories, products, pack sizes, images and stock, and handling orders need a phone, so they are tried by hand: see "Sign in as staff", "Invite an Admin", "Manage categories", "Manage products", "Manage pack sizes and prices", "Manage product images", "Manage stock" and "Handle orders". With an empty shop, the page, price, image and stock checks, and the cart's and orders' checks with a pack in stock, have nothing to look at. They are most useful while a product with packs, images and stock is live. A customer's cart and orders can be tried by hand too: see "Use the cart" and "Place an order". Paying needs a person on Razorpay's payment page: see "Pay for an order".

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
| `pnpm api:pay-test` | Pay for a real order in Razorpay's test mode, in a browser; `--cancel` to see a refund (development and test keys only). See "Pay for an order" below. |
| `pnpm api:limits:clear` | Delete all rate-limit counters in the local Valkey (development only; refuses unless `NODE_ENV=development`) |
| `pnpm api:create-super-user` | Create a Super User (developers only, at most 3). See "Create a Super User" below. |
| `pnpm api:setup-staff-mfa` | Set up, or replace, a staff member's authenticator app. See "Set up staff MFA" below. |
| `pnpm admin:dev` | Start the admin console at http://localhost:5173, with live reload (needs the API running) |
| `pnpm admin:test` | Run the admin console's tests |
| `pnpm admin:lint` | Run the linter on the admin console |
| `pnpm admin:typecheck` | Type-check the admin console |
| `pnpm admin:build` | Build the admin console into `apps/admin/dist`, then check the build (its security policy, nothing inline, no source maps) |
| `pnpm admin:preview` | Serve the built console at http://localhost:5173, with its security policy and headers (stop `admin:dev` first) |
| `pnpm audit` | List known vulnerabilities in dependencies |
| `docker compose up -d` / `down` | Start / stop local services (data is kept) |
| `docker compose down -v` | Stop and **delete all local data** (development only) |

Before opening a pull request, run `pnpm api:typecheck`, `pnpm api:test`, `pnpm api:lint`, `pnpm api:build`, `pnpm audit` and `pnpm api:smoke`, and for the admin console `pnpm admin:typecheck`, `pnpm admin:test`, `pnpm admin:lint` and `pnpm admin:build`.

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

The admin console is the everyday way (see "Open the admin console" below). The staff login can also be tried by hand (ADR 0014). With the API running, in PowerShell:

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

## Open the admin console

The admin console is a web app for staff (ADR 0031). Its pages come in the next parts; today staff sign in and see the menu for their role.

1. Start the API (`pnpm api:dev`), then, in a second terminal:
   ```powershell
   pnpm admin:dev
   ```
2. Open http://localhost:5173 and sign in with your staff email, password and the code your authenticator app shows now.

- **Use exactly http://localhost:5173.** The API gives the session cookie only to `ADMIN_ORIGIN` (in `.env`, by default `http://localhost:5173`), so the console on any other address says it can't reach the server.
- **Reloading keeps you signed in,** for up to 12 hours: the refresh token is in a cookie the page cannot read, and the access token only in the page's memory.
- **After 30 minutes without activity,** in any tab of the console, you are signed out. A panel warns you a minute before.
- **Signing out in one tab signs out the others.**
- **Admins don't see Admins or the audit log.** The areas marked "Soon" arrive in the next parts.
- **The dev server runs without the page's security policy,** because live reload needs inline scripts. To see the console as it will be served, with its policy and headers, stop `admin:dev` and run `pnpm admin:build` then `pnpm admin:preview`. The browser's console (F12) should show no `Refused to …` messages.

## Invite an Admin

Only a Super User can invite an Admin (ADR 0015). The Admin then chooses their own password with the link from the email, and a developer sets up their MFA. The admin console has no page for the link yet (ADR 0031), so the link is not clicked: the token is read from Mailpit instead.

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
   - `?targetId=<a category's ID>`, `?targetId=<a product's ID>`, `?targetId=<a pack's ID>`, `?targetId=<an image's ID>` or `?targetId=<a batch's ID>`: that category's, product's, pack's, image's or batch's story, from creation to deletion. A pack's story is its price history, and a batch's its stock history. `?targetId=<an order's ID>` shows the steps staff took with that order.

   The IDs come from the entries themselves, or from the lists in "Manage Admins", "Manage categories", "Manage products", "Manage pack sizes and prices", "Manage product images" and "Manage stock".
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

Admins and Super Users create, change, activate and deactivate products. Only a Super User deletes one (ADR 0021). A product always starts as a draft. It goes live only with its type, licence number, maker's name and address, its ingredients, its HSN code and GST rate (ADR 0022), and at least one image (ADR 0023). Customers see it only while its category is active too. Its prices are on its pack sizes, and its photos are its images: see "Manage pack sizes and prices" and "Manage product images".

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
4. **Complete its details:**
   ```powershell
   $details = @{
     type = 'AYURVEDIC_MEDICINE'   # or FOOD_OR_SUPPLEMENT (FSSAI, 14 digits), or COSMETIC
     licenceNumber = '25D/123/2015'
     manufacturerName = 'Herbal Works Pvt Ltd'
     manufacturerAddress = '12, Industrial Area, Mysuru 570016'
     ingredients = 'Each capsule contains: Ashwagandha root extract 500 mg'
     usage = '1 capsule twice a day after meals'
     hsnCode = '3004 90'           # stored as 300490
     gstRate = 5                   # 0, 5, 18 or 40: ask your chartered accountant
   } | ConvertTo-Json
   ```
   Paste that block on its own, and press Enter until the prompt is back. Then send it:
   ```powershell
   Invoke-RestMethod -Method Patch -Uri "$api/staff/products/$id" -Headers $auth -ContentType $json -Body $details | Format-List name, isActive, licenceNumber, hsnCode, gstRate
   ```
5. **Add at least one image,** as in "Manage product images", then **go live:**
   ```powershell
   Invoke-RestMethod -Method Patch -Uri "$api/staff/products/$id" -Headers $auth -ContentType $json -Body '{"isActive":true}' | Format-List name, isActive
   ```
   Without an image, this answers `400` with `images` "Needed before the product can go live".
6. **Run only the line you need:**
   ```powershell
   # Take it out of the shop. Use true to show it again.
   Invoke-RestMethod -Method Patch -Uri "$api/staff/products/$id" -Headers $auth -ContentType $json -Body '{"isActive":false}'
   # Move it to another category.
   Invoke-RestMethod -Method Patch -Uri "$api/staff/products/$id" -Headers $auth -ContentType $json -Body '{"categoryId":"<another category ID>"}'
   # Delete it for good: Super Users only. An Admin takes it out of the shop instead.
   Invoke-RestMethod -Method Delete -Uri "$api/staff/products/$id" -Headers $auth
   ```
7. **What customers see,** without a token:
   ```powershell
   (Invoke-RestMethod "$api/categories/<a category slug>/products").products | Format-Table name, slug, summary, fromPriceRupees, imageUrl
   Invoke-RestMethod "$api/products/ashwagandha-capsules" | Format-List
   ```
8. **Sign out and clean up:**
   ```powershell
   Invoke-RestMethod -Method Post -Uri "$api/staff/auth/logout" -ContentType 'application/json' -Body (@{ refreshToken = $login.refreshToken } | ConvertTo-Json)
   Remove-Variable login, auth, api, json, page, body, details, id -ErrorAction SilentlyContinue
   ```

- **A refused request prints a red error.** For a `400`, its body names each refused field. To see the body as JSON, wrap the request: `try { <the request> } catch { $_.ErrorDetails.Message }`. If that prints nothing, read the response itself: `(New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd()`.
- **Licence numbers are stored in one form:** spaces dropped, letters made capitals. An FSSAI licence (`FOOD_OR_SUPPLEMENT`) is exactly 14 digits.
- **Removing a detail from a live product is refused.** Take the product out of the shop first.
- **A new product cannot be created live:** it has no image yet. Create it, add an image, then go live (steps 3 to 5).
- Every change is in the audit log: `product.created`, `product.updated` (with only what changed) and `product.deleted`. Read a product's story with `?targetId=$id` (see "Read the audit log").
- A category that still has products cannot be deleted (`409`).
- Deleting a product deletes its pack sizes and its images too, image files included. Its `product.deleted` entry keeps the packs and images. **A product with a pack that still holds stock cannot be deleted** (`409`): write the stock off first (see "Manage stock").

## Manage pack sizes and prices

Each product has its packs, such as 60 capsules or 100 g, each with an MRP and a price (ADR 0022). Prices are **whole rupees**: send `499` for ₹499. The price is never above the MRP. Admins and Super Users add packs, change them and take them off sale. Only a Super User deletes one. Customers see the packs on sale of a live product.

1. **Sign in as staff and set the variables,** as in "Manage products", step 1.
2. **Pick the product** by its slug, from the list in "Manage products", step 2:
   ```powershell
   $page = Invoke-RestMethod -Uri "$api/staff/products?limit=100" -Headers $auth
   $productId = ($page.products | Where-Object slug -eq 'ashwagandha-capsules').id
   "[$productId]"
   ```
   **If the brackets are empty, stop.**
3. **List its packs,** off sale ones too:
   ```powershell
   (Invoke-RestMethod -Uri "$api/staff/products/$productId/variants" -Headers $auth).variants | Format-Table sku, quantity, unit, mrpRupees, priceRupees, isActive, id
   ```
4. **Add a pack:**
   ```powershell
   $body = @{ sku = 'ASH-CAP-60'; quantity = 60; unit = 'CAPSULES'; mrpRupees = 500; priceRupees = 449 } | ConvertTo-Json
   $variantId = (Invoke-RestMethod -Method Post -Uri "$api/staff/products/$productId/variants" -Headers $auth -ContentType $json -Body $body).id
   "[$variantId]"
   ```
   - `unit` is one of `G`, `KG`, `ML`, `L`, `CAPSULES`, `TABLETS` and `PIECES`.
   - The SKU is your own code for the pack, unique across all products. It is stored in capitals.
   - To work on a pack that already exists, take its ID from the list in step 3: `$variantId = '<its id>'`.
5. **Run only the line you need:**
   ```powershell
   # A new price.
   Invoke-RestMethod -Method Patch -Uri "$api/staff/variants/$variantId" -Headers $auth -ContentType $json -Body '{"priceRupees":399}'
   # A new MRP and price together, for example when a new printed MRP arrives.
   Invoke-RestMethod -Method Patch -Uri "$api/staff/variants/$variantId" -Headers $auth -ContentType $json -Body '{"mrpRupees":550,"priceRupees":499}'
   # Take it off sale. Use true to put it back.
   Invoke-RestMethod -Method Patch -Uri "$api/staff/variants/$variantId" -Headers $auth -ContentType $json -Body '{"isActive":false}'
   # Delete it for good: Super Users only. An Admin takes it off sale instead.
   Invoke-RestMethod -Method Delete -Uri "$api/staff/variants/$variantId" -Headers $auth
   ```
6. **What customers see,** without a token:
   ```powershell
   (Invoke-RestMethod "$api/products/ashwagandha-capsules").variants | Format-Table sku, quantity, unit, mrpRupees, priceRupees
   ```
7. **Sign out and clean up:**
   ```powershell
   Invoke-RestMethod -Method Post -Uri "$api/staff/auth/logout" -ContentType 'application/json' -Body (@{ refreshToken = $login.refreshToken } | ConvertTo-Json)
   Remove-Variable login, auth, api, json, page, productId, body, variantId -ErrorAction SilentlyContinue
   ```

- **The price is checked against the pack as it will be.** Lowering only the MRP below the current price is refused: send both together.
- A pack off sale disappears from the shop at once, and from the product's lowest price on its category page.
- A pack on sale shows "in stock" only while it has stock that may be sold (see "Manage stock"). **A pack that still holds stock cannot be deleted** (`409`): write the stock off first.
- Every change is in the audit log: `variant.created`, `variant.updated` (with only what changed, so a price change shows the old and new price) and `variant.deleted`. Read a pack's price history with `?targetId=$variantId` (see "Read the audit log").

## Manage product images

Each product has up to 6 photos, and a live product at least 1 (ADR 0023). Admins and Super Users upload, describe, move and delete them; unlike other deletions, **Admins delete images too**. An upload is a JPEG, PNG or WebP of at most 10 MB and at least 400 × 400 pixels. The API keeps only a new copy of its pixels: two WebP files, at most 1600 and 400 pixels on their longest side, upright, without the photo's hidden details such as its GPS location.

On a laptop the files live in `apps/api/storage/media`, which Git ignores, and the API serves them at http://127.0.0.1:3000/media.

1. **Sign in as staff, set the variables and pick the product,** as in "Manage pack sizes and prices", steps 1 and 2. Here the product's ID is `$id`:
   ```powershell
   $id = $productId
   "[$id]"
   ```
   **If the brackets are empty, stop.**
2. **Point to a photo on your computer:**
   ```powershell
   $photo = '<full path to the photo>.jpg'
   Test-Path $photo
   ```
   Expected: `True`. For a PNG or WebP photo, use `image/png` or `image/webp` in the next step instead of `image/jpeg`.
3. **Upload it:** the request body is the file itself.
   ```powershell
   $image = Invoke-RestMethod -Method Post -Uri "$api/staff/products/$id/images" -Headers $auth -ContentType 'image/jpeg' -InFile $photo
   $image | Format-List id, width, height, altText, position, url, thumbnailUrl
   Start-Process $image.url
   ```
   The browser shows the large file. The first image (the lowest position, then the oldest) is the main photo, shown on the category page.
4. **List the product's images:**
   ```powershell
   (Invoke-RestMethod -Uri "$api/staff/products/$id/images" -Headers $auth).images | Format-Table position, altText, width, height, id
   ```
   To work on another image, take its ID from this list: `$image = @{ id = '<its id>' }`.
5. **Run only the line you need:**
   ```powershell
   # Describe it, for people who cannot see it. Without a description, the shop uses the product's name.
   Invoke-RestMethod -Method Patch -Uri "$api/staff/images/$($image.id)" -Headers $auth -ContentType $json -Body '{"altText":"The back label, with the ingredients"}'
   # Move it: a lower position comes first.
   Invoke-RestMethod -Method Patch -Uri "$api/staff/images/$($image.id)" -Headers $auth -ContentType $json -Body '{"position":1}'
   # Delete it, with its files. Admins may too. A live product keeps at least one.
   Invoke-RestMethod -Method Delete -Uri "$api/staff/images/$($image.id)" -Headers $auth
   ```
6. **What customers see,** without a token:
   ```powershell
   (Invoke-RestMethod "$api/products/ashwagandha-capsules").images | Format-Table altText, width, height, thumbnailUrl
   ```
7. **Sign out and clean up,** as in "Manage pack sizes and prices", step 7, then:
   ```powershell
   Remove-Variable id, photo, image -ErrorAction SilentlyContinue
   ```

- **To replace a photo,** upload the new one first, then delete the old one. A live product's last image cannot be deleted, and a 7th image is refused.
- **A new photo always gets a new address.** The files are never changed, so browsers may keep them for a year.
- Every change is in the audit log: `image.created`, `image.updated` (with only what changed) and `image.deleted`. Read an image's story with `?targetId=<its id>` (see "Read the audit log").
- The access token lasts 15 minutes. With an expired token, a large upload may end in "The underlying connection was closed" instead of a `401`: the API does not read uploads it would refuse. Sign in again.

## Manage stock

Each pack size's stock is kept in batches, in one warehouse (ADR 0024). A batch is one delivery, with the batch number, manufacturing date and expiry date from its label. **A batch sells only with at least 6 months left** before it expires. Customers see only whether a pack is in stock, never how many. Admins and Super Users receive batches, correct them and change their stock. Every change is a movement that is kept for good, and nothing in stock is ever deleted.

Dates are written like `2028-09-30` (year, month, day), and "today" is India's date.

1. **Sign in as staff, set the variables and pick the product,** as in "Manage pack sizes and prices", steps 1 and 2. Then pick the pack size from its list (step 3 there):
   ```powershell
   $variantId = '<the pack size id>'
   ```
2. **Receive a delivery:** a new batch.
   ```powershell
   $body = @{ batchNumber = 'AB2611'; manufacturedOn = '2026-10-01'; expiresOn = '2028-09-30'; quantity = 120; note = 'First delivery' } | ConvertTo-Json
   $batchId = (Invoke-RestMethod -Method Post -Uri "$api/staff/variants/$variantId/batches" -Headers $auth -ContentType $json -Body $body).id
   "[$batchId]"
   ```
   The batch number is stored without spaces and in capitals. A batch made in the future, or one already expired, is refused.
3. **See the pack size's stock,** the first to expire first:
   ```powershell
   $stock = Invoke-RestMethod -Uri "$api/staff/variants/$variantId/batches" -Headers $auth
   $stock.batches | Format-Table batchNumber, manufacturedOn, expiresOn, quantity, sellable, id
   "$($stock.quantity) on hand, $($stock.sellableQuantity) sellable"
   ```
   To work on another batch, take its ID from this list: `$batchId = '<its id>'`.
4. **Run only the line you need:**
   ```powershell
   # More of the same batch arrived.
   Invoke-RestMethod -Method Post -Uri "$api/staff/batches/$batchId/movements" -Headers $auth -ContentType $json -Body '{"change":24,"reason":"RECEIVED"}'
   # Damaged or lost: a negative number.
   Invoke-RestMethod -Method Post -Uri "$api/staff/batches/$batchId/movements" -Headers $auth -ContentType $json -Body '{"change":-2,"reason":"DAMAGED","note":"Broken seal"}'
   # Written off near or past its expiry.
   Invoke-RestMethod -Method Post -Uri "$api/staff/batches/$batchId/movements" -Headers $auth -ContentType $json -Body '{"change":-10,"reason":"EXPIRED"}'
   # A count found a difference: either way, and always with a note.
   Invoke-RestMethod -Method Post -Uri "$api/staff/batches/$batchId/movements" -Headers $auth -ContentType $json -Body '{"change":-1,"reason":"CORRECTION","note":"Count on 6 Nov"}'
   # Correct the label details, never the stock.
   Invoke-RestMethod -Method Patch -Uri "$api/staff/batches/$batchId" -Headers $auth -ContentType $json -Body '{"expiresOn":"2028-10-31"}'
   ```
5. **A batch's history,** newest first:
   ```powershell
   (Invoke-RestMethod -Uri "$api/staff/batches/$batchId/movements" -Headers $auth).movements | Format-Table createdAt, change, reason, note
   ```
6. **What customers see,** without a token:
   ```powershell
   (Invoke-RestMethod "$api/products/ashwagandha-capsules").variants | Format-Table sku, priceRupees, inStock
   ```
7. **Sign out and clean up,** as in "Manage pack sizes and prices", step 7, then:
   ```powershell
   Remove-Variable batchId, stock -ErrorAction SilentlyContinue
   ```

- **"In stock" needs 6 months of shelf life.** A pack with only short-dated batches shows `inStock` `False` in the shop, even with packs on the shelf. Staff see such a batch as `sellable` `False`, and write it off when it expires.
- **Mistakes are put right by another movement,** never by deleting one: a correction with a note.
- **A pack size or product that still holds stock cannot be deleted.** Write its batches off to 0 first, then delete it.
- Every change is in the audit log: `batch.received`, `batch.updated` (with only what changed) and `stock.changed` (with the quantity before and after). Read a batch's story with `?targetId=$batchId` (see "Read the audit log").

## Search the shop

Anyone may search the shop, signed in or not (ADR 0030). A search looks in each live product's name, summary and description, and forgives part of a word or a typo: "ashwa" and "ashwaganda" both find Ashwagandha. Products in stock come first, and the rest are marked `"inStock": false`.

```powershell
$api = 'http://localhost:3000/v1'
(Invoke-RestMethod "$api/products?q=ashwa").products | Format-Table name, fromPriceRupees, inStock
```

Add filters and an order, with or without words:

| Parameter | Example | Meaning |
|---|---|---|
| `q` | `q=tulsi tea` | The search words, 2 to 100 characters |
| `category` | `category=herbal-teas` | One category, by its slug |
| `type` | `type=COSMETIC` | `AYURVEDIC_MEDICINE`, `FOOD_OR_SUPPLEMENT` or `COSMETIC` |
| `minPriceRupees`, `maxPriceRupees` | `maxPriceRupees=300` | The product's lowest price on sale, in whole rupees |
| `sort` | `sort=price-asc` | `relevance` (with words only, and their default), `price-asc`, `price-desc` or `name` (the default without words) |
| `page`, `limit` | `page=2&limit=50` | Up to 50 a page; the answer's `nextPage` is the next one, or empty |

```powershell
$page = Invoke-RestMethod "$api/products?category=herbal-supplements&sort=price-asc&limit=50"
$page | Format-List total, page, nextPage
$page.products | Format-Table name, fromPriceRupees, inStock
Remove-Variable api, page
```

- **Only live products in active categories are found,** as on the category pages. A hidden or unknown category finds nothing.
- **The ingredients are not searched,** by the owner's choice: a word only on the label's ingredients finds nothing.
- **A search has its own limit:** 120 per minute per IP (`429` after that).
- **The API's log hides the search words:** the request shows `q=[REDACTED]`, because a search may tell of someone's health.

## Use the cart

A signed-in customer keeps a cart on the server (ADR 0025). It holds pack sizes and how many packs of each: **at most 4 packs of one product, all its pack sizes together,** and at most 50 pack sizes. It keeps no prices: it always shows today's. It holds no stock either: stock is held when an order is placed (see "Place an order"). Only customers have carts: a staff token gets `401`. There are no apps yet, so the cart is tried by hand, with a throwaway customer.

A pack size is named by its SKU, exactly as the shop shows it, such as `ASH-CAP-60`. The shop needs a live product with a pack in stock (see "Manage stock").

1. **Set the variables, and sign up a throwaway customer.** The password is random and never shown:
   ```powershell
   $api = 'http://localhost:3000/v1'
   $json = 'application/json; charset=utf-8'
   $customerEmail = "cart.$(Get-Date -Format 'MMddHHmmss')@example.com"
   $customerPassword = [guid]::NewGuid().ToString()
   Invoke-RestMethod -Method Post -Uri "$api/auth/register" -ContentType $json -Body (@{ email = $customerEmail; password = $customerPassword; fullName = 'Cart Tester' } | ConvertTo-Json)
   ```
2. **Verify the email with the link's token from Mailpit,** without printing it:
   ```powershell
   $query = [uri]::EscapeDataString('to:' + $customerEmail + ' subject:"Verify your email address"')
   $found = Invoke-RestMethod "http://localhost:8025/api/v1/search?query=$query"
   $message = Invoke-RestMethod "http://localhost:8025/api/v1/message/$($found.messages[0].ID)"
   $verifyToken = [regex]::Match($message.Text, 'token=([A-Za-z0-9_-]+)').Groups[1].Value
   Invoke-RestMethod -Method Post -Uri "$api/auth/verify-email" -ContentType $json -Body (@{ token = $verifyToken } | ConvertTo-Json)
   Remove-Variable query, found, message, verifyToken
   ```
   It says `Email address verified.`
3. **Sign in.** Run these lines again when the access token has expired (after 15 minutes):
   ```powershell
   $customer = Invoke-RestMethod -Method Post -Uri "$api/auth/login" -ContentType $json -Body (@{ email = $customerEmail; password = $customerPassword } | ConvertTo-Json)
   $me = @{ Authorization = "Bearer $($customer.accessToken)" }
   $cart = "$api/me/cart"
   ```
4. **Set how many packs of a pack size the cart holds,** 1 to 4. The answer is the whole cart:
   ```powershell
   $view = Invoke-RestMethod -Method Put -Uri "$cart/items/ASH-CAP-60" -Headers $me -ContentType $json -Body '{"packs":2}'
   $view.items | Format-Table sku, packs, priceRupees, lineTotalRupees, status
   "$($view.packs) packs: Rs $($view.subtotalRupees), MRP Rs $($view.mrpTotalRupees)"
   ```
   Sending the same number again changes nothing. To change it, send the new number.
5. **See the cart:**
   ```powershell
   $view = Invoke-RestMethod -Uri $cart -Headers $me
   $view.items | Format-Table sku, packs, priceRupees, lineTotalRupees, status
   ```
6. **Run only the line you need:**
   ```powershell
   # Take one pack size out of the cart.
   Invoke-RestMethod -Method Delete -Uri "$cart/items/ASH-CAP-60" -Headers $me
   # Empty the whole cart.
   Invoke-RestMethod -Method Delete -Uri $cart -Headers $me
   ```
7. **Sign out and clean up:**
   ```powershell
   Invoke-RestMethod -Method Post -Uri "$api/auth/logout" -ContentType $json -Body (@{ refreshToken = $customer.refreshToken } | ConvertTo-Json)
   Remove-Variable api, json, customerEmail, customerPassword, customer, me, cart, view -ErrorAction SilentlyContinue
   ```

- **The limit counts the product, not the line.** With 3 packs of `ASH-CAP-60`, only 1 pack of `ASH-CAP-120` fits. Moving packs between sizes is fine while the total stays at 4.
- **Each line has a status:** `AVAILABLE` (on sale and in stock), `OUT_OF_STOCK`, or `OFF_SALE` (taken off sale, or its product or category hidden). Only `AVAILABLE` lines count in `packs`, `subtotalRupees` and `mrpTotalRupees`. The others stay in the cart until the customer removes them.
- **Fewer packs are always fine.** A pack out of stock can't be added, and its packs can't go up, but they can go down. A pack off sale can only be removed.
- **Prices are always today's.** When staff change a price, the cart shows the new one at once. The price is fixed when the order is placed.
- **A cart nobody changes for 90 days is deleted** by the hourly cleanup, with its lines. Every change to the cart counts, removing a pack size too.
- A customer's own cart is not in the audit log: it records staff actions only.

## Place an order

A signed-in customer places an order from the whole cart, to one of their own addresses (ADR 0026). Every amount is whole rupees. **The GST is inside the prices, never added:** the order shows how much of its total is GST. Delivery costs ₹49 while the items come to less than ₹499, and is free from ₹499. An order takes its stock at once, from the batches that expire first, and holds it for 15 minutes while the customer pays (see "Pay for an order"). Orders are never deleted.

The shop needs a live product with a pack in stock (see "Manage stock").

1. **Sign in as a customer and fill the cart,** as in "Use the cart", steps 1 to 4. Then add a delivery address:
   ```powershell
   $address = @{ fullName = 'Order Tester'; phone = '9845012345'; line1 = '12, 3rd Cross, Indiranagar'; city = 'Bengaluru'; state = 'Karnataka'; pincode = '560038' } | ConvertTo-Json
   $addressId = (Invoke-RestMethod -Method Post -Uri "$api/me/addresses" -Headers $me -ContentType $json -Body $address).id
   "[$addressId]"
   ```
2. **See the checkout:** what the cart would cost as an order now.
   ```powershell
   $quote = Invoke-RestMethod -Uri "$api/me/checkout" -Headers $me
   $quote.items | Format-Table sku, packs, priceRupees, lineTotalRupees, gstRate, gstRupees
   $quote | Format-List itemsTotalRupees, itemsGstRupees, deliveryChargeRupees, totalRupees
   ```
   For the 2 packs at ₹449 of "Use the cart": `898`, `43`, `0` and `898`. The ₹43 of GST (₹42.76, rounded) is inside the ₹898, not added to it. One pack would cost ₹449 plus ₹49 delivery: ₹498.
3. **Place the order,** with a new `Idempotency-Key` and the total the checkout showed:
   ```powershell
   $key = [guid]::NewGuid().ToString()
   $orderBody = @{ addressId = $addressId; totalRupees = $quote.totalRupees } | ConvertTo-Json
   $order = Invoke-RestMethod -Method Post -Uri "$api/me/orders" -Headers ($me + @{ 'Idempotency-Key' = $key }) -ContentType $json -Body $orderBody
   $order | Format-List reference, status, totalRupees, holdExpiresAt
   ```
   It says `PENDING_PAYMENT`, and the cart is now empty. Running the same `$order = …` line again answers the same order and places nothing: that is what a double tap or a retry does.
4. **See the orders,** newest first, or one of them:
   ```powershell
   (Invoke-RestMethod -Uri "$api/me/orders" -Headers $me).orders | Format-Table reference, status, totalRupees, createdAt
   (Invoke-RestMethod -Uri "$api/me/orders/$($order.id)" -Headers $me).items | Format-Table sku, packs, priceRupees, lineTotalRupees, gstRupees
   ```
5. **Cancel it,** or leave it: paying needs Razorpay's payment page (see "Pay for an order"). An order not paid within 15 minutes expires on its own, within about a minute after `holdExpiresAt` (a UTC time). Either way, its stock comes back.
   ```powershell
   (Invoke-RestMethod -Method Post -Uri "$api/me/orders/$($order.id)/cancel" -Headers $me).status
   ```
6. **Sign out and clean up,** as in "Use the cart", step 7, then:
   ```powershell
   Remove-Variable address, addressId, quote, key, orderBody, order -ErrorAction SilentlyContinue
   ```

- **An order takes the whole cart,** at today's prices. Every line must be `AVAILABLE`: remove the others first.
- **The total must be the one the customer saw.** If staff change a price in between, placing the order answers `409`: look at the checkout again.
- **At most 3 orders wait for payment per customer.** Cancel one to place a 4th.
- **Staff see an order's stock in a batch's history,** as `ORDERED` (taken) and `RELEASED` (given back) movements without an actor. A batch's `quantity` doesn't count the packs that unpaid orders hold.
- **Orders are never deleted,** and what the customer agreed to never changes. They are not in the audit log: an order is a record itself.
- **The expiry job writes `Unpaid orders expired`** to the API's log, with the count, whenever it expires any.

## Pay for an order

Customers pay through Razorpay (ADR 0027). Until the apps exist, `pnpm api:pay-test` plays the app. It orders for a throwaway customer, and serves a small payment page on your computer, where you pay in Razorpay's test mode. No real money moves: the command runs only in development, with test keys.

The shop needs a live product with a pack in stock (see "Manage stock"). The API and Mailpit must be running, and the internet must be there: the payment page comes from Razorpay.

1. **Run it,** from the repository root:
   ```powershell
   pnpm api:pay-test
   ```
   It makes a customer (`pay.<number>@example.com`) with an address, orders one pack of the first pack in stock, starts paying, and says `Open http://localhost:4400 in your browser and pay.`
2. **Pay in the browser:** press **Pay with Razorpay**, and pay with the test card `4100 2800 0000 1007` (any future expiry date, any CVV), or with UPI `success@razorpay`. If a test bank page asks, choose Success.
3. **Read the result** on the page and in the terminal. The script confirms the payment as an app would, then sends a signed copy of Razorpay's webhook for it, which must change nothing:
   ```
   PASS  the API confirms the payment (200)
   PASS  the order is paid
   PASS  Razorpay's webhook for the same payment is taken, and changes nothing
   ```
   Mailpit shows the customer's `Your order … is confirmed` within a second (see "Order emails").
4. **A refund:** `pnpm api:pay-test --cancel` cancels the order before you pay. The payment must then go back in full: `Refund of Rs 498 (ORDER_CANCELLED): PENDING`. Mailpit shows `Your order … is cancelled` as soon as it is cancelled.
5. **A late payment:** run `pnpm api:pay-test`, open the page, and wait **more than 16 minutes** before paying. The order expires and gives its stock back. The payment then takes the stock again, and the order is paid late. If the stock is gone meanwhile, the payment goes back in full (`ORDER_EXPIRED`).
6. **The Razorpay dashboard,** in Test Mode, shows the same payments and refunds.

- **An order of one pack at ₹449 costs ₹498** with delivery, in test money.
- **The API asks Razorpay about every payment.** The page's answer only names the payment, and Razorpay's signature on it must match the Razorpay order the API made for this order.
- **On a laptop, a refund stays `PENDING`.** Razorpay reports a finished refund with a webhook, and Razorpay can't reach a laptop. Deployed, the webhook moves it to `PROCESSED`, and the customer is emailed that the refund is complete. The dashboard shows its real state.
- **Razorpay's own webhooks need a public HTTPS address,** on port 443 or 80. On a laptop, the smoke test and this script send webhooks signed with `RAZORPAY_WEBHOOK_SECRET` from `.env` instead. To receive Razorpay's own while developing, Razorpay suggests a tunnel such as zrok, and refuses ngrok addresses. ADR 0027 lists the URL and events to set in the dashboard.
- **A refund made on its own costs Razorpay's fee:** Razorpay keeps the fee it took on the payment, about 2.36% of the order (ADR 0027).
- **A paid order can be cancelled until it ships,** by its customer or by a Super User. Its payment goes back in full, as `CANCELLED_BY_CUSTOMER` or `CANCELLED_BY_STAFF` (see "Handle orders").
- **A refund Razorpay refuses** becomes `FAILED`, and the API logs `Razorpay refused a refund: staff must give the money back`. Give it back by hand in the Razorpay dashboard.
- **The expiry job writes** `Payments found before their orders expired` and `Refunds taken when asked again` to the API's log, with counts only, and a warning when some could not be done.

## Handle orders

Staff take a paid order through its steps: packed, shipped with the courier and its tracking number, and delivered (ADR 0028). Admins and Super Users take the steps. Only a Super User sees an order's payment, and cancels an order, until it ships: a paid order's payment then goes back in full. Every step is in the audit log. There is no courier integration: staff book the courier themselves, and type in its name and the tracking number.

The shop needs a paid order: see "Pay for an order".

1. **Sign in as staff and set the variables,** as in "Manage products", step 1.
2. **List the paid orders,** the oldest first: the work to pack, in turn.
   ```powershell
   $page = Invoke-RestMethod -Uri "$api/staff/orders?status=PAID&sort=oldest" -Headers $auth
   $page.orders | Format-Table reference, status, totalRupees, deliveryName, deliveryCity, createdAt, id
   ```
   Take the order's ID from the list: `$orderId = '<its id>'`. Or find the order a customer quoted, by its reference, in place of `7KQ2M9XDPA` here:
   ```powershell
   $orderId = (Invoke-RestMethod -Uri "$api/staff/orders?reference=7KQ2M9XDPA" -Headers $auth).orders[0].id
   "[$orderId]"
   ```
   **If the brackets are empty, stop.**
3. **See what to pack,** and where it goes:
   ```powershell
   $order = Invoke-RestMethod -Uri "$api/staff/orders/$orderId" -Headers $auth
   $order.items | Format-Table sku, productName, packs, hsnCode
   $order.delivery | Format-List
   ```
   A Super User also sees `$order.payment`, with Razorpay's IDs and any refunds. An Admin's answer has no `payment`.
4. **Mark it packed,** once the parcel is ready:
   ```powershell
   (Invoke-RestMethod -Method Post -Uri "$api/staff/orders/$orderId/packed" -Headers $auth).status
   ```
5. **Mark it shipped,** once the courier has it, with the courier's name and the tracking number:
   ```powershell
   $body = @{ courierName = 'Delhivery'; trackingNumber = 'ee 1490 8112 3456' } | ConvertTo-Json
   Invoke-RestMethod -Method Post -Uri "$api/staff/orders/$orderId/shipped" -Headers $auth -ContentType $json -Body $body | Format-List status, shippedAt, courierName, trackingNumber
   ```
   The tracking number is stored without spaces and in capitals: `EE149081123456`. To correct a typing mistake while the order is on its way, send only what changes:
   ```powershell
   $body = @{ trackingNumber = 'EE149081123457' } | ConvertTo-Json
   Invoke-RestMethod -Method Patch -Uri "$api/staff/orders/$orderId/shipment" -Headers $auth -ContentType $json -Body $body | Format-List courierName, trackingNumber
   ```
6. **Mark it delivered,** once the courier says so:
   ```powershell
   (Invoke-RestMethod -Method Post -Uri "$api/staff/orders/$orderId/delivered" -Headers $auth).status
   ```
7. **Or cancel it instead,** as a Super User, any time before step 5. Its stock comes back at once, and a paid order's payment goes back in full:
   ```powershell
   $cancelled = Invoke-RestMethod -Method Post -Uri "$api/staff/orders/$orderId/cancel" -Headers $auth
   $cancelled.status
   $cancelled.payment.refunds | Format-Table amountRupees, reason, status, razorpayRefundId
   ```
   It says `CANCELLED`, with a refund of the whole total, `CANCELLED_BY_STAFF`. On a laptop the refund stays `PENDING` (see "Pay for an order").
8. **See the refunds,** as a Super User: all of them, the newest first, or with `?status=FAILED` only those Razorpay refused, to give back by hand in the Razorpay dashboard:
   ```powershell
   (Invoke-RestMethod -Uri "$api/staff/refunds" -Headers $auth).refunds | Format-Table createdAt, amountRupees, reason, status, orderId
   ```
9. **Read the order's story** in the audit log, as a Super User:
   ```powershell
   (Invoke-RestMethod -Uri "$api/staff/audit-log?targetId=$orderId" -Headers $auth).entries | Format-Table createdAt, action, @{ n = 'actor'; e = { $_.actor.email } }
   ```
10. **Clean up:**
    ```powershell
    Remove-Variable login, auth, page, orderId, order, body, cancelled -ErrorAction SilentlyContinue
    ```

- **Each step follows the one before:** a paid order is packed, a packed one shipped, and a shipped one delivered. A step done already answers `409` and changes nothing, so a double click does no harm.
- **Cancelling a packed order puts its packs back in stock at once:** unpack it, and put the packs back on the shelf.
- **A customer cancels their own order the same way,** until it ships (`POST /v1/me/orders/:id/cancel`). Its refund's reason is then `CANCELLED_BY_CUSTOMER`.
- **Each refund costs Razorpay's fee,** about 2.36% of the order (ADR 0027). The owner accepted that for orders cancelled before they ship.
- **The customer sees each step** on their order: `packedAt`, `shippedAt`, `courierName`, `trackingNumber` and `deliveredAt`.
- **The audit log keeps every step:** `order.packed`, `order.shipped` (with the courier and tracking number), `order.shipment_corrected` (only what changed), `order.delivered` and `order.cancelled` (with the refund's ID).
- **The customer is emailed** at each step, when the courier or tracking number is corrected, and when the order is cancelled (see "Order emails").
- **The API's log** says `Order moved to its next step`, `Order shipment corrected` and `Order cancelled by staff`, with the order's and the staff member's IDs.

## Order emails

The API emails the customer when their order is paid, packed, shipped, delivered or cancelled, and when a refund is complete. It emails every active Super User when a refund fails (ADR 0029). In development, read them all in Mailpit at http://localhost:8025.

| When | Who gets it | Subject |
|---|---|---|
| The order is paid | The customer | `Your order 7KQ2M9XDPA is confirmed`: each line, the totals with the GST included, the delivery charge and the delivery address |
| Staff mark it packed | The customer | `Your order 7KQ2M9XDPA is packed` |
| Staff mark it shipped | The customer | `Your order 7KQ2M9XDPA is on its way`, with the courier and tracking number |
| Staff correct the courier or tracking number | The customer | `New tracking details for your order 7KQ2M9XDPA` |
| Staff mark it delivered | The customer | `Your order 7KQ2M9XDPA is delivered` |
| The customer or a Super User cancels it | The customer | `Your order 7KQ2M9XDPA is cancelled`: a paid order's payment is going back in full |
| A refund is complete | The customer | `Your refund for order 7KQ2M9XDPA is complete` |
| A refund fails | Every active Super User | `Action needed: a refund for order 7KQ2M9XDPA failed` |

Each email is saved with the change it tells of, and sent within a second of it. One that can't be sent, for example while Mailpit is stopped, is tried again by a job every minute: after 1, 2, 4 and so on up to 60 minutes. After 10 tries, about 4 hours, it is given up on.

**See the emails the API has saved,** the newest first, without changing anything. Use the database user and name from your `.env` (`herbal_app` and `herbal_dev` in `.env.example`):
```powershell
'BEGIN READ ONLY; SELECT kind, status, attempts, "nextAttemptAt", "sentAt" FROM notifications ORDER BY "createdAt" DESC LIMIT 10; ROLLBACK;' | docker exec -i herbal-postgres psql -U herbal_app -d herbal_dev
```
`WAITING` means not sent yet: its next try is at `nextAttemptAt`. `SENT` means sent, and `FAILED` means given up on.

- **The emails have no links,** on purpose: customers can be told never to trust a link in an email from the shop. Amounts are written like `Rs 1,299`.
- **An expired order sends nothing,** and nor does a late or second payment that goes back. The customer hears once the refund is complete.
- **On a laptop, no refund email is sent:** refunds stay `PENDING` (see "Pay for an order"), and their emails wait for `PROCESSED` or `FAILED`.
- **Rarely, an email is sent twice:** when the API stops between sending it and marking it sent.
- **The API's log** says `Emails sent` with counts, `An email could not be sent: it is tried again later` as a warning, and `An email could not be sent, and is not tried again` as an error. Each names the email's ID and kind, never an address.

## Repository structure

```
.
├── apps/
│   ├── admin/                  the admin console: React, Vite and Tailwind (ADR 0031)
│   │   ├── public/             the favicon
│   │   ├── scripts/            check-build.mjs (checks every build)
│   │   └── src/
│   │       ├── api/            the one API client: the access token in memory, renewal one at a time, answers checked
│   │       ├── auth/           signing in, the session and its tabs, the role guards, the idle sign-out
│   │       ├── components/, layout/, pages/   the screens, the menu and the pages
│   │       ├── security-headers.ts   the page's Content Security Policy and security headers
│   │       ├── motion.ts       the console's motion: durations and movements
│   │       └── index.css       the colours, light and dark
│   └── api/                    NestJS backend (modular monolith)
│       ├── prisma/             schema and migrations
│       ├── scripts/            auth-smoke.cjs (smoke test), pay-test.cjs (a payment by hand), clear-rate-limits.cjs
│       ├── storage/            uploaded image files on a laptop (ignored by Git)
│       └── src/
│           ├── addresses/      customers' delivery addresses
│           ├── audit/          the append-only audit log, a request's audit context, and reading the log page by page
│           ├── auth/           registration, login, tokens and sessions (customer and staff audiences), password reset and change, access and roles guards, /v1/me
│           ├── cart/           signed-in customers' carts: the rules (4 packs of one product, 50 pack sizes, totals) and the routes
│           ├── catalog/        categories, products, pack sizes and images: their rules (slug, going live, prices, image checks), the staff routes and the public shop
│           ├── inventory/      stock per batch: the rules (dates, 6-month shelf life), the staff routes, "in stock" for the shop, and taking and giving back stock for orders
│           ├── orders/         checkout and customers' orders: the rules (totals, delivery, GST, references), the routes, paying for them and Razorpay's webhooks, the job that expires unpaid orders, and staff taking orders through their steps
│           ├── payments/       payments and refunds, the Super Users' list of refunds, and the only code that talks to Razorpay
│           ├── cli/            developer commands (create a Super User, set up staff MFA), without HTTP
│           ├── staff/          staff accounts: Super Users, MFA, staff sign-in, inviting and managing Admins, /v1/staff/me
│           ├── rate-limit/     limits, rate-limit guard, client IP
│           ├── retention/      hourly cleanup of data past its retention period
│           ├── valkey/         the shared Valkey connection
│           ├── mail/           email sending (SMTP; Mailpit in development)
│           ├── notifications/  the order emails: saved with each change, written, sent right after and tried again every minute
│           ├── media/          storing uploaded files, and serving them at /media
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
├── package.json                root commands (api:dev, api:test, api:smoke, admin:dev, admin:build, ...)
└── pnpm-workspace.yaml         workspace, build approvals, 3-day minimum release age
```

## Security notes

- `.env` holds secrets and is ignored by Git. Never commit it or paste it into chats or tickets.
- `.env.example` is committed, so it holds placeholders only. Never put a real secret in it. If a secret is ever committed or shared, generate a new one.
- Access and refresh tokens are secrets too. Never paste them into chats, tickets or logs.
- The Razorpay Key Secret and `RAZORPAY_WEBHOOK_SECRET` are secrets like the others: only in `.env`. Use test keys (`rzp_test_`) on a laptop: production refuses them, and live keys move real money.
- Use synthetic data in development. Never log passwords, tokens or personal data.
- The generated database client (`apps/api/src/generated`) is not committed. Run `prisma generate` after cloning.
- The API listens on `127.0.0.1` only until it is deployed behind HTTPS (the remaining steps are listed in `docs/security.md`). To test on an Android phone, connect it over USB and run `adb reverse tcp:3000 tcp:3000`.
- Never put Super User credentials in `.env` or type the password on the command line. Use `Read-Host` as shown above, and remove the variables afterwards.
- Treat an MFA setup key like a password: it is shown once, typed into the app, and then cleared from the screen. Back up `MFA_ENCRYPTION_KEY` with the other production secrets.
- Leave `TRUST_PROXY` empty unless the API runs behind a proxy you control. Then list that proxy's address. Never use a hop count: it would let anyone fake their IP and dodge the rate limits.
- **In the admin console,** tokens never go into `localStorage` or `sessionStorage`: the refresh token is in an `HttpOnly` cookie, the access token only in memory. Never weaken the page's security policy (`apps/admin/src/security-headers.ts`) with `unsafe-inline` or `unsafe-eval`: `pnpm admin:build` refuses it.
- Set `ADMIN_ORIGIN` to the console's exact address. In production it must be `https`, and the console must be served from the same origin as the API (`docs/security.md`, section 6).
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
- **The admin console says "The server can't be reached":** start the API (`pnpm api:dev`) and click "Try again". If the API is running, check that the console is open at exactly `ADMIN_ORIGIN` (by default http://localhost:5173): from any other address the API ignores the session cookie.
- **`pnpm admin:dev` or `admin:preview` says port 5173 is in use:** the other one, or an earlier copy, is still running. Stop it first: the console must stay on 5173, its `ADMIN_ORIGIN`.
- **The admin console signed you out unexpectedly:** after 30 minutes without activity it does so on purpose, and says so. Otherwise the session's 12 hours ran out, or you signed out in another tab.
- **The API refuses to start: `MFA_ENCRYPTION_KEY: ...`:** add your own value to `.env` (see First-time setup, step 1). It must differ from `JWT_ACCESS_SECRET`.
- **The API refuses to start: `RAZORPAY_KEY_ID: ...`, `RAZORPAY_KEY_SECRET: ...` or `RAZORPAY_WEBHOOK_SECRET: ...`:** put your Razorpay test keys and your own webhook secret into `.env` (see First-time setup, step 1). The webhook secret must differ from `JWT_ACCESS_SECRET` and `MFA_ENCRYPTION_KEY`.
- **Paying answers `503 PAYMENTS_UNAVAILABLE`:** find `Razorpay could not start a payment` (or `confirm`) in the API log. A `status` of `401` means the key ID or Key Secret in `.env` is wrong: copy them again from the dashboard, then restart the API. No status means Razorpay couldn't be reached: check the internet.
- **`pnpm api:pay-test` says "no pack is in stock":** the shop has none. Make a live product with a pack in stock (see "Manage products" to "Manage stock").
- **An order email didn't arrive:** look the email up (see "Order emails"). `WAITING` with a few tries: it couldn't be sent yet, so check that Mailpit is running (`docker compose up -d`); it is tried again at `nextAttemptAt`. `FAILED`: it was given up on after 10 tries, and the API's log says why, as `An email could not be sent, and is not tried again`. No row at all: the change wasn't saved, or it sends no email, such as an expired order.
- **A refund-failed email keeps being tried again:** it goes to every active Super User, so check that at least one is active. Once one is, it goes out at its next try.
- **`pnpm api:pay-test` says port 4400 is in use:** another payment test is still open. Stop it with Ctrl+C.
- **After paying, the order still waits for payment:** Razorpay hasn't captured the payment. Check in the dashboard that payments are captured automatically, Razorpay's default.
- **The authenticator app says "illegal character":** a `0`, `1`, `8` or `9` was typed. The key only has `A`–`Z` and `2`–`7`, so type the letters O, I or B instead.
- **The setup command refuses every code:** the key in the app differs from the one shown (often `0` for O), or the entry is not **Time based**, or the phone's clock is off. Set the phone's time automatically, delete the app entry and run the command again.
- **A product isn't found by the search:** check that it is live, in an active category (see "Manage products"). A word only in its ingredients, usage or maker isn't searched. A spelling that shares too little with the name, such as "tulasi" for "Tulsi", isn't found either.
- **The search answers `400 Validation failed`:** the `errors` list names the parameter. Words need 2 to 100 characters, `sort=relevance` needs words, and the lowest price can't be above the highest.
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
- **Activating a product answers `400` with "Needed before the product can go live":** the `errors` list names each missing detail (type, licence number, maker's name and address, ingredients, HSN code, GST rate). Send them in the same request as `"isActive":true`, or first. If it names `images`, upload a photo first (see "Manage product images"). That is also why creating a product with `"isActive":true` is always refused.
- **A product answers `400` for `gstRate`:** the rate is one of `0`, `5`, `18` and `40`, sent as a number (`5`, not `"5"`). Other rates, such as 12, no longer exist since GST 2.0.
- **A product answers `400` "An HSN code has 4, 6 or 8 digits":** send only the digits, such as `3004` or `300490`. Spaces are fine, other characters are not.
- **A product answers `400` "An FSSAI licence number has exactly 14 digits":** the type is `FOOD_OR_SUPPLEMENT`, and the licence isn't 14 digits. Fix the number, or choose the right type.
- **Creating or moving a product answers `400` for `categoryId` "No category with this ID":** the category was deleted, or the ID is wrong.
- **Creating or changing a product answers `409`:** another product already has that slug. Send a different `slug`.
- **A live product's page answers `404`:** its category is hidden. A product shows in the shop only while both it and its category are active.
- **A pack answers `400` "The price may not be more than the MRP":** the price is above the MRP, perhaps because the change lowered only the MRP. Send the MRP and the price together.
- **A pack answers `400` for `mrpRupees` or `priceRupees`:** a price is a whole number of rupees from 1 to 10,00,000. `449.50` and `"449"` are refused.
- **Prices in the shop look 100 times too high:** they were typed in paise. Prices are whole rupees: change them, for example `{"mrpRupees":500,"priceRupees":449}`.
- **Adding or changing a pack answers `409`:** read the message. Either another pack, maybe of another product, already has that SKU, or this product already has a pack of that quantity and unit. Change the existing pack instead.
- **A pack answers `404`:** `Pack size not found` means it was deleted, maybe with its product, or the ID is wrong: list the packs again (step 3 of "Manage pack sizes and prices"). `Product not found` means the product ID is wrong.
- **Uploading an image answers `400` "The file is not a JPEG image"** (or PNG, or WebP): the `-ContentType` does not match the file. A file's type is in its first bytes, not its name: a `.jpg` that is really a PNG needs `image/png`.
- **Uploading answers `400` "The image needs at least 400 pixels on each side":** the photo is too small, maybe a thumbnail downloaded from a website. Use the original photo.
- **Uploading answers `400` "The image may have at most 50 megapixels":** scale the photo down first, for example to 4000 pixels on its longest side.
- **Uploading answers `400` "The image could not be read. It may be damaged.":** the file is damaged or incomplete, for example a download that stopped early. Copy it again.
- **Uploading answers `415`:** read the message. Either the body was not an image (JSON, or a `-ContentType` such as `image/gif` or `image/jpg`), or it was compressed. Send the file with `-InFile` and `-ContentType 'image/jpeg'`, `'image/png'` or `'image/webp'`. GIF, SVG, HEIC and AVIF are not accepted: save the photo as a JPEG first.
- **Uploading answers `413 Request body too large`:** the file is over 10 MB. Scale it down, or save it as a JPEG.
- **Uploading answers `409 A product has at most 6 images.`:** delete one first.
- **Deleting an image answers `409 A live product needs at least one image.`:** upload the new photo first, then delete the old one. Or take the product out of the shop first.
- **An upload ends in "The underlying connection was closed" or "connection reset":** the access token has expired (after 15 minutes) or is not a staff token. The API refuses an upload without reading it, which can close the connection before PowerShell sees the `401`. Sign in again, and set `$auth` again.
- **Uploading answers `503` with `code: "SERVER_BUSY"`:** many images are being checked at once. Wait the `Retry-After` seconds and try again.
- **An image answers `404 Image not found`:** it was deleted, maybe with its product, or the ID is wrong. List the images again (step 4 of "Manage product images").
- **An image address shows a plain page "Cannot GET /media/…":** the file does not exist, maybe because its image was deleted. Every address outside `/v1` answers a missing page this way, not with JSON.
- **Image addresses point to port 3000, but the API runs on another port:** set `MEDIA_BASE_URL` in `.env`, for example `http://127.0.0.1:3001/media`, and restart the API.
- **Receiving a batch answers `400`:** the `errors` list names each field. `Use a date like 2026-10-31` means the date is in another form, such as `31/10/2026`. "The manufacturing date cannot be in the future", "The expiry date must be after the manufacturing date" and "This batch has already expired" compare the label's dates with India's date today: check the label again. Correcting a batch's dates (`PATCH`) checks the first two as well, but an expired batch's label can still be corrected.
- **Receiving or correcting a batch answers `409 This pack size already has a batch with this number.`:** that batch is already in stock. Add the new packs to it with a `RECEIVED` change instead (step 4 of "Manage stock"), or fix a mistyped number.
- **A stock change answers `400`:** read the message. "A delivery adds stock: use a positive number" and "A write-off removes stock: use a negative number" mean the sign of `change` does not fit the `reason`. "Say why the count differs" means a `CORRECTION` needs a `note`. "This batch has already expired" means an expired batch takes no more deliveries: receive a new batch.
- **A stock change answers `409 Not enough stock: this batch holds N.`:** the change would take the batch below 0. List the batches again (step 3 of "Manage stock") and count again.
- **Deleting a pack size or product answers `409` "still has stock":** write its batches off to 0 first (`EXPIRED`, `DAMAGED` or a `CORRECTION` with a note), then delete it. Its stock history stays.
- **A pack shows `inStock` `False` in the shop, but there is stock on the shelf:** its batches have less than 6 months left, so they are not sold. Compare `quantity` and `sellableQuantity` in step 3 of "Manage stock". A pack taken off sale is not in the shop at all.
- **A stock route answers `404`:** `Batch not found` means the batch ID is wrong: list the batches again (step 3 of "Manage stock"). `Pack size not found` means the pack size was deleted, or its ID is wrong.
- **Adding to the cart answers `409 At most 4 packs of one product, all its pack sizes together.`:** the cart already has packs of that product in its other sizes, as the message says. Lower those first, or send fewer packs.
- **Adding to the cart answers `409 This pack size is out of stock.`:** it can't be added, and its packs can't go up. Lowering or removing it is fine.
- **Adding to the cart answers `409 A cart holds at most 50 pack sizes. Remove one first.`:** remove a pack size, or empty the cart.
- **The cart answers `404 Pack size not found`:** the SKU is not one the shop sells now. Write it exactly as the shop shows it, in capitals (`ASH-CAP-60`, not `ash-cap-60`). A pack taken off sale, or whose product or category is hidden, answers `404` too: it can only be removed.
- **The cart answers `400` for `packs`:** send a whole number from 1 to 4, as a number (`2`, not `"2"`). To take a pack size out, delete it instead of sending 0.
- **The cart answers `401`:** the customer's access token has expired (sign in again, step 3 of "Use the cart"), or it is a staff token. Carts are for customers only.
- **A cart line shows `OUT_OF_STOCK` or `OFF_SALE`:** the pack sold out, or staff took it off sale, after it went into the cart. The line stays, but doesn't count in the totals. Remove it, or wait for new stock.
- **A cart is empty after months away:** a cart nobody changes for 90 days is deleted by the hourly cleanup.
- **The checkout or an order answers `409 The cart is empty.`:** put packs in the cart first. Right after an order, the cart is empty on purpose.
- **The checkout or an order answers `409 These packs can't be ordered now: …`:** the named pack sizes are `OUT_OF_STOCK` or `OFF_SALE`. Remove them from the cart, then look at the checkout again.
- **Placing an order answers `409 The total has changed. Check the cart and try again.`:** a price changed after the checkout, or `totalRupees` was not the checkout's. Get the checkout again and send its `totalRupees`. A total in paise, such as `49800` for ₹498, is refused the same way.
- **Placing an order answers `400` naming `Idempotency-Key`:** send the header with a new UUID, as in step 3 of "Place an order".
- **Placing an order answers `409 You have 3 orders waiting for payment. Pay for one or cancel it first.`:** cancel one, or wait until one expires.
- **Placing an order answers `409` "is out of stock, or not enough of it is left":** other orders took the last packs. Change the cart, then look at the checkout again.
- **Placing an order answers an older order:** its `Idempotency-Key` was used before. Make a new one for each new order.
- **Cancelling answers `409 This order can no longer be cancelled.`:** the order has shipped, or it was delivered, cancelled already, or it expired. A shipped order can't be cancelled: returns are still to come.
- **Marking an order packed, shipped or delivered answers `409`:** a message ending in `already` means the step was done before, maybe by someone else, and nothing changed. `Only a paid order can be packed.`, `Only a packed order can be shipped.` or `Only a shipped order can be marked delivered.` means the order isn't at the step before: look at its `status`.
- **Shipping answers `400 A tracking number has 4 to 40 letters, digits or hyphens`:** check the number on the courier's receipt. Spaces are fine: they are dropped.
- **Correcting a shipment answers `409 Only an order on its way can have its courier or tracking number corrected.`:** the order isn't `SHIPPED`. It hasn't shipped yet, or it is delivered.
- **Cancelling an order, or listing refunds, answers `403 Only a Super User may do this.`:** an Admin is signed in. Admins never move money.
- **An order stays `PENDING_PAYMENT` after its hold:** the API is not running, and the expiry job runs inside it. Start the API: the order expires within a minute.
- **A pasted block runs two commands as one,** for example `ConvertTo-Json$id = …`: the line break between them was lost in the paste. Press `Ctrl+C`, paste the multi-line block on its own, press Enter until the prompt is back, then paste the next line.
- **Right after `pnpm api:smoke`, a logout answers `429`:** the smoke test uses up the logout limit (120 per minute per IP) on purpose. Wait a minute, or run `pnpm api:limits:clear`.
- **`prisma migrate dev` says a migration was modified after it was applied, and asks to reset the database:** answer **no**, because a reset deletes all data. An applied migration file was changed, maybe by a search and replace. Put it back exactly as it was applied:
  - `git diff`, or `git log -p -- <the migration's folder>` once committed, shows what changed;
  - Prisma keeps each applied file's SHA-256 in the `checksum` column of the `_prisma_migrations` table, so `Get-FileHash <the migration.sql file>` must match it again;
  - then `prisma migrate dev` answers `Already in sync`.

  Never change an applied migration (ADR 0003).
- **`prisma migrate dev` asks "Enter a name for the new migration" right after applying one:** the schema and the database still differ, usually because something was lost from the migration you edited. Press `Ctrl+C`, then see what a new migration would contain: `pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` (in `apps/api`; it only reads). Put a missing piece into a **new** migration. Never edit one that has been applied: Prisma would then want to reset the database.
