# API specification

Status: **Draft v0.1.** Describes only the endpoints that exist today. OpenAPI documentation will be generated later (ADR 0002).

Base path: `/v1` for business endpoints. Health endpoints are unversioned.

## Conventions

- JSON requests and responses.
- Every response carries an `X-Request-Id` header. A client may send its own `X-Request-Id` (8 to 64 characters of letters, digits, `_` or `-`); otherwise one is generated.
- Error format (all errors):

```json
{
  "message": "Validation failed",
  "errors": [{ "field": "password", "message": "Password must be at least 10 characters" }],
  "statusCode": 400,
  "requestId": "9b2f6c0e-..."
}
```

`errors` appears only for validation failures. Unexpected errors return `"message": "Internal server error"` and details go to the server log only.

## Health

| Method | Path | Purpose | Success |
|--------|------|---------|---------|
| GET | `/health` | Liveness | `200 {"status":"ok"}` |
| GET | `/health/ready` | PostgreSQL and Valkey reachable | `200`, or `503` with `{"status":"error","checks":{...}}` |

## Authentication (customers)

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
Errors: `400` validation failed or malformed JSON.

### POST `/v1/auth/verify-email`

Confirms the email address using the token from the email link.

Request: `{ "token": "<token from the email>" }`

Response `200`: `{ "message": "Email address verified." }`

Errors: `400` with `Invalid or expired verification link` (unknown, expired or already used token).

### POST `/v1/auth/resend-verification`

Sends a new verification email if the account exists and is not yet verified. At most one per minute per account.

Request: `{ "email": "aswin@example.com" }`

Response `202`: same generic message as registration, always.

## Not yet implemented

Login, token refresh, logout, `GET /v1/me`, password recovery, staff authentication, rate limiting. See `docs/requirements.md` and the roadmap in ADR 0007.
