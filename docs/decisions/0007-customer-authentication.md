# 0007. Customer authentication

- Status: Accepted (registration and email verification implemented; login and tokens planned for part 3A-3)
- Date: 2026-10-21

## Context

Customers must be able to register, verify their contact details and sign in. The handbook suggests phone OTP, which needs a paid SMS provider and DLT registration in India. The owner chose email and password first.

## Decision

- **Sign-in method:** email + password, with email verification. Phone OTP can be added later behind the notification layer.
- **Password storage:** argon2id (`@node-rs/argon2`) with 19 MiB memory, 2 passes and 1 lane (OWASP minimum). The library needs no native build step, so it does not trigger pnpm's build-script approval.
- **Password rules:** 10 to 128 characters, no forced character classes. A common-password check will be added later.
- **Registration only creates Customers.** The role is set by the server and the request schema drops unknown fields, so a client can never choose a role.
- **No account enumeration.** Registration and "resend verification" return the same response whether or not the email exists. An existing address receives an "account already exists" notice instead of a second account. The password is hashed on both paths so response times are similar. Perfect timing equality is not claimed.
- **Verification tokens:** 32 random bytes (base64url), stored only as a SHA-256 hash, valid for 24 hours, single use. The claim is an atomic conditional update, so two simultaneous requests cannot both succeed.
- **Resend:** a new token is issued at most once per minute per account and replaces unused older tokens. A proper rate limiter (Valkey) arrives in part 3D.
- **Login requires a verified email** (part 3A-3).
- **Planned for 3A-3:** 15-minute access tokens (HS256, secret from the environment) and rotating refresh tokens stored hashed, with reuse detection. Asymmetric keys are deferred until a second service must verify tokens.
- **Logging:** emails, passwords and tokens are never logged. Mail failures log only the error name and the user ID.

## Consequences

- A customer whose verification email fails to send can request a new one.
- The "account exists" email tells the real owner about the attempt without revealing anything to the requester.
- Before launch we still need rate limiting, brute-force protection, password recovery and a breached-password check.
