# API specification

Status: **Draft v0.3.** Describes only the endpoints that exist today. OpenAPI documentation will be generated later (ADR 0002).

Base path: `/v1` for business endpoints. Health endpoints are unversioned.

## Conventions

- **JSON only.** Request bodies must be JSON (`Content-Type: application/json`), at most 100 kB and not compressed. A form body fails validation (`400`), a compressed body gets `415` and a larger body gets `413` (ADR 0008).
- Every response carries an `X-Request-Id` header. A client may send its own `X-Request-Id` (8 to 64 characters of letters, digits, `_` or `-`); otherwise one is generated.
- Every response carries the standard security headers (helmet), and no `X-Powered-By`.
- **Authentication.** Every endpoint needs an access token unless it is marked **Public** below. Send it as `Authorization: Bearer <accessToken>`.
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
| `401` | `Invalid or expired access token` | The token is forged, expired or not a customer access token, or its session has ended (logout, refresh-token reuse, 30 days passed, account disabled) |

On a `401` from a protected endpoint, the client refreshes once and retries. If the refresh fails too, the customer signs in again.

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
| `register` and `resend-verification` together | email address | 5 per hour |
| `login` | client IP | 60 attempts per minute |
| `login`, failed attempts | email + client IP | 5 per hour, then blocked for 15 minutes |
| `login`, failed attempts | email | 50 per hour, then blocked for 1 hour |
| `login`, failed attempts | client IP | 200 per hour, then blocked for 1 hour |
| `refresh`, `logout` | client IP | 120 per minute each |

The failure limits count unknown emails exactly like real ones, so a `429` never reveals whether an account exists. A successful login clears the email + IP failure count. The full rules are in ADR 0009.

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

All six endpoints are **Public**: they work without an access token.

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

Errors: `401` (see "Authentication errors on protected endpoints"); `429` (the 600 per minute limit).

## Not yet implemented

Password recovery, profile changes, "sign out everywhere", staff authentication (separate path, with MFA). See `docs/requirements.md`, ADR 0007 and `docs/security.md`.
