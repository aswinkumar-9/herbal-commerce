# 0007. Customer authentication

- Status: Accepted and implemented (registration and email verification first, then login, tokens and sessions in part 3A-3)
- Date: 2026-10-21
- Updated: 2026-10-25 (part 3A-3: login, tokens, sessions, endpoint protection)
- Updated: 2026-10-26 (part 3D closed known gaps 1 and 2, see ADR 0009)
- Updated: 2026-10-26 (part 3A-4 closed gap 5, see ADR 0010)
- Updated: 2026-10-27 (part 3A-5 closed gaps 4 and 7, see ADR 0011)
- Updated: 2026-10-30 (part 3B-3: staff routes with their own token audience, see ADR 0014)
- Updated: 2026-10-30 (part 3B-4: one more public staff endpoint, accepting an Admin invitation, see ADR 0015)

## Context

Customers must be able to register, verify their contact details and sign in. The handbook suggests phone OTP, which needs a paid SMS provider and DLT registration in India. The owner chose email and password first.

The mobile app and the website will use the same API. Tokens therefore travel in the `Authorization` header, which works without cookies. The website may later keep its refresh token in a cookie (see `docs/security.md`).

## Decision

### Registration and email verification

- **Sign-in method:** email + password, with email verification. Phone OTP can be added later behind the notification layer.
- **Password storage:** argon2id (`@node-rs/argon2`) with 19 MiB memory, 2 passes and 1 lane (OWASP minimum). The library needs no native build step, so it does not trigger pnpm's build-script approval.
- **Password rules:** 10 to 128 characters, no forced character classes. A common-password check will be added later.
- **Registration only creates Customers.** The role is set by the server and the request schema drops unknown fields, so a client can never choose a role.
- **No account enumeration.** Registration and "resend verification" return the same response whether or not the email exists. An existing address receives an "account already exists" notice instead of a second account. The password is hashed on both paths so response times are similar. Perfect timing equality is not claimed.
- **Verification tokens:** 32 random bytes (base64url), stored only as a SHA-256 hash, valid for 24 hours, single use. The claim is an atomic conditional update, so two simultaneous requests cannot both succeed.
- **Resend:** a new token is issued at most once per minute per account and replaces unused older tokens. Since part 3D, resend and register are also limited per IP, and to 5 emails per hour per address (ADR 0009).

### Login

- **Customers only.** Staff sign in through their own path with MFA (ADR 0004, ADR 0014). On the customer login, a staff email is treated like an unknown one.
- **Login requires a verified email.**
- **One answer for every failed login:** an unknown email, a wrong password and an unverified email all get `401 Invalid email or password`. Unknown and staff emails are checked against a dummy argon2 hash, so all cases take a similar time.
- **A disabled account** gets `403` with `"code": "ACCOUNT_DISABLED"`, but only after the correct password. Only the owner knows it, so this answer reveals nothing to anyone else.
- **Login checks only the password length** (1 to 128 characters), not the registration rules, so passwords made under older rules keep working.

### Tokens and sessions

- **Session:** each login creates one session. It lasts **30 days in total**, with no idle timeout. After that the customer signs in again.
- **Access token:** a JWT, signed with HS256 using `JWT_ACCESS_SECRET` from the environment, valid for 15 minutes. It carries only the user ID (`sub`) and the session ID (`sid`), with issuer `herbal-api` and audience `customer`. Verification pins the algorithm and checks the issuer, the audience, the expiry and a maximum age of 15 minutes. No email, name or role goes into the token, because anyone holding it can read it. Asymmetric keys are deferred until a second service must verify tokens.
- **Refresh token:** 32 random bytes (base64url), opaque (not a JWT), stored only as a SHA-256 hash. It has no expiry of its own and ends with its session.
- **Rotation:** every refresh returns a new token pair, and the old refresh token stops working. The claim is an atomic conditional update inside a transaction, so two simultaneous refreshes with the same token cannot both succeed.
- **Reuse detection:** when an already used refresh token comes back, someone has a copy of it. We cannot tell the thief from the owner, so the whole session is revoked. The session is also revoked when the user is no longer an active Customer.
- **One answer for every failed refresh:** `401 Invalid refresh token`. The reason goes to the log only.
- **Logout** takes the refresh token, revokes its session and always answers `204`, so it never reveals whether the token was valid. It needs no access token, because that may already have expired.

### Protecting endpoints

- **Deny by default.** A global guard protects every endpoint. Only handlers marked `@Public()` are open: the two health checks, the eight `/v1/auth` endpoints (sign-up, sign-in and password recovery) and, since part 3B-3, the three `/v1/staff/auth` sign-in endpoints, joined in part 3B-4 by `/v1/staff/auth/accept-invite` (ADR 0015). `@Public()` works on single handlers only, never on a whole controller, so a new handler is protected even in a controller with public ones.
- **Customer routes take customer tokens only.** Since part 3B-3, routes marked `@StaffOnly()` take staff tokens instead (audience `staff`, ADR 0014). Every other protected route stays customer-only, and a token for the other audience is refused like a forged one.
- **The session is checked on every request**, not only the token signature. The session must exist, belong to the user, be neither revoked nor expired, and the user must still be an active Customer. So logout, reuse detection and disabling an account take effect at once, not up to 15 minutes later.
- **The user ID comes from the token**, never from the URL or the body (`GET /v1/me`).
- **No caching:** token responses and every authenticated response carry `Cache-Control: no-store`.

### Logging

- Emails, passwords and tokens are never logged. Mail failures log only the error name and the user ID.
- Every failed login and refresh is logged with a reason and, when known, the user and session IDs. A staff email on the customer login, a reused refresh token and a blocked account are logged as warnings.

## Alternatives considered

- **A JWT as the refresh token.** Rejected. Rotation and revocation need a database row anyway, so a signature adds nothing. An opaque token is shorter and reveals nothing.
- **Trusting the access token alone until it expires.** Rejected. After logout or a detected theft, a stolen access token would keep working for up to 15 minutes.
- **An idle timeout** (for example, sign out after 7 days without use). Deferred. A fixed 30 days is simpler and predictable. An idle timeout can be added on the session row later.
- **Telling the customer that the email is not verified yet.** Rejected for now, because it reveals which emails are registered. The app can offer "resend the verification email" next to the login error instead.

## Consequences

- A customer whose verification email fails to send can request a new one.
- The "account exists" email tells the real owner about the attempt without revealing anything to the requester.
- **Clients must never refresh in parallel.** Two requests with the same refresh token count as reuse and end the session. The app must run one refresh at a time and share the result. If a refresh response is lost (for example, the network drops), the next refresh sends the old token and the customer has to sign in again. This is the accepted cost of reuse detection.
- **Reuse detection covers 7 days after a refresh token was used** (ADR 0011). After that, used tokens are deleted, so a stolen one that comes back later is simply unknown: still `401`, but the session is not ended.
- Every authenticated request costs one small database query for the session check. It can move to Valkey if measurements show a need.
- Replacing `JWT_ACCESS_SECRET` invalidates all access tokens at once. Clients simply refresh, because refresh tokens do not depend on the secret.

## Known gaps

The open gaps are acceptable only while the API listens on `127.0.0.1` and has no real users. They must be closed before the API is reachable from outside the laptop.

1. ~~**No rate limiting or brute-force protection.**~~ **Closed in part 3D (ADR 0009):**
   - every route is limited per IP;
   - login has three failure counters (email + IP, email, IP), checked before any password work;
   - register, resend and (since part 3A-4) forgot-password are limited to 5 emails per hour per address.
2. ~~**Denial of service through password hashing.**~~ **Closed in part 3D (ADR 0009):** at most 2 argon2 operations run at once and 50 wait. Beyond that the answer is `503 SERVER_BUSY`.
3. **The API stays on `127.0.0.1`** until it is deployed behind HTTPS, with its proxy listed in `TRUST_PROXY` (see the pre-production list in `docs/security.md`). To test on a phone, connect it over USB and run `adb reverse tcp:3000 tcp:3000`. Do not open the API on Wi-Fi.
4. ~~**Pre-account takeover.**~~ **Closed in parts 3A-4 and 3A-5 (ADR 0010, ADR 0011).** Someone could register an email address that is not theirs and wait for the owner to verify it. Now:
   - a password reset by the real owner sets their password, marks the address verified and ends every session;
   - a sign-up that is still unverified after 7 days is deleted, which frees the address.
5. ~~**No password reset yet.**~~ **Closed in part 3A-4 (ADR 0010):** `forgot-password` and `reset-password`. A reset revokes every session of the account.
6. **No breached-password check and no Unicode normalization of passwords yet.** Decide on normalization before there are real users.
7. ~~**Nothing is ever deleted.**~~ **Closed in part 3A-5 (ADR 0011):** an hourly job deletes:
   - ended sessions after 30 days;
   - used refresh tokens after 7 days;
   - expired verification and reset links;
   - unverified sign-ups after 7 days.

   A retention period for logs is still open (`docs/security.md`).
