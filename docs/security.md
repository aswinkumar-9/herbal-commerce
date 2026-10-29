# Security

Status: **living document.** Last reviewed on 2026-10-29, at the end of part 3B-2 (staff MFA setup).

Security reference: OWASP ASVS 5.0, Level 2 (`docs/requirements.md`). The decisions behind this page are in ADR 0007 (customer authentication), ADR 0008 (security baseline), ADR 0009 (rate limiting), ADR 0010 (password recovery), ADR 0011 (data retention), ADR 0012 (Super Users and the audit log) and ADR 0013 (staff MFA). This page records the status of each control and the rules for features that do not exist yet.

## 1. Threat model in short

| | |
|---|---|
| What we protect | Customer accounts and personal data (today: name, email, password hash; later: phone, addresses, orders, invoices), staff accounts, prices and stock, payment status |
| Who might attack | Anonymous internet users (password guessing, account enumeration, bots, overload), a customer trying to read another customer's data, someone holding a stolen token or phone, a compromised dependency, and our own mistakes (secrets in Git, development settings in production) |
| Exposure today | The API listens on `127.0.0.1` only and has no real users. The gaps in section 6 must be closed before that changes. |

## 2. Secure-by-design principles

| Principle | How it shows up |
|---|---|
| Deny by default | One global guard protects every endpoint. Only handlers marked `@Public()` are open. |
| Never trust the client | The server sets roles and, later, prices. The user ID comes from the token, never from the request. |
| Least privilege | Admin and Super User are separate roles. Super Users can only be created by a developer command, at most 3. The database gets a data-only runtime role before production. |
| Defense in depth | Refresh tokens are stored hashed and rotate on every use, and reusing one revokes the session. The session is also checked on every request. |
| Fail closed | The API refuses to start with invalid, missing or (in production) placeholder configuration. |
| Small attack surface | The API accepts JSON only and stays on localhost until it is deployed behind HTTPS. |
| Refuse cheaply | Rate limits run before any token check, database query or password hash, so a flood costs us as little as possible. |
| Privacy by design | No emails, passwords or tokens in logs, and only the data we need is stored. |

## 3. Status legend

| Status | Meaning |
|---|---|
| **Done** | In place today |
| **Partly** | In place, with named follow-ups |
| **Gap** | Missing today, and must be closed before the API leaves localhost (section 6) |
| **Later** | Added along with the feature it protects (the part is named) |
| **Not applicable yet** | The feature does not exist yet. The rule for it is recorded here. |
| **Decision** | Deliberately not done, with the reason |

## 4. Control-by-control status

### 4.1 Input and injection

| Control | Status | Today | Rule or next action |
|---|---|---|---|
| SQL injection | Done | All queries go through Prisma, which sends values as parameters. The only raw SQL is a constant `SELECT 1` in `health/health.service.ts`. zod checks every request body, so no objects can be smuggled into queries. | Never use `$queryRawUnsafe`. Allowlist sort and filter fields. Check that IDs are valid UUIDs before querying (an invalid one would cause a 500). |
| XSS | Done (API) | Responses are JSON only, and helmet sends `nosniff` and a Content Security Policy. Emails escape the user's name and the link (`mail/mail.service.ts`). | Website and admin console: a Content Security Policy, no raw HTML for product text, no SVG uploads. |
| CSRF | Done (API) | Tokens travel in the `Authorization` header, which a browser never sends on its own. The API accepts JSON bodies only, so an HTML form on another website cannot call it (ADR 0008). | Website: keep the refresh token in a cookie with `HttpOnly; Secure; SameSite=Strict; Path=/v1/auth`, and add an `Origin` check or a CSRF token on the cookie endpoints. |
| File upload validation | Later (catalog) | No uploads. `multer` comes with Nest but is unused (its advisory is in section 5). | Size and count limits, check the real file type (magic bytes), re-encode images, random file names, private storage, no SVG. |
| SSRF | Not applicable yet | Nothing fetches a URL taken from user input. Email links use `WEB_BASE_URL` from the environment, never the request's `Host` header. | Payments and courier: call fixed hosts only. If a user-supplied URL ever has to be fetched: allowlist the hosts, block private IP ranges, disallow redirects, set timeouts. |

### 4.2 Authentication and authorization

| Control | Status | Today | Rule or next action |
|---|---|---|---|
| BOLA (broken object level authorization) | Done for what exists | `GET /v1/me` takes the user ID from the token, never from the request. No endpoint fetches an object by ID yet. | Orders, addresses, invoices: always query `where: { id, userId: currentUser.id }`, and answer 404 for other users' objects. One test per endpoint shows that user B cannot read user A's data. |
| Rate limiting and brute-force protection | Done (part 3D) | A global guard limits every route per IP (a 600 per minute baseline) and each sign-up and sign-in endpoint further. Login has three failure counters (email + IP, email, IP) that block for 15 to 60 minutes, are checked before any password work, and count unknown emails too. Counters live in Valkey with an in-memory fallback, keyed by HMAC so Valkey holds no emails or IPs. The client IP comes from `req.ip`, and only proxies listed in `TRUST_PROXY` may report it (ADR 0009). | Tune the numbers with real traffic (429s are in the request logs). List the proxy in `TRUST_PROXY` when one exists. CAPTCHA in front of login only if real attacks appear. |
| Secure password storage | Done | argon2id with the OWASP minimum settings (19 MiB, 2 passes, 1 lane), 10 to 128 characters, no forced character rules (`auth/password.service.ts`). | Later: a breached-password check, a decision on Unicode normalization before real users, and rehashing when the hash settings change. |
| Account enumeration | Done | Registration, resend and forgot-password always give the same answer. Forgot-password does its lookup and sends its email after the response, so it is equally fast for every address. Login gives the same 401 for an unknown email, a wrong password and an unverified email, and runs a dummy hash for unknown emails. Response times are similar, not identical. The rate limits count unknown emails exactly like real ones, so a 429 reveals nothing either. | Every new endpoint that takes an email must follow the same rule. |
| Session management | Done | Each login creates a 30-day session. Access tokens last 15 minutes. Refresh tokens rotate on every use, and reusing one revokes the session. Logout revokes the session. A password reset revokes every session of the account. The session is checked on every request, so all of this takes effect at once. Ended sessions are deleted after 30 days (ADR 0007, ADR 0010, ADR 0011). | Later: "sign out everywhere" and a list of active sessions. |
| Password recovery | Done (part 3A-4) | Reset links are 32 random bytes, stored only as a SHA-256 hash in their own table, valid for 30 minutes and once. They go only to active customers. The link is checked before any hashing, and every refused link gets the same 400. A reset sets the new password, marks the email verified, ends every session, lifts the login blocks for the owner and sends a "password changed" notice without a link (ADR 0010). | Staff reset (staff part). The website must post the token from the URL straight away and keep it out of its logs. |
| MFA | Partly (part 3B-2) | Staff MFA setup is done (ADR 0013):<br>• TOTP from authenticator apps, our own implementation proven against the RFC test vectors;<br>• ±30 seconds of clock drift allowed;<br>• no code works twice (atomic);<br>• secrets encrypted with AES-256-GCM, bound to the user, under a separate `MFA_ENCRYPTION_KEY`;<br>• set up only with `pnpm api:setup-staff-mfa`, which saves only after a valid code, ends all sessions and is audited. | Part 3B-3: a staff login that asks for the password and a code together. Later: recovery codes (hashed), passkeys and a QR code in the admin console. Customers: password only for now (the owner's choice); optional MFA later. |
| Server-side permission enforcement | Done (customers) | The server sets the role at registration, and zod drops unknown fields such as `role`. A global deny-by-default guard checks the token and the session on every request. Only active Customers pass. | Staff: a separate token audience with MFA (part 3B-2), then a roles guard (part 3B-3). The append-only audit log exists since part 3B-1. |
| Row-level security (RLS) | Decision: not now | The app connects as the database user that Docker creates, which is a superuser and bypasses RLS anyway. | Before production: separate database roles for migrations and for the running app (data access only, no schema changes). Ownership checks in the app stay the main control. RLS is optional later for orders, addresses and invoices. |

### 4.3 Secrets and tokens

| Control | Status | Today | Rule or next action |
|---|---|---|---|
| JWT secret management | Done | Only in `.env`, never printed. At least 43 base64url characters, not repetitive, and the `.env.example` placeholder is refused, which a test checks (`config/env.ts`). Tokens are signed and checked with HS256 only, with issuer, audience and a maximum age of 15 minutes. `MFA_ENCRYPTION_KEY` follows the same rules and must differ from the JWT secret (ADR 0013). | Production: a secret manager, one secret per environment. To rotate the JWT secret: replace it and restart; clients simply refresh. **Never lose or change `MFA_ENCRYPTION_KEY` casually:** without it no MFA secret opens, and all staff must set up MFA again. |
| Refresh and verification tokens | Done | 32 random bytes each, stored only as SHA-256 hashes, single use, claimed atomically. Deleted once no longer needed: used refresh tokens after 7 days, verification links once expired (ADR 0011). | None. |
| Server-side API key storage | Not applicable yet | No third-party keys yet. Logs already hide the `x-api-key` header. | Payment, SMS and courier secrets stay on the server (environment or secret manager). The apps get only publishable IDs. Keys we issue to others are stored hashed. |
| Secure local storage usage | Not applicable yet (clients) | No clients yet. | Mobile: refresh token in Keychain (iOS) or Keystore (Android) through a secure-storage library, access token in memory only, email links opened through verified App Links / Universal Links. Web: never put tokens in `localStorage` or `sessionStorage`. The refresh token goes in an HttpOnly cookie, and the access token stays in memory. |
| No default credentials | Done (API) | In production the API refuses any database, Valkey, JWT or MFA setting that still contains `change_me`, and a `WEB_BASE_URL` that is not `https://` (ADR 0008). Local containers listen on `127.0.0.1` only. The Super User command requires a password of at least 16 characters, typed hidden (ADR 0012). | Admin accounts (part 3B-3): the same 16-character rule. |

### 4.4 Security configuration

| Control | Status | Today | Rule or next action |
|---|---|---|---|
| Security headers | Done | helmet sets `nosniff`, framing protection, a Content Security Policy, `Referrer-Policy` and HSTS, and removes `X-Powered-By` (ADR 0008). | HSTS only takes effect over HTTPS (before production). |
| Request bodies | Done | JSON only, at most 100 kB, compressed bodies refused (ADR 0008). | Webhooks and uploads add their own parser on their route only. |
| CORS hardening | Done (secure default) | Off: no CORS headers, so browsers block other websites from reading API responses. | Website part: an allowlist of origins from the environment. Allow credentials only when cookies are used. Never `*`. |
| Webhook signature verification | Not applicable yet | No webhooks yet. | Payments part: verify the HMAC over the raw body with a constant-time comparison, reject old timestamps, handle each event ID only once, and confirm the payment status with the gateway instead of trusting the webhook body. |
| Source map protection | Done (API) | `apps/api/dist` contains `.map` files, but the API never serves `dist` over HTTP. | Website and admin console: no public source maps in production builds; upload them only to an error tracker. |
| Sensitive data protection | Partly | Logs hide `Authorization`, `Cookie`, `x-api-key` and `Set-Cookie`, and contain no request bodies (`logging/logger.config.ts`). 500 errors show a generic message. Queries select only the fields they need. Token responses and every authenticated response carry `Cache-Control: no-store`. The API takes tokens in headers and bodies, never in URLs. SMTP must use TLS in production. | The verification email links to the website with the token in the URL: the website must post it to the API at once and keep it out of its own logs and analytics. Logs still keep the full URL, the IP address and the user agent, which are personal data: set a log retention period. Before production: HTTPS, database TLS, and hide the `/health/ready` details from the public. |
| Dependency vulnerability management | Done | Unused `@nestjs/mau` removed, 3-day minimum release age, exact pins for `@nestjs/jwt`, `helmet` and `rate-limiter-flexible`, lockfile committed, build scripts need approval (ADR 0008). `pnpm audit` is clean since 25 October: `overrides` in `pnpm-workspace.yaml` patch `body-parser`, `multer` and `fast-uri` (section 5). | Keep `pnpm audit` clean before every pull request. Remove each override once its parent package ships the fix. Turn on Dependabot alerts on GitHub, if not done yet. |

### 4.5 Further controls for this stack

| Control | Status | Rule or next action |
|---|---|---|
| Security logging | Done (basic) | Every failed login and refresh is logged with a reason, never with the email. These are logged as warnings: a staff email on the customer login, a reused refresh token, a blocked account, and a login that goes over a failure limit. Refused reset links and completed resets are logged with a reason and the user ID. Super User creation is written to the audit log. Valkey outages are logged once. Later: alerts on those warnings. |
| Denial of service through password hashing | Done (part 3D) | At most 2 argon2 operations run at once and 50 wait in line. Beyond that the answer is `503 SERVER_BUSY` with `Retry-After`, so a burst cannot use up Node's 4 worker threads (ADR 0009). |
| Email flooding | Done (part 3D) | Register, resend and forgot-password send email to the address in the request, so all three count against one limit of 5 emails per hour per address, for known and unknown addresses alike. |
| Pre-account takeover | Done (parts 3A-4 and 3A-5) | Someone registers an email address that is not theirs and waits for the real owner to verify it. A password reset by the real owner sets their password, marks the address verified and ends every session (ADR 0010). A sign-up still unverified after 7 days is deleted, which frees the address (ADR 0011). |
| Business logic (orders, payments) | Later | The server calculates prices, tax and totals. Orders and payments carry idempotency keys, stock reservations expire, and coupons have limits. Add checks against cash-on-delivery abuse. |
| Audit log and Super User limit | Partly (part 3B-1) | Done for what exists (ADR 0012):<br>• `audit_log` is append-only: database triggers refuse `UPDATE`, `DELETE` and `TRUNCATE`;<br>• entries have no foreign keys, so they outlive what they describe;<br>• each entry is written in the same transaction as its change, with secret-looking fields redacted;<br>• Super User creation is audited;<br>• the limit of 3 Super Users is enforced by the app and by a database trigger with a lock.<br>Still to do: audit every Admin and Super User change (part 3B-3), and give the app a database role that may only insert and read audit entries (before production). |
| Supply chain beyond npm | Later (before production) | Pin Docker images by digest and add secret scanning in CI (for example gitleaks). The AI-skill files in `apps/api/.agents` give instructions to AI tools, so review changes to them like code. |
| Privacy (India's DPDP Act) | Partly (part 3A-5) | Retention periods for sessions, tokens and unverified accounts are enforced by an hourly job inside the API (ADR 0011). Still to do: a list of the personal data held, a log retention period, deletion on request, consent, and a breach plan. Data stays in India. |
| Backups and email | Later (before production) | Encrypted backups with a rehearsed restore. SPF, DKIM and DMARC on the sending domain. |

## 5. Dependency audit

| Date | `pnpm audit` | What changed |
|---|---|---|
| 2026-10-24 | 26 findings (8 high) | First review |
| 2026-10-24 | 6 findings (2 high) | `@nestjs/mau` removed |
| 2026-10-25 | No known vulnerabilities | `overrides` for the 3 packages below |
| 2026-10-26 | No known vulnerabilities | `rate-limiter-flexible` 11.2.3 added, which has no dependencies of its own |
| 2026-10-29 | 1 low, development only; `pnpm audit --prod`: none | A new advisory for `deepmerge`, which only Jest uses (see "Accepted findings" below) |

**Accepted findings.** Recorded here and in the pull request (ADR 0008), and checked again at every milestone:

| Package | Finding | Why it is accepted for now |
|---|---|---|
| `deepmerge` 4.3.1 | 1 low: prototype poisoning in `mergeObject()` ([GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)). No fixed version exists yet. | Only Jest's config loader uses it, through `ts-jest`, `jest` and `jest-config`, to merge our own test configuration. It never sees outside input and is not in the running API (`pnpm audit --prod` is clean). Patch it with an override as soon as a fix is published. |

Active overrides in `pnpm-workspace.yaml`. Remove each one once the package that pulls it in ships the fix itself, and check them at every upgrade of Nest or Express.

| Package | Was | Now | Advisory | Pulled in by |
|---|---|---|---|---|
| `body-parser` | 2.3.0 | 2.4.0 | 1 high: denial of service through a compressed request body ([GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828)). `inflate: false` already blocked it. | `express` 5.2.1, used by Nest |
| `multer` | 2.4.0 | 2.5.0 | 1 high: denial of service through file uploads ([GHSA-q7qp-rjg7-q26m](https://github.com/advisories/GHSA-q7qp-rjg7-q26m)). There are no upload endpoints yet. | `@nestjs/platform-express` 12.1.3, which pins exactly 2.4.0 |
| `fast-uri` | 3.1.8 | 3.1.9 | 4 (2 moderate, 2 low) | `ajv`, used by `@nestjs/cli` and `prisma` (development tools) |

The `body-parser` and `multer` fixes were published on 22 October 2026. The 3-day minimum release age allowed them from 25 October, 17:30 IST.

## 6. Must be done before the API leaves localhost

Rate limiting, brute-force protection and the hashing cap were on this list and were done in part 3D. Still open:

1. HTTPS everywhere, so HSTS takes effect, and TLS to the database.
2. The reverse proxy or load balancer listed in `TRUST_PROXY`. Without it, every customer would share the proxy's IP in the rate limits.
3. Separate database roles for migrations and for the running app. The app's role may only insert and read `audit_log`, so not even a compromised API can rewrite history or drop the triggers.
4. Secrets in a secret manager, one set per environment.
5. `/health/ready` details hidden from the public.
6. A log retention period. (The cleanup of expired sessions and tokens has run since part 3A-5.)
7. `pnpm audit` clean, Dependabot alerts on, secret scanning in CI, Docker images pinned by digest.
8. Encrypted backups with a rehearsed restore.

## 7. Keeping this page current

- Change a control's status in the same pull request that changes the control.
- Before every pull request, run `pnpm api:test`, `pnpm api:lint`, `pnpm api:build`, `pnpm audit` and `pnpm api:smoke`.
- Repeat the full review whenever a part adds attack surface: uploads, payments, the website, the mobile app, staff login.

## 8. Glossary

| Term | Meaning |
|---|---|
| ASVS | OWASP Application Security Verification Standard, the security checklist this project follows (Level 2). |
| argon2id | A slow, memory-hard password hashing algorithm recommended by OWASP. |
| BOLA | Broken object level authorization: reading or changing someone else's data by changing an ID in a request. |
| CGNAT | Carrier-grade NAT: a mobile or broadband provider puts many customers behind one public IP address. |
| CORS | Cross-origin resource sharing: the browser rules for which other websites may read the API's responses. |
| CSP | Content Security Policy: a header that tells the browser which scripts and resources a page may load. |
| CSRF | Cross-site request forgery: another website making the user's browser send a request that carries the user's cookies. |
| DPDP Act | India's Digital Personal Data Protection Act, 2023. |
| HKDF | A standard way to derive a separate key for one job from an existing secret. |
| HMAC | A signature made with a shared secret. Used to prove that a webhook really came from the payment gateway, and to hash rate-limit keys. |
| HSTS | A header that tells browsers to use HTTPS only. |
| JWT | JSON Web Token: the signed access token the app sends with each request. |
| MFA / TOTP | Multi-factor authentication. TOTP is the 6-digit code from an authenticator app. |
| RLS | Row-level security: PostgreSQL rules that limit which rows a database user can see. |
| SSRF | Server-side request forgery: tricking the server into fetching a URL the attacker chooses. |
| XSS | Cross-site scripting: getting the browser to run an attacker's script inside our website. |
