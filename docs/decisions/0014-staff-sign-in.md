# 0014. Staff sign-in, tokens and sessions

- Status: Accepted and implemented (part 3B-3)
- Date: 2026-10-30
- Updated: 2026-10-30 (part 3B-4: Super-User-only routes and Admin invitations, ADR 0015)
- Updated: 2026-10-31 (part 3B-5: disabling an Admin ends their staff sessions; the audit-log question moves to part 3B-6, ADR 0016)

## Context

ADR 0004 requires a separate sign-in path for Admins and Super Users, always with MFA. Part 3B-2 (ADR 0013) built the MFA foundations: secrets, codes that work once, and a setup command. What was missing:

- the staff login itself;
- tokens and sessions that open only staff routes;
- a guard that keeps the customer and staff worlds apart.

Staff accounts can see and change far more than one customer can. So a stolen password alone must never be enough, and an answer from the login must never confirm that a guessed password was right. A customer's token must never open a staff route either, and the other way round.

## Decision

### One request, password and code together

- **`POST /v1/staff/auth/login`** takes `{ email, password, code }` in one request. The code is the 6 digits the authenticator app shows now.
- **One answer for every failure:** `401 Invalid email, password or code`. It covers:
  - an unknown email, or a customer's email;
  - a wrong password;
  - a disabled account;
  - MFA not set up;
  - a wrong, expired or already used code;
  - an error while checking the code.

  Unlike the customer login (ADR 0007), a disabled staff account is **not** told so: that answer would confirm the password to whoever guessed it. An error while checking the code (for example after a changed `MFA_ENCRYPTION_KEY`) is logged as an error but answered the same way, because a `500` at that point would also show that the password was right.
- **A badly formed code** (not 6 digits) gets `400`. That reveals nothing, because it does not depend on any account.

### The order of the checks

1. **The failed-login counters:** while one is blocked, `429` before any other work.
2. **The email:** for an unknown or customer email, a dummy password hash runs, so the answer takes about as long as for a real staff account.
3. **The password** (argon2id, as for customers).
4. **The account must be active, and MFA must be set up.**
5. **The code, checked only now.** Codes cannot be tried without the right password. A valid code is used up atomically, so it never works a second time (ADR 0013).
6. **Success:** the email + IP failure counter is cleared, and a staff session starts.

### Brute-force protection

- **The staff login shares the three failed-login counters of the customer login** (email + IP, email, IP; ADR 0009). They now live in `LoginAttemptsService`. An attacker gains nothing by switching between the two paths. Every failure counts, including a wrong code and unknown emails.
- **A new per-IP limit, `staffLogin`: 10 attempts per minute.** There are few staff, so it is much tighter than the customer login's 60.
- **The email + IP counter is cleared only after the password and the code** were both right.

### Two token audiences

- **Access tokens carry the audience `customer` or `staff`** in the `aud` claim. Everything else is unchanged from ADR 0007: HS256, the same secret and issuer, 15 minutes.
- **Verification accepts only the audience asked for.** The default is `customer`, so code that forgets to say `staff` refuses staff tokens rather than accepting them.
- **Each route has one audience:**
  - routes marked **`@StaffOnly()`**, on the handler or on its whole controller, take staff tokens only;
  - every other protected route takes customer tokens only;
  - a token for the other audience fails exactly like a forged one: `401 Invalid or expired access token`, before any database query.
- **`@StaffOnly()` may mark a whole controller, unlike `@Public()`.** `@StaffOnly()` only narrows who gets in, so a route added to a staff controller later is staff-only automatically. `@Public()` still works per handler only, and is checked first, so the staff login stays reachable without a token.

### Staff sessions

- **12 hours in total**, one working day, with no idle timeout. After that the staff member signs in again with the password and a new code. Customers keep 30 days.
- **The same refresh rotation and reuse detection as customers** (ADR 0007), at `/v1/staff/auth/refresh` and `/v1/staff/auth/logout`.
- **A session's audience follows from its user's role.** Each login path accepts only its own roles, so no new database column is needed.
- **A refresh token from the other path is refused and left alone:** refresh answers `401`, logout answers `204` and does nothing. Neither path ever changes the other path's sessions. Such attempts are logged as warnings (`wrong_audience`).
- **The session check on every staff request** requires an active Admin or Super User **with MFA set up**. Disabling a staff member, or setting up their MFA again (which ends their sessions, ADR 0013), takes effect at once.

### Endpoints

| Endpoint | Access | Purpose |
|---|---|---|
| `POST /v1/staff/auth/login` | Public, `staffLogin` limit | Password and code, then a staff token pair |
| `POST /v1/staff/auth/refresh` | Public, `refresh` limit | Swaps a staff refresh token for a new pair |
| `POST /v1/staff/auth/logout` | Public, `logout` limit | Ends the staff session, always `204` |
| `GET /v1/staff/me` | Staff token | The staff member's own account, never the password hash or the MFA secret |

The staff code lives in `StaffModule`, which imports `AuthModule`. `SuperUserService` stays out of the API: Super Users are created only with the developer command (ADR 0012).

### Logging

- Every failed staff sign-in is logged with a reason and the user ID. The email, the password and the code are never logged.
- An unknown email is logged as information, because it is mostly noise. Every other failure involves a real account and is logged as a **warning**. An error in the code check is logged as an **error**.
- A successful sign-in logs `Signed in` with `"audience":"staff"`.

## Alternatives considered

- **A two-step login** (the password first, then the code with a short-lived "half signed in" token). Rejected. The in-between state is one more thing to protect, and it tells an attacker that the password was right.
- **A separate JWT secret for staff tokens.** Not now. The audience check already keeps the two apart, and a second secret doubles the rotation work. It can come with asymmetric keys, if a second service ever verifies tokens.
- **An `audience` column on sessions, or a separate staff session table.** Rejected. The role already decides, and fewer moving parts mean fewer ways for the two to disagree.
- **Telling a disabled staff member that their account is disabled.** Rejected for the reason above. A developer can see the reason in the log.
- **Separate failure counters for staff.** Rejected. An attacker could then guess twice as often by using both paths.
- **The customer session length (30 days) for staff.** Rejected. Staff access is too powerful to stay signed in for a month.

## Consequences

- Staff sign in with the password and a fresh code at least every 12 hours.
- A staff member without MFA cannot sign in at all. The log says `mfa_not_set_up`, and a developer runs `pnpm api:setup-staff-mfa`.
- **Only the newest MFA key works.** If the setup ran more than once, an older entry left in the authenticator app shows codes that are refused (`wrong_code` in the log). This happened while testing this part. The README tells developers to delete old entries, and a QR code in the admin console will make the mix-up less likely.
- **Each code works once.** A client must not retry a failed login with the same code: it waits for the next one.
- **Timing is similar, not identical.** A wrong code takes a little longer than a wrong password: there is one extra database read after the password check. The difference is small next to argon2's own variation, and every attempt counts against the failure limits.
- Staff sign-ins are in the application log, but not yet in the audit log. The decision on recording them there was moved to part 3B-6, together with the Super Users' view of the audit log (ADR 0015, ADR 0016).
- The smoke test checks on every run that a customer's password and tokens never open the staff routes. The staff login itself needs a phone, so it is tested by hand (README, "Sign in as staff").
- Part 3B-4 added a roles guard, so some staff routes are for Super Users only, and Admin invitations (ADR 0015). Part 3B-5 added managing Admins: disabling one ends their staff sessions at once (ADR 0016). Next: part 3B-6.
