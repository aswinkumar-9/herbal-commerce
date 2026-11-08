# Architecture

Status: **Draft v0.19.** This document describes what exists today and the direction we intend to follow. Items marked "planned" are not built yet.

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
                           │            ├────────────────►  SMTP            (Mailpit in development)
                           │            │
                           │            └────────────────►  Media folder    (image files, served at /media; object storage + CDN later)
```

Built so far:

| Area | State |
|------|-------|
| Configuration | Environment variables validated at startup. The app refuses to start on invalid config and never prints secret values. In production it also refuses placeholder secrets and a non-HTTPS website or image URL (ADR 0008, ADR 0023). Two strong secrets: `JWT_ACCESS_SECRET` and `MFA_ENCRYPTION_KEY`, which must differ. `MEDIA_DIR` and `MEDIA_BASE_URL` say where image files are kept and linked from. |
| Health | `GET /health` (liveness) and `GET /health/ready` (PostgreSQL and Valkey reachable, 503 otherwise) |
| Database | Prisma 7 with the PostgreSQL driver adapter. Tables: `users` (roles `CUSTOMER`, `ADMIN`, `SUPER_USER`), `email_verification_tokens`, `password_reset_tokens`, `staff_invitations`, `sessions`, `refresh_tokens`, `audit_log`, `addresses` (with a partial unique index: at most one default per customer), `categories` (with a unique slug), `products` (a unique slug, the enum `ProductType`, a foreign key to its category with `ON DELETE RESTRICT`, and a check constraint: a live product has its licence and maker details, its ingredients, its HSN code and its GST rate) `product_variants` (the pack sizes: a unique SKU, each size once per product, the enum `PackUnit`, a foreign key to its product with `ON DELETE CASCADE`, and a check constraint: the price is never above the MRP) `product_images` (a unique random file key, a foreign key to its product with `ON DELETE CASCADE`, and triggers: at most 6 images per product, and a live product keeps at least 1), `stock_batches` (a pack size's batches: a batch number unique in its pack, the manufacturing and expiry dates, and the quantity on hand) and `stock_movements` (every change to a batch's stock, with the enum `StockReason`). Triggers apply each movement to its batch, change the quantity in no other way, never let it go below 0, keep movements final, and refuse to delete a batch that holds stock. `carts` (one per customer, with when it last changed) and `cart_items` (a pack size and its packs, each pack size once per cart, foreign keys with `ON DELETE CASCADE` to the cart and the pack size). A check keeps a line at 1 to 4 packs, and a trigger keeps a cart at 4 packs of one product, all its sizes together, and 50 pack sizes. `orders` (a unique random reference, a foreign key to the customer with `ON DELETE RESTRICT`, an idempotency key unique for each customer, the enum `OrderStatus`, a copy of the delivery address, the amounts in whole rupees, and when its stock hold ends) and `order_items` (a copy of each pack size as ordered, with its ID but no foreign key to it). Checks keep the amounts adding up, and triggers let only an order's status change and never let an order or a line be deleted. `stock_movements` has an `orderId` for the reasons `ORDERED` and `RELEASED`, and a trigger never lets an order give a batch back more than it took. |
| HTTP baseline | Security headers (helmet), JSON-only bodies up to 100 kB, compressed bodies refused, listening on `127.0.0.1` only (ADR 0008). The one exception is the image upload route: its body is the image, up to 10 MB, read only for a valid staff token (ADR 0023). |
| Valkey | One shared connection (`ValkeyService`) that fails fast while Valkey is down and logs only changes of state |
| Rate limiting | A global guard limits every route per client IP, and each sign-up and sign-in endpoint further. Login has three failure counters with temporary blocks, shared by the customer and the staff login (`LoginAttemptsService`), and register and resend are limited per email address. Counters live in Valkey, falling back to memory, with hashed keys. Only proxies in `TRUST_PROXY` may report the client IP (ADR 0009). |
| Password hashing | At most 2 argon2 operations at once and 50 waiting; beyond that `503 SERVER_BUSY` (ADR 0009). Image checks have the same kind of limit: 2 at once and 10 waiting (ADR 0023). |
| Customer accounts | Registration, email verification and resend, without revealing which emails are registered (ADR 0007) |
| Password recovery | Forgot-password sends a 30-minute, single-use link (in the background, so every address answers equally fast). Reset-password sets the new password, marks the email verified, ends every session and lifts the login blocks (ADR 0010). |
| Customer sign-in | Login, refresh with rotation and reuse detection, logout. 15-minute access tokens (JWT, HS256, audience `customer`) and 30-day sessions (ADR 0007) |
| Customer account | `GET` and `PATCH /v1/me` (the name only), `POST /v1/me/password` (with the current password; every session ends, and wrong guesses count as failed logins) and `DELETE /v1/me/sessions` (sign out everywhere). The account is always the one in the token (ADR 0018). |
| Delivery addresses | `GET` and `POST /v1/me/addresses`, `PATCH` and `DELETE /v1/me/addresses/:id`. Indian addresses, with the phone and PIN code cleaned, the state from a fixed list, and at most 10 per customer. Exactly one default. Every query names the owner, so another customer's address answers `404`. A customer's changes take turns behind a row lock on their `users` row (ADR 0019). |
| Product categories | One level of categories, each with a unique slug made from the name (or given, for a name without Latin letters), a position and an active flag. A new one starts hidden. Admins and Super Users create, change, activate and deactivate them at `/v1/staff/categories`, and only Super Users delete one. Every change is audited in the same transaction, with only the changed fields, after a row lock on the category. Anyone may read the active ones at `GET /v1/categories`, which returns only the name, slug and description (ADR 0020). A category that still has products cannot be deleted (`409`). |
| Products | Each product belongs to one category and has a unique slug, texts (summary, description, ingredients as on the label, usage), a type (Ayurvedic medicine, food or supplement, cosmetic), a licence number, the maker's name and address, the country of origin, and for GST an HSN code and a rate (0, 5, 18 or 40%). A draft may lack the details. Going live needs the type, licence, maker's name and address, ingredients, HSN code and GST rate, checked on the product as it will be saved, and again by a check constraint. An FSSAI licence is 14 digits. Admins and Super Users manage them at `/v1/staff/products` (paged by cursor, filtered by category and status), only Super Users delete one, and every change is audited like a category's. The shop is public: `GET /v1/categories/:slug/products` (paged by slug) and `GET /v1/products/:slug`, for live products in active categories only, without IDs or staff fields (ADR 0021). |
| Pack sizes and prices | Each product has packs, such as 60 capsules or 100 g: a unique SKU, a quantity and a unit, an MRP and a price in whole rupees, never above the MRP (checked on the pack as it will be saved, and again by a check constraint), an on-sale flag and a position. Admins and Super Users add and change them at `/v1/staff/products/:productId/variants` and `/v1/staff/variants/:id`, only Super Users delete one, and every change, a new price included, is audited after a row lock on the pack. A deleted product takes its packs along, and its audit entry keeps them. The shop shows a product's packs on sale by SKU, and each card the lowest price on sale (ADR 0022). |
| Product images | Up to 6 photos per product, and at least 1 before it goes live, checked after a row lock on the product and again by database triggers. Admins and Super Users upload, describe, move and delete them at `/v1/staff/products/:productId/images` and `/v1/staff/images/:id`; deleting is not for Super Users only. An upload is the image itself (JPEG, PNG or WebP, up to 10 MB, with its own rate limit). Its first bytes must match its type, its size is read from the header (at most 50 megapixels, at least 400 pixels a side), and only its pixels are kept: two WebP files, at most 1600 and 400 pixels, upright, without metadata, made with sharp (at most 2 at once). The files are saved before the row and deleted after it, so no image ever lacks its files. Every change is audited, and a deleted product's entry keeps its images. The shop shows each card's main photo and each page's images by the addresses of their files (ADR 0023). |
| Inventory | One warehouse. Each pack size's stock is kept in batches, with the batch number and the dates on the label. A batch sells only with at least 6 months left before it expires, counted in India's date. Admins and Super Users receive batches, correct their labels and change their stock with movements (received, damaged, expired, correction) at `/v1/staff/variants/:variantId/batches` and `/v1/staff/batches/:id`. A movement locks its batch, never takes it below 0 (`409`), and a correction says why. Nothing in stock is deleted, and a pack size or product that still holds stock cannot be deleted (`409`). Every change is audited. The shop shows only whether each pack is in stock, never a count, through `StockService.inStock()` (`src/inventory`, ADR 0024). Orders take stock and give it back with movements of their own, `ORDERED` and `RELEASED` (ADR 0026). |
| Cart | Signed-in customers keep a cart at `/v1/me/cart`: `GET` it, `PUT /items/:sku` with how many packs, `DELETE /items/:sku`, and `DELETE` to empty it. A pack size is named by its SKU. At most 4 packs of one product, all its pack sizes together, and 50 pack sizes, checked after a lock on the cart and again by the database. Only a pack size sold now goes in, and adding needs stock; fewer packs are always fine. The cart keeps no prices and holds no stock: each look shows today's prices and whether each line can be bought, and only those lines count in the totals. It asks the catalog about pack sizes (`ShopPacksService`) and the inventory about stock. Customers' own changes are not audited (`src/cart`, ADR 0025). |
| Checkout and orders | `GET /v1/me/checkout` shows what the cart would cost as an order: today's prices, the GST inside them, and delivery (₹49 below ₹499, free from ₹499), all in whole rupees. `POST /v1/me/orders` places an order from the whole cart, to one of the customer's addresses, with an `Idempotency-Key` and the total the customer saw. In one transaction, after a lock on the cart, it checks that every line can be bought and the total is unchanged, saves a copy of the lines and the address, takes the stock from the sellable batches that expire first (locked in the order of their IDs), and empties the cart. The order holds its stock for 15 minutes. The customer lists, reads and cancels their own orders at `/v1/me/orders`, and a cancel gives the stock back at once. An expiry job inside the API (`OrderExpiryScheduler`) expires unpaid orders every minute and gives their stock back. At most 3 orders wait for payment per customer, and 30 orders per hour per IP. Paying comes in part 8 (`src/orders`, ADR 0026). |
| Media files | `MediaStorage` (`src/media`) saves and deletes files under names the API makes, and gives their addresses. On a laptop they live in `MEDIA_DIR` and the API serves them at `/media`: files only, cached for a year, and other sites may show them. Object storage behind a CDN replaces it before production (ADR 0023). |
| Data retention | An hourly job inside the API (`RetentionScheduler`) deletes ended sessions after 30 days, used refresh tokens after 7 days, expired verification, reset and Admin invitation links, customer sign-ups still unverified after 7 days, and carts nobody changed for 90 days. It logs counts only (ADR 0011). |
| Audit log | The append-only `audit_log` table: database triggers refuse `UPDATE`, `DELETE` and `TRUNCATE`. `AuditService.record(tx, entry)` writes in the same transaction as the change and redacts secret-looking fields (ADR 0012). Entries made through the API carry the checked actor, the client IP and the request ID, from `@CurrentAuditContext()` (ADR 0015). Super Users read it at `GET /v1/staff/audit-log`: newest first, paged by cursor, with filters and the accounts named (`AuditReaderService`, ADR 0017). |
| Super Users | Created only with `pnpm api:create-super-user`, a standalone Nest context without HTTP. At most 3, enforced by the app and a database trigger. Each creation is audited (ADR 0012). |
| Staff MFA | TOTP from authenticator apps (our own implementation, proven against the RFC test vectors), with no code accepted twice. Secrets are encrypted with `SecretBox` (AES-256-GCM, bound to the user). Set up only with `pnpm api:setup-staff-mfa`, which saves after a valid code, ends the person's sessions and is audited (ADR 0013). |
| Staff sign-in | `POST /v1/staff/auth/login` takes the password and a code together and gives one `401` for every failure. Staff tokens carry the audience `staff`, and staff sessions last 12 hours. Refresh and logout at `/v1/staff/auth/*`, and `GET /v1/staff/me` for the own account (ADR 0014). Every successful sign-in writes `staff.signed_in` to the audit log, in the same transaction as its session (ADR 0017). |
| Admin invitations | A Super User invites an Admin with `POST /v1/staff/admins`. That creates the account with a password nobody knows and emails a 72-hour, single-use link. The Admin chooses their own password at `POST /v1/staff/auth/accept-invite`, and a developer then sets up their MFA. Both steps are audited (ADR 0015). |
| Managing Admins | Super Users list Admins (`GET /v1/staff/admins`), disable and enable them (`PATCH /v1/staff/admins/:id`, which ends the sessions on disabling), remove a disabled or pending one (`DELETE`), and send a pending one a new invitation (`POST /v1/staff/admins/:id/invitation`). Every change is audited in the same transaction (ADR 0016). |
| Access control | A global deny-by-default guard. Each request needs a valid access token and a live session, unless its handler is `@Public()`. Each protected route has one audience: routes marked `@StaffOnly()` take staff tokens, every other route customer tokens. The caller's current role comes from the database with the session. A global roles guard then refuses Admins on routes marked `@SuperUserOnly()` (`403`, ADR 0015). `GET /v1/me` and `GET /v1/staff/me` return the caller's own account. |
| Email | Sent through SMTP behind a swappable mail service. Mailpit catches all mail in development. TLS is required in production. |
| Logging | Structured JSON logs with a request ID on every request (ADR 0006). No emails, passwords, codes or tokens in logs. |
| Errors | One consistent error format that includes the request ID, plus a `code` field where clients must react to a specific case, and `Retry-After` on `429` and `503` (ADR 0006, `docs/api-specification.md`) |
| Tests | Unit tests for every module (632 tests in 79 suites), a type check of all code including the tests (`pnpm api:typecheck`), and an end-to-end smoke test against the running API (`pnpm api:smoke`, 81 checks, including the rate limits, password recovery, a customer changing their name and password and signing out everywhere, delivery addresses with a double tap and a second customer who gets `404`, the public category list and shop pages with their prices, images and stock, every image file served as WebP, a customer's cart that a second customer never sees, an order placed, placed again with the same key and cancelled, which a second customer can't see, that customers cannot use the staff routes, invite or manage Admins, read the audit log, manage categories, products, pack sizes and images, or see or change stock, and that a made-up invitation link fails). The staff login, inviting and managing Admins, reading the audit log, managing categories, products, pack sizes and images, and stock are tested by hand with a phone, and so are a cart and orders with real stock (README). |

Not built yet: changing the email address, search, payments, GST invoices, admin console, customer app and website, notifications, support tickets, CI/CD.

## 3. Roles

Three roles: Customer, Admin, Super User (ADR 0004). Customers self-register. Admins are invited only by a Super User and choose their own password (ADR 0015). Only a Super User disables, enables or removes them (ADR 0016). Super Users (maximum three) are created by developers with `pnpm api:create-super-user`, never through the application (ADR 0012).

Customers sign in at `/v1/auth/login`. Staff (Admins and Super Users) sign in at `/v1/staff/auth/login`, with the password and a code from their authenticator app together, once a developer has set up their MFA (`pnpm api:setup-staff-mfa`, ADR 0013). Staff tokens have their own audience and open only staff routes (ADR 0014). Staff routes come in two levels: `@StaffOnly()` for both staff roles, and `@SuperUserOnly()` for Super Users only, such as inviting Admins (ADR 0015) or deleting a category (ADR 0020).

## 4. Request flows

### 4.1 Health check

1. A request arrives. A request ID is taken from a valid `X-Request-Id` header or generated, and returned in the response header.
2. The rate-limit guard counts it against the per-IP baseline. The access-token guard lets it through, because both health handlers are `@Public()`.
3. The controller calls the health service, which runs `SELECT 1` through Prisma and a `PING` against Valkey, each with a 2-second limit.
4. The response is `200` or `503`. Errors use the common error format. Every log line carries the request ID.

### 4.2 Authenticated request (example: `GET /v1/me`)

1. helmet adds the security headers. Only a JSON body would be parsed (on the image upload route, also an image, if the token is a valid staff token).
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
   A **password change while signed in** does the same, after checking the current password (ADR 0018). **Signing out everywhere** (`DELETE /v1/me/sessions`) ends every session without changing the password.
5. **Staff sign-in** works the same way, with these differences (ADR 0014):
   - the request also carries the code from the authenticator app, which is checked only after the right password and is used up;
   - every failure, a disabled account included, gets the same `401`;
   - the session lasts 12 hours;
   - refresh and logout use `/v1/staff/auth/*`, and a refresh token from the other sign-in path is refused without touching its session;
   - the session and its `staff.signed_in` audit entry are saved in one transaction (ADR 0017). Failed sign-ins are not audited.

### 4.4 Becoming an Admin (ADR 0015)

1. **Invite.** A Super User sends `POST /v1/staff/admins` with the email and name. One transaction creates the Admin (with a random password nobody knows), the invitation (only the token's hash, 72 hours) and the `admin.invited` audit entry. The email with the link goes out after the commit. If it fails, the answer says `invitationSent: false`, and the Super User can invite again (section 4.5).
2. **Accept.** The Admin opens the link, and the admin console (later) posts the token with the chosen password to `POST /v1/staff/auth/accept-invite`. The invitation is claimed atomically. The same transaction sets the password, marks the email verified, ends any sessions and writes `admin.invite_accepted`. Every refused link gets the same `400`.
3. **MFA.** A developer runs `pnpm api:setup-staff-mfa` for the Admin (ADR 0013).
4. **Sign in** as staff (section 4.3). An Admin can use `@StaffOnly()` routes, and gets `403` on `@SuperUserOnly()` ones.

### 4.5 An Admin's life cycle (ADR 0016)

| State | Can sign in | A Super User can |
|---|---|---|
| **Pending:** invited, not accepted yet | No | Invite again (every older link stops working), disable, remove |
| **Active:** accepted the invitation | Yes, once MFA is set up | Disable. Removing needs a disabled Admin (`409` otherwise). |
| **Disabled:** pending or accepted | No | Enable, remove |

- **Disabling ends every session at once,** and enabling does not bring them back.
- **Each change is one transaction:** the conditional write, any sessions or invitations it touches, and the audit entry. A request for the state an Admin already has changes nothing and writes no entry.
- **Removing deletes the account** with its sessions and invitations. The audit entry `admin.removed` keeps who it was.

### 4.6 Placing an order (ADR 0026)

1. **The app shows the checkout** (`GET /v1/me/checkout`): the cart's lines at today's prices, the GST inside them, delivery and the total.
2. **The customer taps "Place order".** The app makes a new UUID, and sends `POST /v1/me/orders` with it as the `Idempotency-Key`, the address and the total it showed. A retry sends the same key.
3. **The API checks the address** is the customer's own (`404` otherwise). Then, in one transaction:
   1. it locks the cart, so a double tap takes turns;
   2. a key it has seen answers the order placed with it, and nothing more happens;
   3. with 3 orders already waiting for payment, it answers `409`;
   4. it prices the lines. Every line must be available, and the total must be the one the customer saw (`409` otherwise);
   5. it saves the order, `PENDING_PAYMENT`, with a copy of the lines and the address, holding its stock for 15 minutes;
   6. it locks the batches in the order of their IDs, and takes the packs from those that expire first (`409` if a pack size runs short);
   7. it empties the cart.
4. **Within 15 minutes,** the customer pays (part 8) or cancels, and a cancel gives the stock back at once. Otherwise the expiry job marks the order `EXPIRED` within about a minute, and gives its stock back. A cancel and an expiry change the status only while it is `PENDING_PAYMENT`, so they never both happen.

## 5. Conventions

- API: REST with OpenAPI documentation (ADR 0002). Business endpoints live under `/v1`. The documentation tooling will be added later.
- Database: forward-only migrations committed to Git (ADR 0003).
- Secrets: only in the untracked `.env` locally; `.env.example` holds placeholders.
- Module layout: one folder per module under `apps/api/src` (today `addresses`, `audit`, `auth`, `cart`, `catalog`, `cli`, `config`, `health`, `inventory`, `logging`, `mail`, `media`, `orders`, `prisma`, `rate-limit`, `retention`, `staff`, `valkey`, `common`), each with its controller, services and unit tests next to the code. `cli` holds developer commands, which run in their own Nest context without HTTP.
- New endpoints are protected by default. Mark a handler `@Public()` only on purpose, and never a whole controller.
- Staff endpoints live under `/v1/staff`, in controllers marked `@StaffOnly()` or `@SuperUserOnly()` as a whole, so a route added later cannot be missed. Every other protected endpoint is for customers.
  - Staff accounts and sign-in are in `src/staff`.
  - A feature's staff routes live in the feature's own module, in a controller named `Staff…Controller`, for example `src/catalog/staff-categories.controller.ts` (ADR 0020).
  - Every staff controller is listed in `staff/staff-routes.spec.ts`.
  - A single handler of a `@StaffOnly()` controller may be narrowed further with `@SuperUserOnly()`, such as deleting a category. The route test then names that handler. A deliberate exception gets its own test too: deleting an image is for Admins as well (ADR 0023).
- A change to staff data writes its audit entry in the same transaction, with the actor, IP and request ID from `@CurrentAuditContext()`.
- A rule about a record's state, such as "a live product has its licence", is checked on the record **as it will be saved**: the stored values plus the change, inside the transaction, after a row lock. Where the database can say it, a constraint enforces it too, as the last line of defence (ADR 0021). A rule across rows, such as "at most 6 images", needs a trigger instead (ADR 0023).
- **Lock in the same order everywhere:** for a product's images, always the product first, then the image, so two requests can never wait for each other forever (ADR 0023). Many rows of one table are locked in the order of their IDs, as an order does with its batches (ADR 0026).
- **Files and rows:** save a file before its row, and delete it only after the row's deletion is saved. A failed file deletion is logged, never thrown, so the worst case is a stray file, never a row whose file is missing (ADR 0023).
- A body other than JSON is parsed on its own route only, and only once the caller is known when it can be large, such as the image upload (ADR 0008, ADR 0023).
- **Money is whole rupees,** stored as whole numbers, never floating-point ones, and each field's name says its unit (`priceRupees`, `totalRupees`). Orders too, by the owner's choice: the GST inside a price is rounded to the nearest rupee, and only the payment gateway will see paise (ADR 0022, ADR 0026). Ask the owner before adding another unit.
- **The server prices everything.** A client's total is only compared with the server's, so a changed price is never charged unseen (ADR 0026).
- **An `Idempotency-Key` for whatever must happen only once,** such as placing an order. The same key answers what it did the first time, so a retry or a double tap does no harm (ADR 0026).
- **A status guard instead of a lock:** a change of status names the status it expects (`updateMany` with `where: { id, status }`), so a cancel and an expiry at the same moment never both happen (ADR 0026).
- **A ledger and its balance:** where history matters, such as stock, every change is a row that is never changed or deleted, and the database applies it to the balance in the same transaction. A mistake is put right by another row (ADR 0024).
- **Dates and "today":** dates without a time are `DATE` columns, written `2028-09-30` in the API, and "today" is India's date, worked out from a given moment so tests can pin it (ADR 0024).
- **Modules ask each other, not each other's tables:** the catalog asks the inventory which packs are in stock (`StockService.inStock()`), so stock could move to its own service later (ADR 0001, ADR 0024). The cart asks the catalog about pack sizes (`ShopPacksService`), and the catalog decides what "sold now" means (ADR 0025). Orders ask the addresses, the cart, the catalog and the inventory, which takes and gives back the stock (ADR 0026).
- **A customer's own things are always looked up with the customer from the token:** an address or an order by its ID and its owner together, so another customer's answers `404` (ADR 0019, ADR 0026), and the cart by the customer alone, so it needs no ID at all (ADR 0025).
- **A repeatable `PUT` for counts:** setting how many packs the cart holds, rather than adding to it, makes a retried request on a poor mobile connection harmless (ADR 0025).
- New endpoints get the per-IP baseline automatically. Add `@RateLimit()` to endpoints that are expensive or attractive to abuse, and add each new limit to `rate-limits.ts`.

## 6. Planned direction

See `docs/requirements.md` for scope and open decisions. Identity and access for staff is complete with part 3B-6 (ADR 0012 to ADR 0017). For customers, part 3C-1 added the name, password and sessions (ADR 0018), and part 3C-2 delivery addresses (ADR 0019). What is still open is listed in `docs/security.md`. The product catalog was built in part 4: categories in 4A (ADR 0020), products in 4B (ADR 0021), pack sizes and prices in 4C (ADR 0022) and product images in 4D (ADR 0023), assuming one national catalog (open decision 5 in `docs/requirements.md`). Before production, image files move to object storage behind a CDN. Part 5 added stock in batches, in one warehouse (ADR 0024), part 6 the customer's cart, which holds no stock (ADR 0025), and part 7 checkout and orders, which fix the price, hold the stock for 15 minutes and add delivery charges, delivering to all of India (ADR 0026). Next come payments through a gateway (part 8), online only at launch, then GST invoices and the admin console. Scaling work (caching, queues, search, replicas) is introduced only when measurements justify it.
