# API specification

Status: **Draft v0.8.** Describes only the endpoints that exist today. OpenAPI documentation will be generated later (ADR 0002).

Base path: `/v1` for business endpoints. Health endpoints are unversioned.

## Conventions

- **JSON only.** Request bodies must be JSON (`Content-Type: application/json`), at most 100 kB and not compressed. A form body fails validation (`400`), a compressed body gets `415` and a larger body gets `413` (ADR 0008).
- Every response carries an `X-Request-Id` header. A client may send its own `X-Request-Id` (8 to 64 characters of letters, digits, `_` or `-`); otherwise one is generated.
- **IDs in paths** are UUIDs. Any other value gets `400` with `"message": "Validation failed (uuid is expected)"`, before any other work.
- Every response carries the standard security headers (helmet), and no `X-Powered-By`.
- **Authentication.** Every endpoint needs an access token unless it is marked **Public** below. Send it as `Authorization: Bearer <accessToken>`. There are two kinds: customer endpoints take customer access tokens, and staff endpoints (`/v1/staff/...`) take staff access tokens. Neither works on the other's endpoints. Some staff endpoints are for **Super Users only**, marked so below.
- **Caching.** Token responses and every authenticated response carry `Cache-Control: no-store`. Clients and proxies must not store them.
- **Rate limits.** Every endpoint is rate limited, the sign-up and sign-in endpoints more strictly. See "Rate limits and busy answers" below.

### Error format

```json
{
  "message": "Validation failed",
  "errors": [{ "field": "password", "message": "Password must be at least 10 characters" }],
  "statusCode": 400,
  "requestId": "9b2f6c0e-..."
}
```

| Field | When |
|---|---|
| `message` | Always. Human-readable; clients must not branch on its text. |
| `statusCode` | Always. The HTTP status. |
| `requestId` | Always. Quote it when reporting a problem. |
| `errors` | Validation failures only: one entry per invalid field. The submitted values are never echoed back. |
| `code` | Only when a client must react to one specific case. Stable, in capitals. Today: `ACCOUNT_DISABLED`, `RATE_LIMITED`, `SERVER_BUSY`. |
| `error` | Most errors: the HTTP status name, for example `"Unauthorized"`. |

Unexpected errors return `500` with `"message": "Internal server error"`; the details go to the server log only.

### Authentication errors on protected endpoints

| Status | `message` | Meaning |
|---|---|---|
| `401` | `Missing access token` | No `Authorization` header, or not in the form `Bearer <token>` |
| `401` | `Invalid or expired access token` | The token is forged or expired, or not an access token for this endpoint (a staff token on a customer endpoint, or the other way round), or its session has ended (logout, refresh-token reuse, its 30 days or 12 hours passed, account disabled) |
| `403` | `Only a Super User may do this.` | A Super-User-only endpoint called with an Admin's staff token. The token is valid: signing in again does not help. |

On a `401` from a protected endpoint, the client refreshes once and retries. If the refresh fails too, the user signs in again. On a `403`, the client neither refreshes nor retries: it tells the staff member that the action needs a Super User.

### Rate limits and busy answers

Two answers mean "try again later". Both carry a **`Retry-After`** header with the number of seconds to wait.

| Status | Body | Meaning |
|---|---|---|
| `429` | `{ "message": "Too many requests. Please try again later.", "code": "RATE_LIMITED" }` | You sent too much: a rate limit is used up, or a sign-in block is running |
| `503` | `{ "message": "The server is busy. Please try again in a few seconds.", "code": "SERVER_BUSY" }` | The server is too busy checking passwords right now (`Retry-After: 5`) |

The per-IP limits are checked before anything else, so a `429` can arrive even for a request that would fail validation.

| What | Counted per | Limit |
|---|---|---|
| Every endpoint, health included | client IP | 600 requests per minute |
| `register` | client IP | 20 per hour |
| `verify-email` | client IP | 60 per hour |
| `resend-verification` | client IP | 20 per hour |
| `forgot-password` | client IP | 20 per hour |
| `reset-password` | client IP | 20 per hour |
| `register`, `resend-verification`, `forgot-password` and `staff/admins/:id/invitation` together | email address | 5 per hour |
| `login` | client IP | 60 attempts per minute |
| `staff/auth/login` | client IP | 10 attempts per minute |
| `staff/admins` and `staff/admins/:id/invitation` together (inviting an Admin, and again) | client IP | 20 per hour |
| `staff/auth/accept-invite` | client IP | 20 per hour |
| `login` and `staff/auth/login` together, failed attempts | email + client IP | 5 per hour, then blocked for 15 minutes |
| `login` and `staff/auth/login` together, failed attempts | email | 50 per hour, then blocked for 1 hour |
| `login` and `staff/auth/login` together, failed attempts | client IP | 200 per hour, then blocked for 1 hour |
| `refresh`, `logout` (customer and staff together) | client IP | 120 per minute each |

The failure limits count unknown emails exactly like real ones, so a `429` never reveals whether an account exists. A successful login clears the email + IP failure count. The full rules are in ADR 0009 and, for staff, ADR 0014.

Rules for clients:
- Wait the `Retry-After` seconds before trying again. Never retry at once or in a loop.
- On `429` from login, show the message and the waiting time. Don't suggest "wrong password": during a block, even the right password gets `429`.
- Many customers can share one public IP (for example on mobile networks), so a `429` can be caused by someone else on the same network.

## Health

| Method | Path | Access | Purpose | Success |
|--------|------|--------|---------|---------|
| GET | `/health` | Public | Liveness | `200 {"status":"ok"}` |
| GET | `/health/ready` | Public | PostgreSQL and Valkey reachable | `200 {"status":"ok","checks":{"database":"up","valkey":"up"}}`, or `503` with `"status":"error"` |

## Authentication (customers)

All eight endpoints are **Public**: they work without an access token.

### POST `/v1/auth/register`

Creates a Customer account and sends a verification email. Only Customer accounts can be created here; any `role` field in the body is ignored.

Request:
```json
{ "email": "aswin@example.com", "password": "a-long-password-1", "fullName": "Aswin" }
```
Rules: email is trimmed, lowercased and must be valid (max 254). Password 10 to 128 characters. Name 1 to 100 characters.

Response `202 Accepted` (identical whether or not the email already has an account):
```json
{ "message": "If this email address can be used, we have sent you a message. Please check your inbox." }
```
Errors: `400` validation failed or malformed JSON; `429` (per-IP limit, or 5 emails per hour to this address); `503` server busy.

An account whose email is still not verified 7 days after sign-up is deleted (ADR 0011). Registering again with the same address then starts from scratch.

### POST `/v1/auth/verify-email`

Confirms the email address using the token from the email link.

Request: `{ "token": "<token from the email>" }`

Response `200`: `{ "message": "Email address verified." }`

Errors: `400` with `Invalid or expired verification link` (unknown, expired or already used token); `429` per-IP limit.

### POST `/v1/auth/resend-verification`

Sends a new verification email if the account exists and is not yet verified. At most one per minute per account.

Request: `{ "email": "aswin@example.com" }`

Response `202`: same generic message as registration, always.

Errors: `400` validation failed; `429` (per-IP limit, or 5 emails per hour to this address).

### POST `/v1/auth/login`

Signs in a Customer whose email is verified, and starts a session that lasts 30 days.

Request:
```json
{ "email": "aswin@example.com", "password": "a-long-password-1" }
```
Rules: email as for registration. Password 1 to 128 characters (the registration rules are not re-checked, so older passwords keep working).

Response `200`, with `Cache-Control: no-store`:
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "refreshToken": "q3Vb..."
}
```
- `accessToken`: send it in the `Authorization` header. Valid for `expiresIn` seconds (15 minutes).
- `refreshToken`: keep it in secure storage and use it only with `/v1/auth/refresh` and `/v1/auth/logout`.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed` | Missing or invalid fields |
| `401` | `Invalid email or password` | Unknown email, wrong password, or email not verified yet (one answer for all three, so the response never reveals which emails are registered) |
| `403` | `{ "message": "This account is disabled.", "code": "ACCOUNT_DISABLED" }` | The account is disabled. Given only after the correct password. |
| `429` | `code: "RATE_LIMITED"` | Too many attempts from this IP, or too many failed attempts for this email. The failure that goes over a limit already answers `429`, and so does every attempt while the block lasts, even with the right password (which is then not checked at all). |
| `503` | `code: "SERVER_BUSY"` | Too many password checks at once; try again after `Retry-After` |

Client tip: after a `401`, offer "resend the verification email" next to the error, because the cause may be an unverified email.

### POST `/v1/auth/refresh`

Swaps a refresh token for a new token pair. Each refresh token works **once**.

Request: `{ "refreshToken": "<refresh token>" }` (20 to 200 characters)

Response `200`, with `Cache-Control: no-store`: same body as login. Store the new refresh token at once: the old one no longer works.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed` | Missing or invalid field |
| `401` | `Invalid refresh token` | Unknown or already used token, session ended (logout, 30 days passed), or account no longer allowed. One answer for all cases. |
| `429` | `code: "RATE_LIMITED"` | Per-IP limit. The refresh token was **not** used, so wait `Retry-After` and try again with the same one. |

Rules for clients:
- **Never refresh in parallel.** Sending an already used refresh token counts as theft: the whole session ends, and its access tokens stop working at once. Run one refresh at a time and let other requests wait for its result.
- If refresh answers `401`, delete both tokens and ask the customer to sign in again.

### POST `/v1/auth/logout`

Ends the session the refresh token belongs to. Its refresh token and access tokens stop working at once. No access token is needed, because it may already have expired.

Request: `{ "refreshToken": "<refresh token>" }`

Response `204 No Content`, always, also for an unknown or used token, so the answer never reveals whether a token was valid.

Errors: `400` validation failed; `429` per-IP limit.

The client deletes both tokens locally, whatever the answer.

### POST `/v1/auth/forgot-password`

Asks for a link to choose a new password. The link goes by email and is valid for **30 minutes, once**.

Request: `{ "email": "aswin@example.com" }` (normalised as for registration)

Response `202`, always the same, whether or not the email has an account:
```json
{ "message": "If this email address has an account, we have sent a link to choose a new password. Please check your inbox." }
```
- A link is sent only to an active customer account, verified or not. Staff and disabled accounts get nothing.
- The email is sent after the response, so it can take a few seconds to arrive.
- A new request replaces any earlier unused link.

Errors: `400` validation failed; `429` (per-IP limit, or 5 emails per hour to this address).

### POST `/v1/auth/reset-password`

Sets a new password with the token from the email link. The link points to the website (`/reset-password?token=...`), which posts the token here.

Request:
```json
{ "token": "<token from the email>", "newPassword": "a-new-long-password-2" }
```
Rules: the token is 20 to 200 characters; the new password follows the registration rules (10 to 128 characters).

Response `200`:
```json
{ "message": "Your password has been changed. Please sign in with your new password." }
```
What a reset also does:
- **Every session of the account ends.** All refresh and access tokens stop working at once.
- The email address counts as verified from now on.
- Any login block for this email is lifted, so the new password works straight away.
- A "your password was changed" email is sent to the account (without a link).
- The customer is **not** signed in. The client sends them to the login screen.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed` | Missing fields, or the new password breaks the rules |
| `400` | `Invalid or expired reset link` | Unknown, used or expired link, or an account that can no longer sign in. One answer for all cases. |
| `429` | `code: "RATE_LIMITED"` | Per-IP limit |
| `503` | `code: "SERVER_BUSY"` | Too many password hashes at once; try again after `Retry-After` |

Client tip: on `400 Invalid or expired reset link`, offer to send a new link.

## Account

### GET `/v1/me`

Returns the signed-in customer's own account. The user comes from the access token, never from the URL.

Request header: `Authorization: Bearer <accessToken>`

Response `200`, with `Cache-Control: no-store`:
```json
{
  "id": "0b8f5c1e-3f2a-4a6d-9c41-2d7e8b9a1f03",
  "email": "aswin@example.com",
  "fullName": "Aswin",
  "role": "CUSTOMER",
  "emailVerifiedAt": "2026-10-25T08:00:00.000Z",
  "createdAt": "2026-10-25T07:58:12.000Z"
}
```

Errors: `401` (see "Authentication errors on protected endpoints"), also for a staff access token; `429` (the 600 per minute limit).

## Staff authentication

For Admins and Super Users only. Customers cannot sign in here, and staff cannot sign in at `/v1/auth/login`. An invited Admin first chooses a password (`accept-invite` below). Then a developer sets up the staff member's authenticator app (README, "Set up staff MFA").

Staff access tokens work only on staff endpoints, and customer tokens never work there (ADR 0014).

### POST `/v1/staff/auth/login`

**Public.** Signs in with the password and the code the authenticator app shows now, in one request, and starts a session that lasts **12 hours**.

Request:
```json
{ "email": "dev.super1@example.com", "password": "a-long-staff-password", "code": "123456" }
```
Rules: email as for registration. Password 1 to 128 characters. Code exactly 6 digits (spaces around it are trimmed).

Response `200`, with `Cache-Control: no-store`: the same body as the customer login (`accessToken`, `tokenType`, `expiresIn` of 900, `refreshToken`). Use the refresh token only with `/v1/staff/auth/refresh` and `/v1/staff/auth/logout`.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed` | Missing or invalid fields, for example a code that is not 6 digits |
| `401` | `Invalid email, password or code` | Every failure: an unknown or customer email, a wrong password, a disabled account, MFA not set up, a wrong or already used code. One answer for all, so it never reveals that the password was right. |
| `429` | `code: "RATE_LIMITED"` | Too many attempts from this IP (10 per minute), or too many failed attempts for this email. The failure limits are shared with the customer login. |
| `503` | `code: "SERVER_BUSY"` | Too many password checks at once; try again after `Retry-After` |

Rules for clients:
- **Each code works once.** After a `401`, wait for the next code before trying again; never send the same code twice.
- Don't guess for the user which part was wrong: the answer is the same on purpose.

### POST `/v1/staff/auth/refresh`

**Public.** Works like `/v1/auth/refresh`, for staff refresh tokens only: each token works once, and reusing one ends the session. The session still ends 12 hours after the login.

A customer refresh token gets `401 Invalid refresh token`, and is not used up: it keeps working on its own path. Errors otherwise as for `/v1/auth/refresh`.

### POST `/v1/staff/auth/logout`

**Public.** Works like `/v1/auth/logout`, for staff sessions. Always `204`; a customer refresh token is ignored.

### POST `/v1/staff/auth/accept-invite`

**Public.** The invited Admin chooses their password with the token from the invitation email. The link points to the admin console (`/staff/accept-invite?token=...`), which posts the token here. It is valid for **72 hours, once**.

Request:
```json
{ "token": "<token from the email>", "password": "a-long-staff-password-1" }
```
Rules: the token is 20 to 200 characters; the password 16 to 128 characters.

Response `200`:
```json
{ "message": "Your password has been set. Before you can sign in, a developer will set up an authenticator app on your phone with you." }
```
What accepting also does:
- the email address counts as verified;
- any session of the account ends, and any other unused invitation stops working;
- the acceptance is written to the audit log (`admin.invite_accepted`).

The Admin is **not** signed in: staff sign in only with an authenticator code, which a developer sets up next.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed` | Missing fields, or a password shorter than 16 characters |
| `400` | `Invalid or expired invitation link` | Unknown, used or expired link, or an account that is no longer an active Admin. One answer for all cases. |
| `429` | `code: "RATE_LIMITED"` | Per-IP limit (20 per hour) |
| `503` | `code: "SERVER_BUSY"` | Too many password hashes at once; try again after `Retry-After` |

Client tip: on `400 Invalid or expired invitation link`, tell the Admin to ask a Super User for a new invitation.

### GET `/v1/staff/me`

Returns the signed-in staff member's own account, never the password hash or the MFA secret. Needs a **staff** access token.

Response `200`, with `Cache-Control: no-store`:
```json
{
  "id": "5d1e8c2a-7b3f-4e9a-a1c6-2f8d0b4e7a93",
  "email": "dev.super1@example.com",
  "fullName": "Dev Super One",
  "role": "SUPER_USER",
  "mfaEnabledAt": "2026-10-30T04:10:36.000Z",
  "createdAt": "2026-10-27T17:36:13.000Z"
}
```

Errors: `401` (see "Authentication errors on protected endpoints"), also for a customer access token; `429` (the 600 per minute limit).

## Admin accounts (Super Users only)

These endpoints need a **Super User's** staff access token. An Admin's token gets `403 Only a Super User may do this.` Every change is written to the audit log, with the Super User, the client IP and the request ID (ADR 0015, ADR 0016). These endpoints act on Admins only: a Super User's ID gets `404`, like an unknown one.

| Endpoint | Purpose |
|---|---|
| `GET /v1/staff/admins` | List every Admin |
| `POST /v1/staff/admins` | Invite an Admin |
| `POST /v1/staff/admins/:id/invitation` | Send a pending Admin a new invitation |
| `PATCH /v1/staff/admins/:id` | Disable or enable an Admin |
| `DELETE /v1/staff/admins/:id` | Remove a disabled or pending Admin |

### POST `/v1/staff/admins`

Invites an Admin. This creates the account and emails the person a link to choose their own password. The Super User never chooses or sees that password.

Request:
```json
{ "email": "dev.admin1@example.com", "fullName": "Dev Admin One" }
```
Rules: email and name as for registration. Any other field, such as `role` or `password`, is ignored.

Response `201`:
```json
{
  "id": "3c9a7e21-5b4d-4f8e-9a16-7d2e0c5b8f41",
  "email": "dev.admin1@example.com",
  "fullName": "Dev Admin One",
  "role": "ADMIN",
  "invitationExpiresAt": "2026-11-02T10:00:00.000Z",
  "invitationSent": true
}
```
- `invitationExpiresAt`: the link works until then (72 hours) and only once.
- `invitationSent`: `false` if the email could not be sent. The Admin exists anyway: send a new invitation with `POST /v1/staff/admins/:id/invitation`.
- The answer never contains the token or the link.

Until the invitation is accepted, the Admin cannot sign in. After that, a developer sets up their authenticator app (README, "Invite an Admin").

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed` | Missing or invalid fields |
| `401` | see "Authentication errors on protected endpoints" | No staff access token, or a customer's |
| `403` | `Only a Super User may do this.` | Called by an Admin |
| `409` | `An account with this email address already exists.` | The email already has an account, customer or staff. Customers are never turned into staff: an Admin needs another address. |
| `429` | `code: "RATE_LIMITED"` | Per-IP limit (20 per hour) |
| `503` | `code: "SERVER_BUSY"` | Too many password hashes at once; try again after `Retry-After` |

### GET `/v1/staff/admins`

Lists every Admin, oldest first, pending ones included. Never the password hash or the MFA secret. There is no paging: there are only a few Admins.

Response `200`:
```json
{
  "admins": [
    {
      "id": "3c9a7e21-5b4d-4f8e-9a16-7d2e0c5b8f41",
      "email": "dev.admin1@example.com",
      "fullName": "Dev Admin One",
      "status": "ACTIVE",
      "invitationAcceptedAt": "2026-10-30T11:43:18.000Z",
      "invitationExpiresAt": null,
      "mfaEnabledAt": "2026-10-30T11:47:36.000Z",
      "createdAt": "2026-10-30T11:28:51.000Z"
    }
  ]
}
```
- `status`: `ACTIVE` or `DISABLED`.
- `invitationAcceptedAt`: when the Admin chose their password, or `null` while the invitation is pending.
- `invitationExpiresAt`: when the newest unused invitation ends, or `null` if there is none. A time in the past means the link has expired: send a new one.
- `mfaEnabledAt`: when a developer set up the authenticator app, or `null`. Until then the Admin cannot sign in.

Errors: `401`, `403` (as above); `429` (the 600 per minute limit).

### POST `/v1/staff/admins/:id/invitation`

Sends a pending Admin a new invitation: a new link, valid for 72 hours and once. **Every older link stops working.** No request body.

Response `201`: the same body as `POST /v1/staff/admins`, with the new `invitationExpiresAt` and `invitationSent`.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed (uuid is expected)` | The ID is not a UUID |
| `401`, `403` | as above | |
| `404` | `Admin not found` | No Admin with this ID |
| `409` | `This Admin has already accepted the invitation.` | The Admin already chose a password: there is nothing to invite them to |
| `409` | `Enable this Admin before inviting them again.` | The Admin is disabled |
| `429` | `code: "RATE_LIMITED"` | Per-IP limit (20 invitations per hour, first ones and new ones together), or 5 emails per hour to this address. Nothing was changed: the old link still works. |

### PATCH `/v1/staff/admins/:id`

Disables or enables an Admin.

Request:
```json
{ "status": "DISABLED" }
```
Rules: `status` is `ACTIVE` or `DISABLED`, in capitals. Any other field is ignored.

Response `200`: the Admin, in the same form as in the list.

- **Disabling ends every session of the Admin at once.** Their tokens stop working, and enabling them later does not bring those sessions back: they sign in again.
- **Asking for the status the Admin already has changes nothing,** and answers `200` too. It is safe to send the same request twice.
- A disabled Admin cannot sign in, and cannot accept an invitation.

Errors: `400` (`Validation failed` for the body, or `Validation failed (uuid is expected)` for the ID); `401`, `403` (as above); `404 Admin not found`; `429` (the 600 per minute limit).

### DELETE `/v1/staff/admins/:id`

Removes an Admin, with their sessions and invitations. Only a **disabled** Admin, or a **pending** one who never accepted the invitation, can be removed. The audit log keeps who it was.

Response `204 No Content`.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed (uuid is expected)` | The ID is not a UUID |
| `401`, `403` | as above | |
| `404` | `Admin not found` | No Admin with this ID, also when it was just removed |
| `409` | `Disable this Admin before removing them.` | The Admin is active and has accepted the invitation |
| `429` | `code: "RATE_LIMITED"` | The 600 per minute limit |

Client tip: offer "Remove" only for disabled and pending Admins, and "Disable" first for active ones.

## Not yet implemented

Profile changes, changing the password while signed in, "sign out everywhere", staff password changes, and a view of the audit log for Super Users (part 3B-6). See `docs/requirements.md`, ADR 0007, ADR 0014, ADR 0015, ADR 0016 and `docs/security.md`.
