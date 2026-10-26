# 0009. Rate limiting and brute-force protection

- Status: Accepted and implemented (part 3D)
- Date: 2026-10-26
- Updated: 2026-10-26 (part 3A-4 added the password recovery limits, ADR 0010)

## Context

ADR 0007 left two gaps that kept the API on `127.0.0.1`: there was no rate limiting or brute-force protection, and a burst of logins could use up Node's worker threads, because each password hash runs argon2 on them.

Most customers will use Indian mobile networks. Carrier-grade NAT (CGNAT) puts thousands of people behind one public IP there. Per-IP limits alone would therefore either block real customers or be too loose to stop anyone. Limits per account have to do the precise work.

## Decision

### Library and storage

- **`rate-limiter-flexible` 11.2.3**, pinned exactly. It is ISC-licensed and has no dependencies. Counters live in Valkey, on the shared `ValkeyService` connection, and each count is one atomic script.
- **If Valkey is unreachable**, every limit falls back to an in-memory counter in the API process (an "insurance limiter"), and `ValkeyService` logs the outage once. Protection never switches off, and a Valkey outage does not lock customers out.
- **No personal data in Valkey.** Keys look like `rl:<limit>:<hash>`. The hash is an HMAC-SHA256 of the email or IP. Its key is derived from `JWT_ACCESS_SECRET` with HKDF, so the JWT secret itself is never used for a second job.
- **All limits are in one file:** `apps/api/src/rate-limit/rate-limits.ts`.

### Client IP

- The client IP is Express's `req.ip`.
- **`TRUST_PROXY`** lists the proxies whose `X-Forwarded-For` header is believed: addresses, subnets, or `loopback`, `linklocal`, `uniquelocal`. It is empty by default. Hop counts and `true` are refused at startup, because they would let a client that bypasses the proxy fake its IP.
- IPv4 addresses written as IPv6 (`::ffff:1.2.3.4`) are unwrapped. IPv6 is counted per `/64` block, because one subscriber usually owns a whole block.

### Where the limits apply

1. **On every route, per IP.** A global `RateLimitGuard` runs before the access-token guard. It counts the request against the baseline and against the route's own limit, which is declared with `@RateLimit()`. Floods are refused before any token or database work.
2. **Login, per account.** Three failure counters: email + IP, email, and IP.
   - All three are **checked first**. If any is blocked, the answer is 429 before the database lookup and before argon2.
   - **Every failure is counted**: unknown email, wrong password, unverified email. Unknown emails count exactly like real ones, so a 429 never reveals whether an account exists.
   - The failure that **goes over** a limit answers 429 instead of 401, and starts the block.
   - A successful login **resets only the email + IP counter**, so an attacker's own login cannot wipe the per-email or per-IP counts.
3. **Emails to one address.** Register (a verification link or an "account exists" notice), resend and forgot-password (since part 3A-4) all count against `emailsToAddress`. They count before any work, and for every address, known or not.
4. **Password hashing.** At most 2 argon2 operations run at once and 50 more wait their turn. Beyond that the answer is 503.

### Limits

| Limit | Counted per | Allowed | When exceeded |
|---|---|---|---|
| `baseline` | IP | 600 requests per minute, on every route | 429 until the minute ends |
| `register` | IP | 20 per hour | 429 |
| `verifyEmail` | IP | 60 per hour | 429 |
| `resendByIp` | IP | 20 per hour | 429 |
| `forgotPassword` | IP | 20 per hour | 429 |
| `resetPassword` | IP | 20 per hour | 429 |
| `emailsToAddress` | email address | 5 emails per hour (register, resend and forgot-password together) | 429 |
| `login` | IP | 60 attempts per minute | 429 |
| `refresh`, `logout` | IP | 120 per minute | 429 |
| `loginFailuresByEmailAndIp` | email + IP | 5 failures per hour | blocked for 15 minutes; a successful login resets it |
| `loginFailuresByEmail` | email | 50 failures per hour | blocked for 1 hour |
| `loginFailuresByIp` | IP | 200 failures per hour | blocked for 1 hour |

These are starting values, to be tuned with real traffic.

### Answers

- **`429 Too Many Requests`** with `Retry-After` (in seconds) and `"code": "RATE_LIMITED"`.
- **`503 Service Unavailable`** with `Retry-After: 5` and `"code": "SERVER_BUSY"` when the hashing line is full.
- Both come from one exception type (`RetryLaterException`), which the error filter turns into the header.

### Development

`pnpm api:limits:clear` deletes every `rl:*` key in the local Valkey, and refuses unless `NODE_ENV=development`. `pnpm api:smoke` runs it first, so the smoke test can run again at once.

## Alternatives considered

- **`@nestjs/throttler`.** Rejected. It counts requests only, so it cannot count failed logins per account, and storing its counters in Valkey needs a third-party package.
- **Writing our own counters.** Rejected. Atomic counting, block windows and the in-memory fallback are easy to get subtly wrong.
- **Refusing all sign-ins (503) while Valkey is down.** Rejected. It is stricter, but it would make Valkey a single point of failure for every customer.
- **A hard account lockout until someone unlocks it.** Rejected. It would let anyone lock any customer out indefinitely. A block that expires on its own limits that harm.
- **CAPTCHA.** Not now. It needs a third-party service and hurts usability. It can be added in front of login if real attacks appear.
- **Trusting `X-Forwarded-For` by hop count.** Rejected for the reason above.

## Consequences

- Each request costs one or two extra Valkey round trips, and a login up to six more (three checks, then three counts or one reset). Locally that is well under a millisecond each.
- **Someone can block a real customer's login for up to an hour** with 50 wrong passwords sent from many IPs. That is the price of the per-email limit; OWASP ASVS allows at most 100 failed attempts per hour per account. Since part 3A-4 the owner has a way out: a password reset works during a block and lifts it (ADR 0010).
- Customers behind the same CGNAT IP share the per-IP limits. The numbers must be watched (429s appear in the request logs) and tuned.
- The in-memory fallback is per process. With several API instances, a Valkey outage makes the limits looser, per instance.
- Replacing `JWT_ACCESS_SECRET` resets all counters, because the keys are derived from it.
- Clients must handle 429 and 503 by waiting `Retry-After` seconds, never by retrying at once.
- Before the API goes behind a reverse proxy or load balancer, that proxy must be listed in `TRUST_PROXY`. Otherwise every customer would share the proxy's IP.
