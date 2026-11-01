# 0018. The customer's name, password and sessions

- Status: Accepted and implemented (part 3C-1)
- Date: 2026-11-01

## Context

Customers could sign up, sign in, read their own account (`GET /v1/me`) and reset a forgotten password (ADR 0007, ADR 0010). Three everyday needs were missing:

- **changing their name;**
- **changing their password while signed in,** without the reset email;
- **signing out on every device at once,** after a lost phone or a shared computer.

`docs/api-specification.md` listed all three as not implemented, and `docs/security.md` listed "sign out everywhere" as a later item.

Part 3C covers the rest of the customer account. It is split in two: 3C-1 (this ADR) and 3C-2 (delivery addresses).

## Decision

### Three endpoints on the customer's own account

They all sit on `/v1/me`, which is a customer route. The account is always the one in the access token, never one named in the URL or the body.

| Endpoint | Purpose | Answer |
|---|---|---|
| `PATCH /v1/me` | Change the name: `{ "fullName": "..." }` | `200` with the profile |
| `POST /v1/me/password` | Change the password: `{ "currentPassword", "newPassword" }` | `200` with a message |
| `DELETE /v1/me/sessions` | Sign out everywhere | `204` |

### Changing the name

- **Only the name can be changed here,** with the registration rule: trimmed, 1 to 100 characters. That rule now lives in one place, `fullName` in `auth.schemas.ts`, and the staff schemas use it too.
- **Unknown fields are dropped,** so `email` or `role` in the body change nothing.
- **Changing the email address is not here.** The new address needs its own verification, which comes later.

### Changing the password while signed in

- **The current password is required.** An access token proves only that someone holds the device. The current password proves it is the owner, so a stolen token alone cannot lock the owner out.
- **A wrong current password counts as a failed login** (`LoginAttemptsService`, ADR 0009). It counts against the same three counters, and the limits are checked before any password work. A stolen token therefore gives no faster way to guess the password than the login does. The answer is `400 The current password is wrong.`, not `401`: a `401` would make clients refresh and retry (`docs/api-specification.md`).
- **The new password follows the registration rules** (10 to 128 characters), and must differ from the current one: a zod `refine` over both fields.
- **It ends like a reset (ADR 0010):**
  - **every session ends, this one included,** so the customer signs in again with the new password;
  - any reset link still waiting stops working, so it cannot undo the change;
  - "Your password was changed" is emailed in the background.

  The notice already said "you were signed out on all devices", so both flows now match it.
- **A rate limit of its own,** `changePassword`: 10 per hour per IP. Each attempt costs an argon2 check, and also goes through the hashing cap (ADR 0009).
- A successful change clears the email + IP failure counter, like a successful login.

### Signing out everywhere

- **`DELETE /v1/me/sessions` ends every session of the customer, this one included,** in one `updateMany`. Every token stops working at once, because the guard checks the session on every request (ADR 0007). No token blocklist is needed.
- **Sessions that have already ended are left alone,** so their end times stay accurate for the 30-day history (ADR 0011).
- It logs the number of sessions it ended, and nothing personal.
- It has only the per-IP baseline limit: it is a cheap database write.

### Not in the audit log

These are customers' own changes. The audit log is for staff actions (ADR 0004, ADR 0012). The application log records password changes and "sign out everywhere", with the user ID only.

## Alternatives considered

- **Keeping this device signed in after a password change.** Rejected for now. It is friendlier, but it would need a second version of the notice email, and two flows that behave differently. Reconsider with the apps' user experience.
- **`401` for a wrong current password.** Rejected: clients treat `401` from a protected route as "refresh and retry".
- **A separate failure counter for password changes.** Rejected. Separate counters would double an attacker's guesses (the same reasoning as for staff, ADR 0014).
- **`POST /v1/auth/logout-all`.** Rejected in favour of `DELETE /v1/me/sessions`: in REST terms, "my sessions" is the collection, and deleting it ends them all.
- **A list of active sessions, with "sign out this one".** Not now: it needs device names, which no client sends yet.
- **Changing the email address in the same `PATCH`.** Rejected, because it needs a verification of the new address first.

## Consequences

- A customer can now manage the essentials of their account without support.
- **After a password change, every device signs in again,** the current one too. The apps must send the customer to the sign-in screen after a `200` from `/v1/me/password`.
- **The smoke test now runs the whole flow on every run, with no phone needed:**
  - a rename;
  - a wrong and a right password change, with two devices both signed out;
  - the notice email;
  - signing out everywhere, refresh token included.

  It has 46 checks in total.
- **Still open for customers:** changing the email address, the phone number with OTP (the verification method is undecided, `docs/requirements.md`), deleting the account (DPDP erasure), and a list of active sessions.
- Next: part 3C-2, delivery addresses.
