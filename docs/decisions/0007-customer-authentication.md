# 0007. Customer authentication

- Status: Accepted and implemented (registration and email verification first, then login, tokens and sessions in part 3A-3)
- Date: 2026-10-21
- Updated: 2026-10-25 (part 3A-3: login, tokens, sessions, endpoint protection)

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
- **Resend:** a new token is issued at most once per minute per account and replaces unused older tokens. A proper rate limiter (Valkey) arrives in part 3D.

### Login

- **Customers only.** Staff sign in through their own path with MFA (ADR 0004). On the customer login, a staff email is treated like an unknown one.
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

- **Deny by default.** A global guard protects every endpoint. Only handlers marked `@Public()` are open: the two health checks and the six `/v1/auth` endpoints. `@Public()` works on single handlers only, never on a whole controller, so a new handler is protected even in a controller with public ones.
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
- Every authenticated request costs one small database query for the session check. It can move to Valkey if measurements show a need.
- Replacing `JWT_ACCESS_SECRET` invalidates all access tokens at once. Clients simply refresh, because refresh tokens do not depend on the secret.

## Known gaps until part 3D

These are acceptable only while the API listens on `127.0.0.1` and has no real users. They must be closed before the API is reachable from outside the laptop.

1. **No rate limiting or brute-force protection** on login, registration, refresh or resend. Part 3D adds per-IP and per-account limits in Valkey, with back-off.
2. **Denial of service through password hashing.** argon2 runs on Node's thread pool (4 threads by default), so a burst of logins or registrations slows the whole API down. Part 3D adds a cap on concurrent hashing.
3. **The API stays on `127.0.0.1`.** To test on a phone, connect it over USB and run `adb reverse tcp:3000 tcp:3000`. Do not open the API on Wi-Fi.
4. **Pre-account takeover.** Someone can register an email address that is not theirs and wait for the owner to verify it. Follow-ups: delete unverified accounts after a few days, and let the password reset (item 5) mark the email verified, because a reset proves the owner controls the address.
5. **No password reset yet.** When it is built, a reset must revoke every session of the account.
6. **No breached-password check and no Unicode normalization of passwords yet.** Decide on normalization before there are real users.
7. **Nothing is ever deleted.** Expired sessions, used refresh tokens and old verification tokens stay in the database. A cleanup job with a retention period is needed (DPDP Act).
