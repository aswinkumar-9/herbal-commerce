# API specification

Status: **Draft v0.17.** Describes only the endpoints that exist today. OpenAPI documentation will be generated later (ADR 0002).

Base path: `/v1` for business endpoints. Health endpoints are unversioned. Image files are served at `/media` (see "Image files").

## Conventions

- **JSON only.** Request bodies must be JSON (`Content-Type: application/json`), at most 100 kB and not compressed. A form body fails validation (`400`), a compressed body gets `415` and a larger body gets `413` (ADR 0008). The one exception is the image upload, whose body is the image itself (see "Managing product images").
- Every response carries an `X-Request-Id` header. A client may send its own `X-Request-Id` (8 to 64 characters of letters, digits, `_` or `-`); otherwise one is generated.
- **IDs in paths** are UUIDs. Any other value gets `400` with `"message": "Validation failed (uuid is expected)"`, before any other work.
- **Money** is a whole number, and its field name says the unit: `priceRupees: 449` is ₹449. Prices are whole rupees and include GST (ADR 0022).
- **Dates without a time,** such as a batch's expiry, are written `2028-09-30`, in requests and answers, and count in India's time (ADR 0024). Moments, such as `createdAt`, are UTC timestamps like `2026-11-06T05:49:34.102Z`.
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
| `503` | `{ "message": "The server is busy. Please try again in a few seconds.", "code": "SERVER_BUSY" }` | The server is too busy checking passwords, or checking uploaded images, right now (`Retry-After: 5`) |

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
| `me/password` | client IP | 10 per hour |
| `staff/admins` and `staff/admins/:id/invitation` together (inviting an Admin, and again) | client IP | 20 per hour |
| `staff/auth/accept-invite` | client IP | 20 per hour |
| Uploading an image (`POST staff/products/:productId/images`) | client IP | 120 per hour |
| `login` and `staff/auth/login` together, failed attempts | email + client IP | 5 per hour, then blocked for 15 minutes |
| `login` and `staff/auth/login` together, failed attempts | email | 50 per hour, then blocked for 1 hour |
| `login` and `staff/auth/login` together, failed attempts | client IP | 200 per hour, then blocked for 1 hour |
| `refresh`, `logout` (customer and staff together) | client IP | 120 per minute each |

The failure limits count unknown emails exactly like real ones, so a `429` never reveals whether an account exists. A successful login clears the email + IP failure count. A wrong current password at `me/password` counts as a failed login too. The full rules are in ADR 0009 and, for staff, ADR 0014.

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

### PATCH `/v1/me`

Changes the signed-in customer's own name.

Request: `{ "fullName": "Asha K" }`. The name is trimmed, and must be 1 to 100 characters. Any other field, such as `email` or `role`, is ignored.

Response `200`: the profile, as for `GET /v1/me`.

Errors: `400 Validation failed`; `401` (also for a staff access token); `429` (the 600 per minute limit).

Changing the email address is not possible yet: the new address will need its own verification.

### POST `/v1/me/password`

Changes the signed-in customer's password. The current password is required, so a stolen access token alone cannot change it.

Request:
```json
{ "currentPassword": "a-long-password-1", "newPassword": "a-new-long-password-2" }
```
Rules: the current password is 1 to 128 characters (only the length is checked, as at login). The new password follows the registration rules (10 to 128 characters), and must differ from the current one.

Response `200`:
```json
{ "message": "Your password has been changed. Please sign in again with your new password." }
```
What a change also does:
- **every session of the account ends, this one included.** All refresh and access tokens stop working at once;
- any reset link that is still waiting stops working;
- a "your password was changed" email is sent to the account.

The client sends the customer to the sign-in screen.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed` | A missing field, a new password that breaks the rules, or the same password twice |
| `400` | `The current password is wrong.` | The current password does not match. It counts as a failed login. |
| `401` | see "Authentication errors on protected endpoints" | No valid customer access token |
| `429` | `code: "RATE_LIMITED"` | 10 changes per hour from this IP, or the failed-login limits for this account (shared with the login) |
| `503` | `code: "SERVER_BUSY"` | Too many password checks at once; try again after `Retry-After` |

A wrong current password answers `400`, not `401`, so the client does not mistake it for an expired token.

### DELETE `/v1/me/sessions`

Signs the customer out on every device, this one included.

Response `204 No Content`. Every refresh and access token of the account stops working at once; each device signs in again.

Errors: `401` (see "Authentication errors on protected endpoints"); `429` (the 600 per minute limit).

## Delivery addresses

The signed-in customer's own delivery addresses (ADR 0019). They need a **customer** access token. The customer always comes from the token: a `userId` in a body is ignored, and **another customer's address answers `404`**, exactly like one that does not exist.

An address, as every endpoint here returns it:
```json
{
  "id": "6f2b9d1e-4c7a-4e3b-9a85-1d2c3e4f5a6b",
  "fullName": "Asha K",
  "phone": "9845012345",
  "line1": "12, 3rd Cross, Indiranagar",
  "line2": null,
  "city": "Bengaluru",
  "state": "Karnataka",
  "pincode": "560038",
  "isDefault": true,
  "createdAt": "2026-11-01T12:00:00.000Z",
  "updatedAt": "2026-11-01T12:00:00.000Z"
}
```

The rules for each field:

| Field | Rules |
|---|---|
| `fullName` | Who receives the parcel, 1 to 100 characters, trimmed |
| `phone` | A 10-digit Indian mobile number starting with 6 to 9. Spaces, hyphens and a leading `+91`, `91` or `0` are allowed and removed: `+91 98450 12345` is stored as `9845012345`. |
| `line1` | House number and street, 1 to 200 characters |
| `line2` | Optional, up to 200 characters. An empty value or `null` means none. |
| `city` | 1 to 100 characters |
| `state` | One of India's 28 states and 8 union territories, spelled exactly as listed in `apps/api/src/addresses/addresses.schemas.ts` (for example `Karnataka`, `Delhi`, `Tamil Nadu`) |
| `pincode` | 6 digits, not starting with 0. A space is allowed and removed: `560 038` is stored as `560038`. |

**There is always exactly one default address,** as long as the customer has any:
- the first address is the default;
- another one becomes it only when asked;
- removing the default makes the newest remaining address the default.

### GET `/v1/me/addresses`

Response `200`: `{ "addresses": [...] }`, the default first, then the newest. An empty list for a customer without addresses.

Errors: `401`; `429` (the 600 per minute limit).

### POST `/v1/me/addresses`

Adds an address. The body has the fields above, and optionally `"isDefault": true` to make it the default. The first address always becomes the default, whatever is sent.

Response `201`: the saved address.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed` | A missing or invalid field, each named in `errors` |
| `401` | see "Authentication errors on protected endpoints" | No valid customer access token |
| `409` | `You can save at most 10 addresses. Remove one first.` | The customer already has 10 |
| `429` | `code: "RATE_LIMITED"` | The 600 per minute limit |

Two requests at the same moment (a double tap) are handled one after the other: both are saved, and there is still exactly one default.

### PATCH `/v1/me/addresses/:id`

Changes an address. Send only the fields that change, with the same rules, or `{ "isDefault": true }` to make it the default (the old default then stops being it).

Response `200`: the changed address.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed (uuid is expected)` | The ID is not a UUID |
| `400` | `Validation failed` | An invalid field, an empty change (`Nothing to change`), or `"isDefault": false` (make another address the default instead) |
| `401` | see above | No valid customer access token |
| `404` | `Address not found` | No such address, or it belongs to someone else |
| `429` | `code: "RATE_LIMITED"` | The 600 per minute limit |

### DELETE `/v1/me/addresses/:id`

Removes an address. If it was the default, the newest remaining address becomes the default.

Response `204 No Content`.

Errors: `400` (the ID is not a UUID); `401`; `404 Address not found` (no such address, or someone else's); `429` (the 600 per minute limit).

## Categories

### GET `/v1/categories`

**Public.** The product categories customers see, with or without a token (ADR 0020). Only **active** categories, ordered as staff chose (by `position`, then by name).

Response `200`:
```json
{
  "categories": [
    { "name": "Hair Care", "slug": "hair-care", "description": "Oils and powders for the hair" },
    { "name": "Herbal Teas", "slug": "herbal-teas", "description": null }
  ]
}
```
- Each category has exactly these three fields. `description` may be `null`.
- `slug` is the readable part of a web address (`/categories/hair-care`): lowercase letters, digits and single hyphens. Use it in links. It stays the same when a category is renamed.
- An empty list while no category is active.

Errors: `429` (the 600 per minute limit).

### GET `/v1/categories/:slug/products`

**Public.** A category's page in the shop: the category and one page of its products (ADR 0021). Only **live** products are listed: those that are active, in an active category. The order is the one staff chose, by `position`, then by name.

Query parameters, both optional:

| Parameter | Rules | Meaning |
|---|---|---|
| `limit` | Whole number, 1 to 50, default 20 | Products per page |
| `after` | A product's slug | The `nextAfter` of the previous page: continue just after it |

Response `200`:
```json
{
  "category": { "name": "Herbal Supplements", "slug": "herbal-supplements", "description": null },
  "products": [
    {
      "name": "Ashwagandha Capsules",
      "slug": "ashwagandha-capsules",
      "summary": "For calm and strength",
      "fromPriceRupees": 400,
      "imageUrl": "http://127.0.0.1:3000/media/products/32d470e1-c036-42a5-95c3-1b17c172e8e5-small.webp"
    }
  ],
  "nextAfter": null
}
```
- Each product has exactly these five fields. Its page has the rest (below).
- `fromPriceRupees`: the lowest price among the product's packs on sale, for "from ₹400". It is `null` while no pack is on sale (ADR 0022).
- `imageUrl`: the small file of the product's main photo, at most 400 pixels on its longest side (ADR 0023). A live product always has an image.
- `nextAfter`: send it as `?after=` for the next page. It is `null` on the last page.
- The shop never shows IDs.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed` | `limit` outside 1 to 50, or `after` not a slug |
| `404` | `Category not found` | No active category with this slug: unknown or hidden, which look the same |
| `429` | `code: "RATE_LIMITED"` | The 600 per minute limit |

## Products

### GET `/v1/products/:slug`

**Public.** A product's own page in the shop (ADR 0021). Only for a live product: active, in an active category.

Response `200`:
```json
{
  "name": "Ashwagandha Capsules",
  "slug": "ashwagandha-capsules",
  "summary": "For calm and strength",
  "description": null,
  "ingredients": "Each capsule contains: Ashwagandha root extract 500 mg",
  "usage": "1 capsule twice a day after meals",
  "type": "AYURVEDIC_MEDICINE",
  "licenceNumber": "25D/123/2015",
  "manufacturerName": "Herbal Works Pvt Ltd",
  "manufacturerAddress": "12, Industrial Area, Mysuru 570016",
  "countryOfOrigin": "India",
  "category": { "name": "Herbal Supplements", "slug": "herbal-supplements" },
  "variants": [
    { "sku": "ASH-CAP-60", "quantity": 60, "unit": "CAPSULES", "mrpRupees": 500, "priceRupees": 400, "inStock": true },
    { "sku": "ASH-CAP-120", "quantity": 120, "unit": "CAPSULES", "mrpRupees": 900, "priceRupees": 800, "inStock": false }
  ],
  "images": [
    {
      "url": "http://127.0.0.1:3000/media/products/32d470e1-c036-42a5-95c3-1b17c172e8e5-large.webp",
      "thumbnailUrl": "http://127.0.0.1:3000/media/products/32d470e1-c036-42a5-95c3-1b17c172e8e5-small.webp",
      "altText": "Ashwagandha Capsules",
      "width": 1200,
      "height": 1600
    },
    {
      "url": "http://127.0.0.1:3000/media/products/e96e8316-3b89-4c89-8c11-989ad2d6cfd0-large.webp",
      "thumbnailUrl": "http://127.0.0.1:3000/media/products/e96e8316-3b89-4c89-8c11-989ad2d6cfd0-small.webp",
      "altText": "The back label, with the ingredients",
      "width": 1600,
      "height": 1200
    }
  ]
}
```
- **The licence and maker details must be shown on the product's page:** Indian labelling rules want them.
- `images`: the product's photos, the main one first, in the order staff chose (ADR 0023). There is always at least one. Each has exactly these five fields:
  - `url`: the large file, WebP, at most 1600 pixels on its longest side;
  - `thumbnailUrl`: the small file, at most 400 pixels;
  - `altText`: describes the photo for people who cannot see it. Without a description from staff, it is the product's name;
  - `width` and `height`: the large file's size in pixels, so the page can keep room for it while it loads.

  An image has no ID in the shop: it is known by the addresses of its files.
- `variants`: the packs on sale, in the order staff chose (ADR 0022). Each has exactly these six fields:
  - `sku`: the pack's code, which identifies it (the shop shows no IDs). A customer's cart names a pack by it (see "Cart");
  - `quantity` and `unit`: the net quantity, such as 60 `CAPSULES` or 100 `G`. Units: `G`, `KG`, `ML`, `L`, `CAPSULES`, `TABLETS`, `PIECES`;
  - `mrpRupees`: the MRP printed on the pack;
  - `priceRupees`: the shop's price, never more than the MRP;
  - `inStock`: whether it can be bought today: `true` while one of its batches holds stock and has at least 6 months left before it expires (ADR 0024). The shop never shows how many.

  The list is empty while no pack is on sale. A pack on sale may still be out of stock.
- `type`:
  - `AYURVEDIC_MEDICINE`: the licence is an AYUSH licence;
  - `FOOD_OR_SUPPLEMENT`: an FSSAI licence, always 14 digits;
  - `COSMETIC`: a cosmetics licence.
- `summary`, `description` and `usage` may be `null`. A live product always has its type, licence, maker's name and address, ingredients, country and at least one image.

Errors: `404 Product not found` (no live product with this slug: unknown, a draft, or in a hidden category, which all look the same); `429` (the 600 per minute limit).

## Image files

### GET `/media/products/<key>-large.webp` and `-small.webp`

**Public.** The files behind every `url`, `thumbnailUrl` and `imageUrl` (ADR 0023). Use the addresses exactly as the API gives them: the part before `/products/` comes from the setting `MEDIA_BASE_URL`, and will be a CDN once the API is deployed.

- Always `Content-Type: image/webp`.
- `Cache-Control: public, max-age=31536000, immutable`. A file never changes: a new photo gets a new address. So a browser may keep a file for a year.
- `Cross-Origin-Resource-Policy: cross-origin`: other sites, such as the shop's website, may show the files.
- Files only. A folder, a hidden file, a path that leads out of the folder, or a file that does not exist answers `404`. Like every address outside `/v1`, that `404` is a plain HTML page, not JSON.
- No rate limit on a laptop: these files are served before the API's guards. A CDN takes this job before production.

## Cart

The signed-in customer's own cart (ADR 0025). These endpoints need a **customer** access token. The customer always comes from the token, so a customer only ever sees and changes their own cart. A staff token gets `401`.

- **A pack size is named by its SKU** in the path, exactly as a product's page shows it, such as `ASH-CAP-60`: the shop shows no IDs. The SKU is taken as it is, so `ash-cap-60` is not the same pack size.
- **At most 4 packs of one product, all its pack sizes together,** and at most 50 pack sizes in a cart.
- **The cart keeps no prices.** It always shows today's, so a price change shows at once. The price will be fixed when an order is placed.
- **The cart holds no stock.** It only shows whether each line can be bought now.
- A cart is made when its first pack goes in. **A cart nobody changes for 90 days is deleted,** with its lines (ADR 0011).

The cart, as `GET` and `PUT` return it:
```json
{
  "items": [
    {
      "product": {
        "name": "Ashwagandha Capsules",
        "slug": "ashwagandha-capsules",
        "imageUrl": "http://127.0.0.1:3000/media/products/32d470e1-c036-42a5-95c3-1b17c172e8e5-small.webp"
      },
      "sku": "ASH-CAP-60",
      "quantity": 60,
      "unit": "CAPSULES",
      "mrpRupees": 500,
      "priceRupees": 449,
      "packs": 3,
      "lineTotalRupees": 1347,
      "status": "AVAILABLE"
    },
    {
      "product": {
        "name": "Ashwagandha Capsules",
        "slug": "ashwagandha-capsules",
        "imageUrl": "http://127.0.0.1:3000/media/products/32d470e1-c036-42a5-95c3-1b17c172e8e5-small.webp"
      },
      "sku": "ASH-CAP-120",
      "quantity": 120,
      "unit": "CAPSULES",
      "mrpRupees": 900,
      "priceRupees": 799,
      "packs": 1,
      "lineTotalRupees": 799,
      "status": "OUT_OF_STOCK"
    }
  ],
  "packs": 3,
  "subtotalRupees": 1347,
  "mrpTotalRupees": 1500
}
```

| Field | Meaning |
|---|---|
| `items` | The lines, the first added first. Each shows its product's name, slug and main photo (`imageUrl`, `null` without a photo), and its pack size as on the product's page. |
| `packs` | How many packs of this pack size the line holds, 1 to 4 |
| `lineTotalRupees` | `packs` times today's `priceRupees` |
| `status` | `AVAILABLE`: on sale and in stock. `OUT_OF_STOCK`: on sale, but nothing sellable in stock (ADR 0024). `OFF_SALE`: taken off sale, or its product or category hidden. |
| `packs`, `subtotalRupees`, `mrpTotalRupees` (at the top) | What the `AVAILABLE` lines come to: how many packs, at today's prices, and at their MRPs. The other lines stay in the cart but count for nothing. |

The difference between `mrpTotalRupees` and `subtotalRupees` is what the customer saves against the MRP. Delivery and taxes are not part of the cart: prices include GST (ADR 0022), and delivery charges come with checkout.

### GET `/v1/me/cart`

Response `200`: the cart. A customer without a cart gets an empty one: `{ "items": [], "packs": 0, "subtotalRupees": 0, "mrpTotalRupees": 0 }`.

Errors: `401`; `429` (the 600 per minute limit).

### PUT `/v1/me/cart/items/:sku`

Sets how many packs of this pack size the cart holds: it adds the pack size, or changes its packs. Sending the same number again changes nothing, so a repeated request is harmless.

Request:
```json
{ "packs": 2 }
```

| Field | Rules |
|---|---|
| `packs` | A whole number from 1 to 4. To take a pack size out, delete it instead. |

- **Adding needs stock and room:** the pack size is in stock, the product's packs in all its sizes stay at 4 or fewer, and a new pack size fits within 50.
- **Fewer packs are always fine,** even for a pack out of stock.
- **Only a pack size sold now:** on sale, in a live product of an active category. Any other answers `404`, like an unknown SKU, and can only be removed.

Response `200`: the whole cart, as it is now.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed` | `packs` is missing, not a whole number, below 1 (`At least 1 pack. To take it out of the cart, delete it.`) or above 4 (`At most 4 packs of one product`) |
| `401` | see "Authentication errors on protected endpoints" | No valid customer access token, or a staff token |
| `404` | `Pack size not found` | No pack size has this SKU, or it is not sold now |
| `409` | `This pack size is out of stock.` | More packs of a pack size that is out of stock |
| `409` | `At most 4 packs of one product, all its pack sizes together. The cart already has 3 in other sizes.` | The product's packs in all its sizes would go above 4 |
| `409` | `A cart holds at most 50 pack sizes. Remove one first.` | A 51st pack size |
| `429` | `code: "RATE_LIMITED"` | The 600 per minute limit |

Two changes to one cart at the same moment are handled one after the other, and the limits count both.

### DELETE `/v1/me/cart/items/:sku`

Takes a pack size out of the cart, sold now or not. A pack size that isn't in the cart, or no longer exists, needs nothing done: the answer is the same.

Response `204 No Content`.

Errors: `401`; `429` (the 600 per minute limit).

### DELETE `/v1/me/cart`

Empties the cart: the cart goes, with its lines.

Response `204 No Content`, also for a customer without a cart.

Errors: `401`; `429` (the 600 per minute limit).

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

Every successful sign-in is written to the audit log (`staff.signed_in`, with the new session as its target), in the same transaction as the session. Failed sign-ins are not (ADR 0017).

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

## Managing categories (staff)

Product categories for staff (ADR 0020). These endpoints need a **staff** access token: an Admin's or a Super User's. **Deleting is for Super Users only.** Every change is written to the audit log, with the staff member, the client IP and the request ID.

| Endpoint | Purpose |
|---|---|
| `GET /v1/staff/categories` | List every category, hidden ones too |
| `POST /v1/staff/categories` | Create a category |
| `PATCH /v1/staff/categories/:id` | Change, activate or deactivate a category |
| `DELETE /v1/staff/categories/:id` | Delete a category (Super Users only) |

A category, as these endpoints return it:
```json
{
  "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "name": "Hair Care",
  "slug": "hair-care",
  "description": "Oils and powders for the hair",
  "isActive": false,
  "position": 0,
  "createdAt": "2026-11-03T06:15:05.292Z",
  "updatedAt": "2026-11-03T06:15:05.292Z"
}
```

The rules for each field:

| Field | Rules |
|---|---|
| `name` | 1 to 60 characters, trimmed |
| `slug` | Lowercase letters `a`–`z`, digits and single hyphens, at most 60 characters, like `hair-care`. Unique. |
| `description` | Optional, up to 500 characters, trimmed. An empty value, or `null` in a change, means none. |
| `position` | A whole number from 0 to 9999. Customers see lower numbers first. Default `0`. |
| `isActive` | `true` shows the category to customers. Default `false`. |

### GET `/v1/staff/categories`

Every category, hidden ones too, in the order customers see them. No paging: a catalog has only a few categories.

Response `200`: `{ "categories": [...] }`, each in the form above.

Errors: `401` (see "Authentication errors on protected endpoints"), also for a customer access token; `429` (the 600 per minute limit).

### POST `/v1/staff/categories`

Creates a category. Only `name` is required.

Request:
```json
{ "name": "Hair Care", "description": "Oils and powders for the hair" }
```
- **Without a `slug`, it is made from the name:** accents are dropped, and every run of other characters becomes one hyphen. `Café Crème (Natural)` becomes `cafe-creme-natural`.
- **A name without Latin letters or digits** (in Devanagari, for example) needs a `slug` too: `{ "name": "आयुर्वेद", "slug": "ayurveda" }`.
- **A new category is hidden from customers** unless `"isActive": true` is sent.
- Any other field, such as `id`, is ignored.

Response `201`: the category.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed` | A missing or invalid field, each named in `errors`. A name without Latin letters and no slug gives `The name has no Latin letters or digits: give a slug` for `slug`. |
| `401` | see "Authentication errors on protected endpoints" | No staff access token, or a customer's |
| `409` | `Another category already has this slug. Choose a different one.` | The slug, sent or made from the name, is taken |
| `429` | `code: "RATE_LIMITED"` | The 600 per minute limit |

### PATCH `/v1/staff/categories/:id`

Changes a category. Send only the fields that change: `{ "isActive": true }` activates it, and `{ "description": null }` removes the description.

- **Renaming keeps the slug,** so links keep working. Send a `slug` to change it.
- **Sending the values the category already has changes nothing,** answers `200` too, and writes no audit entry. It is safe to send the same request twice.

Response `200`: the category, as it is now.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed (uuid is expected)` | The ID is not a UUID |
| `400` | `Validation failed` | An invalid field, or an empty change (`Nothing to change`) |
| `401` | see above | No staff access token, or a customer's |
| `404` | `Category not found` | No category with this ID |
| `409` | `Another category already has this slug. Choose a different one.` | The new slug is taken |
| `429` | `code: "RATE_LIMITED"` | The 600 per minute limit |

### DELETE `/v1/staff/categories/:id`

Deletes a category for good. **Super Users only.** An Admin deactivates it instead (`{ "isActive": false }`), which hides it from customers and can be undone. The audit log keeps what was deleted.

Response `204 No Content`.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed (uuid is expected)` | The ID is not a UUID |
| `401` | see above | No staff access token, or a customer's |
| `403` | `Only a Super User may do this.` | Called by an Admin |
| `404` | `Category not found` | No category with this ID, also when it was just deleted |
| `409` | `This category still has products. Move them to another category or delete them first.` | The category still has products, live or not. The database refuses the delete. |
| `429` | `code: "RATE_LIMITED"` | The 600 per minute limit |

## Managing products (staff)

Products for staff (ADR 0021). These endpoints need a **staff** access token: an Admin's or a Super User's. **Deleting is for Super Users only.** Every change is written to the audit log, with the staff member, the client IP and the request ID.

| Endpoint | Purpose |
|---|---|
| `GET /v1/staff/products` | List every product, drafts too, one page at a time |
| `POST /v1/staff/products` | Create a product |
| `PATCH /v1/staff/products/:id` | Change it, move it to another category, activate or deactivate it |
| `DELETE /v1/staff/products/:id` | Delete a product (Super Users only) |

A product, as these endpoints return it:
```json
{
  "id": "3f2b8c1d-5e6a-4b7c-8d9e-0f1a2b3c4d5e",
  "categoryId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "name": "Ashwagandha Capsules",
  "slug": "ashwagandha-capsules",
  "summary": "For calm and strength",
  "description": null,
  "ingredients": "Each capsule contains: Ashwagandha root extract 500 mg",
  "usage": "1 capsule twice a day after meals",
  "type": "AYURVEDIC_MEDICINE",
  "licenceNumber": "25D/123/2015",
  "manufacturerName": "Herbal Works Pvt Ltd",
  "manufacturerAddress": "12, Industrial Area, Mysuru 570016",
  "countryOfOrigin": "India",
  "hsnCode": "300490",
  "gstRate": 5,
  "isActive": true,
  "position": 0,
  "createdAt": "2026-11-04T04:10:01.184Z",
  "updatedAt": "2026-11-04T04:11:30.175Z"
}
```

The rules for each field:

| Field | Rules |
|---|---|
| `categoryId` | The ID of an existing category. Required to create. |
| `name` | 1 to 100 characters, trimmed. Required to create. |
| `slug` | As for categories: lowercase letters `a`–`z`, digits and single hyphens, at most 60, unique among products. Made from the name if not sent. |
| `summary` | Optional, up to 160 characters: one line for list pages |
| `description` | Optional, up to 5000 characters |
| `ingredients` | Optional for a draft, up to 2000 characters, exactly as printed on the pack |
| `usage` | Optional, up to 2000 characters |
| `type` | `AYURVEDIC_MEDICINE`, `FOOD_OR_SUPPLEMENT` or `COSMETIC`. Optional for a draft. |
| `licenceNumber` | Optional for a draft. Letters, digits, `/`, `.` and `-`, at most 50. Spaces are dropped and letters made capitals: ` 25d / 123 / 2015 ` is stored as `25D/123/2015`. For `FOOD_OR_SUPPLEMENT`, exactly 14 digits (an FSSAI licence). |
| `manufacturerName` | Optional for a draft, up to 200 characters |
| `manufacturerAddress` | Optional for a draft, up to 500 characters |
| `countryOfOrigin` | 2 to 60 characters. Default `India`. Cannot be emptied. |
| `hsnCode` | Optional for a draft. 4, 6 or 8 digits, which classify the goods for GST. Spaces are dropped: `3004 90` is stored as `300490`. |
| `gstRate` | Optional for a draft. In percent: `0`, `5`, `18` or `40`, the rates since GST 2.0. A chartered accountant confirms the rate for each HSN code. |
| `isActive` | `true` makes it live. Default `false` (a draft). |
| `position` | A whole number from 0 to 9999, the order within its category. Default `0`. |

An empty text, or `null` in a change, means none.

**Going live:** `"isActive": true` needs `type`, `licenceNumber`, `manufacturerName`, `manufacturerAddress`, `ingredients`, `hsnCode` and `gstRate`, and **at least one image** (`images` in `errors`, ADR 0023). A pack on sale is not needed: without one, the shop shows the product with no price. The check looks at the product **as it will be saved**:
- a change can add the missing details and go live at once;
- **a new product always starts as a draft:** it has no image yet. Add its images (see "Managing product images"), then go live with a change;
- a change that removes one of the details from a live product is refused, and so is deleting its last image;
- so is a change of `type` that the stored licence no longer fits.

The answer then is `400 Validation failed`, with one entry in `errors` for each problem:
```json
{
  "message": "Validation failed",
  "errors": [
    { "field": "manufacturerAddress", "message": "Needed before the product can go live" },
    { "field": "ingredients", "message": "Needed before the product can go live" }
  ],
  "statusCode": 400,
  "requestId": "..."
}
```
The database refuses such a product too, as the last line of defence.

### GET `/v1/staff/products`

Every product, drafts too, **one page at a time**, in the order customers see them: by `position`, then by name.

Query parameters, all optional:

| Parameter | Rules | Meaning |
|---|---|---|
| `limit` | Whole number, 1 to 100, default 50 | Products per page |
| `after` | UUID | The `nextAfter` of the previous page: continue just after it |
| `categoryId` | UUID | Only this category's products |
| `isActive` | `true` or `false` | Only live products, or only drafts |

Response `200`: `{ "products": [...], "nextAfter": "<id>" }`, each product in the form above. `nextAfter` is `null` on the last page.

Errors: `400 Validation failed` (a bad parameter, named in `errors`); `401` (see "Authentication errors on protected endpoints"), also for a customer access token; `429` (the 600 per minute limit).

### POST `/v1/staff/products`

Creates a product. Only `categoryId` and `name` are required. **It is always a draft:** going live needs an image, and a new product has none yet. Sending `"isActive": true` here answers `400`, naming `images` and any detail still missing. Any other field, such as `id`, is ignored.

Request (a draft):
```json
{ "categoryId": "7c9e6679-7425-40de-944b-e07fc1f90ae7", "name": "Ashwagandha Capsules", "summary": "For calm and strength" }
```

Response `201`: the product.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed` | A missing or invalid field, `"isActive": true` (a new product has no image), or a `categoryId` with no category behind it (`No category with this ID`) |
| `401` | see "Authentication errors on protected endpoints" | No staff access token, or a customer's |
| `409` | `Another product already has this slug. Choose a different one.` | The slug, sent or made from the name, is taken |
| `429` | `code: "RATE_LIMITED"` | The 600 per minute limit |

### PATCH `/v1/staff/products/:id`

Changes a product. Send only the fields that change:
- `{ "isActive": false }` takes it out of the shop;
- `{ "categoryId": "..." }` moves it to another category.

**Renaming keeps the slug.** Sending the values the product already has changes nothing, answers `200` too, and writes no audit entry.

Response `200`: the product, as it is now.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed (uuid is expected)` | The ID is not a UUID |
| `400` | `Validation failed` | An invalid field, an empty change (`Nothing to change`), the going-live rules above, or a category that doesn't exist |
| `401` | see above | No staff access token, or a customer's |
| `404` | `Product not found` | No product with this ID |
| `409` | `Another product already has this slug. Choose a different one.` | The new slug is taken |
| `429` | `code: "RATE_LIMITED"` | The 600 per minute limit |

### DELETE `/v1/staff/products/:id`

Deletes a product for good, **with its pack sizes and its images. Super Users only.** An Admin deactivates it instead. The audit log keeps everything the product was, its pack sizes, their prices and its images included. The image files are deleted once the deletion is saved. **A product with a pack that still holds stock is never deleted:** write the stock off first (see "Managing stock").

Response `204 No Content`.

Errors: `400` (the ID is not a UUID); `401`; `403 Only a Super User may do this.` (called by an Admin); `404 Product not found`; `409 This product still has stock. Write it off first, then delete it.`; `429` (the 600 per minute limit).

## Managing pack sizes and prices (staff)

A product's packs, such as 60 capsules or 100 g, each with its MRP and price (ADR 0022). These endpoints need a **staff** access token. **Deleting is for Super Users only.** Every change, a new price included, is written to the audit log, with the staff member, the client IP and the request ID.

| Endpoint | Purpose |
|---|---|
| `GET /v1/staff/products/:productId/variants` | List every pack of a product, off sale ones too |
| `POST /v1/staff/products/:productId/variants` | Add a pack |
| `PATCH /v1/staff/variants/:id` | Change it: its prices, SKU, size or position, or take it off sale |
| `DELETE /v1/staff/variants/:id` | Delete a pack (Super Users only) |

A pack, as these endpoints return it:
```json
{
  "id": "b2c4e6f8-1a3c-4e5f-9a7b-2c4d6e8f0a1b",
  "productId": "3f2b8c1d-5e6a-4b7c-8d9e-0f1a2b3c4d5e",
  "sku": "ASH-CAP-60",
  "quantity": 60,
  "unit": "CAPSULES",
  "mrpRupees": 500,
  "priceRupees": 449,
  "isActive": true,
  "position": 0,
  "createdAt": "2026-11-05T05:12:44.018Z",
  "updatedAt": "2026-11-05T05:12:44.018Z"
}
```

The rules for each field:

| Field | Rules |
|---|---|
| `sku` | Staff's own code for the pack. 3 to 40 characters: letters, digits and single hyphens. Trimmed and made capitals: ` ash-cap-60 ` is stored as `ASH-CAP-60`. Unique across all products. Required to add. |
| `quantity` | The net quantity on the label: a whole number from 1 to 1,000,000. Required to add. |
| `unit` | `G`, `KG`, `ML`, `L`, `CAPSULES`, `TABLETS` or `PIECES`. Required to add. |
| `mrpRupees` | The MRP printed on the pack, in whole rupees: a whole number from 1 to 10,00,000. `449.50` is refused. Required to add. |
| `priceRupees` | The shop's price, with the same rules, and **never more than `mrpRupees`**. Required to add. |
| `isActive` | `true` while on sale. Default `true`. |
| `position` | A whole number from 0 to 9999, the order on the product's page. Default `0`. Packs with the same position are ordered by quantity. |

A product has each size once: a second pack of 60 `CAPSULES` is refused.

**The price is checked against the pack as it will be saved:** a change that lowers only the MRP is refused if the stored price would then be above it. The answer is `400 Validation failed`:
```json
{
  "message": "Validation failed",
  "errors": [{ "field": "priceRupees", "message": "The price may not be more than the MRP" }],
  "statusCode": 400,
  "requestId": "..."
}
```
The database refuses such a pack too.

### GET `/v1/staff/products/:productId/variants`

Every pack of the product, off sale ones too, in the order of the product's page. Not paged: a product has only a few.

Response `200`: `{ "variants": [...] }`, each pack in the form above.

Errors: `400` (the ID is not a UUID); `401` (see "Authentication errors on protected endpoints"), also for a customer access token; `404 Product not found`; `429` (the 600 per minute limit).

### POST `/v1/staff/products/:productId/variants`

Adds a pack to the product. It is on sale at once unless `"isActive": false` is sent. Customers see it while the product is live. Any other field, such as `id`, is ignored.

Request:
```json
{ "sku": "ASH-CAP-60", "quantity": 60, "unit": "CAPSULES", "mrpRupees": 500, "priceRupees": 449 }
```

Response `201`: the pack.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed` | A missing or invalid field, or a price above the MRP |
| `401` | see "Authentication errors on protected endpoints" | No staff access token, or a customer's |
| `404` | `Product not found` | No product with this ID |
| `409` | `Another pack size already has this SKU. Choose a different one.` | The SKU is taken, by this product or another |
| `409` | `This product already has a pack of this size.` | Same quantity and unit as one of its packs |
| `429` | `code: "RATE_LIMITED"` | The 600 per minute limit |

### PATCH `/v1/staff/variants/:id`

Changes a pack. Send only the fields that change:
- `{ "priceRupees": 399 }` sets a new price;
- `{ "isActive": false }` takes it off sale, and `true` puts it back.

Sending the values the pack already has changes nothing, answers `200` too, and writes no audit entry.

Response `200`: the pack, as it is now.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed (uuid is expected)` | The ID is not a UUID |
| `400` | `Validation failed` | An invalid field, an empty change (`Nothing to change`), or a price that would be above the MRP |
| `401` | see above | No staff access token, or a customer's |
| `404` | `Pack size not found` | No pack with this ID |
| `409` | the two clashes of `POST` | The new SKU or size is taken |
| `429` | `code: "RATE_LIMITED"` | The 600 per minute limit |

### DELETE `/v1/staff/variants/:id`

Deletes a pack for good. **Super Users only.** An Admin takes it off sale instead. The audit log keeps everything the pack was. **A pack that still holds stock is never deleted:** write the stock off first (see "Managing stock").

Response `204 No Content`.

Errors: `400` (the ID is not a UUID); `401`; `403 Only a Super User may do this.` (called by an Admin); `404 Pack size not found`; `409 This pack size still has stock. Write it off first, then delete it.`; `429` (the 600 per minute limit).

## Managing product images (staff)

A product's photos (ADR 0023). These endpoints need a **staff** access token. **Admins may delete images too,** unlike categories, products and packs: replacing a photo is everyday work. Every change is written to the audit log, with the staff member, the client IP and the request ID.

| Endpoint | Purpose |
|---|---|
| `GET /v1/staff/products/:productId/images` | List every image of a product, main photo first |
| `POST /v1/staff/products/:productId/images` | Upload one image |
| `PATCH /v1/staff/images/:id` | Describe it, or move it |
| `DELETE /v1/staff/images/:id` | Delete it, with its files |

An image, as these endpoints return it:
```json
{
  "id": "9e783ece-f6d7-4547-a609-bfd8b4b21829",
  "productId": "48f2a064-5078-44bd-ab3e-63c563c65f13",
  "width": 1200,
  "height": 1600,
  "altText": null,
  "position": 0,
  "createdAt": "2026-11-06T07:27:21.665Z",
  "updatedAt": "2026-11-06T07:27:21.665Z",
  "url": "http://127.0.0.1:3000/media/products/32d470e1-c036-42a5-95c3-1b17c172e8e5-large.webp",
  "thumbnailUrl": "http://127.0.0.1:3000/media/products/32d470e1-c036-42a5-95c3-1b17c172e8e5-small.webp"
}
```

| Field | Rules |
|---|---|
| `altText` | Optional, up to 150 characters, trimmed. It describes the photo for people who cannot see it, such as "The back label, with the ingredients". An empty text or `null` removes it, and the shop then uses the product's name. |
| `position` | A whole number from 0 to 9999. Default `0`. Images are listed by position, then the oldest first. The first is the main photo. |

The upload sets everything else: the two files, their addresses, and the large file's `width` and `height`.

**Two rules,** checked after a lock on the product, and again by the database:
- a product has **at most 6 images**;
- a **live product keeps at least 1**.

### GET `/v1/staff/products/:productId/images`

Every image of the product, the main photo first. Not paged: a product has at most 6.

Response `200`: `{ "images": [...] }`, each image in the form above.

Errors: `400` (the ID is not a UUID); `401` (see "Authentication errors on protected endpoints"), also for a customer access token; `404 Product not found`; `429` (the 600 per minute limit).

### POST `/v1/staff/products/:productId/images`

Uploads one image. **The request body is the image itself,** not JSON and not a form:
- its `Content-Type` is `image/jpeg`, `image/png` or `image/webp`, and must match the file;
- at most 10 MB, not compressed;
- one image per request.

For example, in PowerShell:
```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/v1/staff/products/$id/images" -Headers $auth -ContentType 'image/jpeg' -InFile 'C:\photos\front.jpg'
```

The API checks the file and keeps only a new copy of its pixels (ADR 0023):
- its first bytes must show the type its `Content-Type` claims;
- at most 50 megapixels, and at least 400 pixels on each side, both read before anything is decoded;
- two WebP files are made, at most 1600 and 400 pixels on their longest side, never enlarged and turned upright. The photo's hidden details, such as its GPS location, are not kept.

The new image gets `position` `0`, so it comes after the images already at position 0. To make it the main photo, give the others a higher position.

Response `201`: the image.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed (uuid is expected)` | The product ID is not a UUID |
| `400` | `Validation failed`, on `image` | `The file is not a JPEG image` (or PNG, or WebP); `The image could not be read. It may be damaged.`; `The image may have at most 50 megapixels`; `The image needs at least 400 pixels on each side` |
| `401` | see "Authentication errors on protected endpoints" | No staff access token, or a customer's. **An upload without a valid staff token is never read:** for a large one, the client may see the connection closed instead of the `401`. |
| `404` | `Product not found` | No product with this ID |
| `409` | `A product has at most 6 images. Delete one first.` | The product has 6 already |
| `413` | `Request body too large` | More than 10 MB |
| `415` | `Send one JPEG, PNG or WebP image as the request body, with its Content-Type` | Any other body, JSON included |
| `415` | `Invalid request` | A compressed body |
| `429` | `code: "RATE_LIMITED"` | 120 uploads per hour from this IP, or the 600 per minute limit |
| `503` | `code: "SERVER_BUSY"` | 2 images are being checked and 10 more are waiting. Wait the `Retry-After` seconds. |

### PATCH `/v1/staff/images/:id`

Changes an image's description or its place. The photo itself never changes: a new photo is a new upload. Send only what changes:
- `{ "altText": "The back label, with the ingredients" }`;
- `{ "position": 1 }`.

Sending the values the image already has changes nothing, answers `200` too, and writes no audit entry.

Response `200`: the image, as it is now.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed (uuid is expected)` | The ID is not a UUID |
| `400` | `Validation failed` | An invalid field, or an empty change (`Nothing to change`) |
| `401` | see above | No staff access token, or a customer's |
| `404` | `Image not found` | No image with this ID |
| `429` | `code: "RATE_LIMITED"` | The 600 per minute limit |

### DELETE `/v1/staff/images/:id`

Deletes an image for good, with its two files. **Admins and Super Users alike.** The audit log keeps what the image was.

Response `204 No Content`.

Errors: `400` (the ID is not a UUID); `401`; `404 Image not found`; `409 A live product needs at least one image. Add another first, or take the product offline.`; `429` (the 600 per minute limit).

## Managing stock (staff)

The stock of each pack size, batch by batch, in one warehouse (ADR 0024). These endpoints need a **staff** access token: an Admin's or a Super User's. **Nothing here is deleted:** every change is a movement, and a mistake is put right by another movement. Every change is written to the audit log, with the staff member, the client IP and the request ID.

| Endpoint | Purpose |
|---|---|
| `GET /v1/staff/variants/:variantId/batches` | List a pack size's batches, with its packs on hand and how many may be sold |
| `POST /v1/staff/variants/:variantId/batches` | Receive a delivery: a new batch |
| `PATCH /v1/staff/batches/:id` | Correct a batch's label details |
| `GET /v1/staff/batches/:id/movements` | A batch's history, newest first |
| `POST /v1/staff/batches/:id/movements` | Change a batch's stock |

A batch, as these endpoints return it:
```json
{
  "id": "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1",
  "variantId": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  "batchNumber": "AB2611",
  "manufacturedOn": "2026-10-01",
  "expiresOn": "2028-09-30",
  "quantity": 118,
  "createdAt": "2026-11-06T05:49:34.102Z",
  "updatedAt": "2026-11-06T05:51:55.417Z",
  "sellable": true
}
```

| Field | Rules |
|---|---|
| `batchNumber` | As printed on the pack: 1 to 40 letters, digits, `/`, `.` and `-`. Spaces are dropped and letters made capitals: ` ab 2611 ` is stored as `AB2611`. Unique within its pack size. |
| `manufacturedOn`, `expiresOn` | Dates as on the label, such as `2026-10-31`. Another form, or an impossible date, answers `Use a date like 2026-10-31`. The expiry is after the manufacturing date, and the manufacturing date is not in the future. "Today" is India's date. |
| `quantity` | The packs on hand: changed only by movements, never below 0 |
| `sellable` | Whether the batch may be sold today: it expires on or after today plus 6 months (on 6 November 2026, from 6 May 2027) |

### GET `/v1/staff/variants/:variantId/batches`

Every batch of the pack size, the first to expire first, which is the order in which orders will take them.

Response `200`:
```json
{ "batches": [...], "quantity": 148, "sellableQuantity": 118 }
```
- `quantity`: every pack on hand, in all batches;
- `sellableQuantity`: those in sellable batches. The shop shows the pack size as in stock while this is above 0.

Errors: `400` (the ID is not a UUID); `401` (see "Authentication errors on protected endpoints"), also for a customer access token; `404 Pack size not found`; `429` (the 600 per minute limit).

### POST `/v1/staff/variants/:variantId/batches`

Receives a delivery. One transaction creates the batch, its first movement (`RECEIVED`) and the audit entry.

Request:
```json
{ "batchNumber": "AB2611", "manufacturedOn": "2026-10-01", "expiresOn": "2028-09-30", "quantity": 120, "note": "First delivery" }
```
- `quantity`: from 1 to 1,000,000 packs. `note`: optional, up to 200 characters.
- A batch that is too short-dated to sell may still be received. It shows `"sellable": false`.

Response `201`: the batch.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed` | A missing or invalid field; `The manufacturing date cannot be in the future`; `This batch has already expired`; `The expiry date must be after the manufacturing date` |
| `401` | see "Authentication errors on protected endpoints" | No staff access token, or a customer's |
| `404` | `Pack size not found` | No pack size with this ID |
| `409` | `This pack size already has a batch with this number.` | The batch number is taken in this pack size |
| `429` | `code: "RATE_LIMITED"` | The 600 per minute limit |

### PATCH `/v1/staff/batches/:id`

Corrects a batch's label details: `batchNumber`, `manufacturedOn` or `expiresOn`. Its stock never changes here: `quantity` is ignored. The dates are checked on the batch as it will be: not made in the future, and expiring after it was made. A batch that has expired can still be corrected. Sending what the label already says changes nothing, answers `200` too, and writes no audit entry.

Response `200`: the batch, as it is now.

Errors: `400` (the ID is not a UUID, an invalid field, `Nothing to change`, or dates that no longer fit); `401`; `404 Batch not found`; `409 This pack size already has a batch with this number.`; `429` (the 600 per minute limit).

### GET `/v1/staff/batches/:id/movements`

The batch's movements, **newest first, one page at a time**.

Query parameters, both optional:

| Parameter | Rules | Meaning |
|---|---|---|
| `limit` | Whole number, 1 to 100, default 50 | Movements per page |
| `before` | UUID | The `nextBefore` of the previous page: continue just after it |

Response `200`:
```json
{
  "movements": [
    { "id": "…", "batchId": "…", "change": -2, "reason": "DAMAGED", "note": "Broken seal", "actorId": "…", "createdAt": "2026-11-06T05:51:55.417Z" },
    { "id": "…", "batchId": "…", "change": 120, "reason": "RECEIVED", "note": "First delivery", "actorId": "…", "createdAt": "2026-11-06T05:49:34.102Z" }
  ],
  "nextBefore": null
}
```

Errors: `400` (a bad ID or parameter); `401`; `404 Batch not found`; `429` (the 600 per minute limit).

### POST `/v1/staff/batches/:id/movements`

Changes the batch's stock. The batch is locked first, so the check sees its real quantity.

Request:
```json
{ "change": -2, "reason": "DAMAGED", "note": "Broken seal" }
```

| Field | Rules |
|---|---|
| `change` | A whole number from -1,000,000 to 1,000,000, never 0 |
| `reason` | `RECEIVED` (more of this batch arrived: `change` above 0), `DAMAGED` or `EXPIRED` (written off: `change` below 0), or `CORRECTION` (a count found a difference: either way) |
| `note` | Up to 200 characters. **Required for a `CORRECTION`:** say why the count differs. |

Response `201`: the batch, as it is now.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed` | An invalid field; a sign that doesn't fit the reason (`A delivery adds stock: use a positive number`, `A write-off removes stock: use a negative number`); `A change of 0 changes nothing`; a correction without a note (`Say why the count differs`); or `This batch has already expired` (more of an expired batch cannot be received; it can still be written off) |
| `401` | see above | No staff access token, or a customer's |
| `404` | `Batch not found` | No batch with this ID |
| `409` | `Not enough stock: this batch holds 118.` | The change would take the batch below 0 |
| `429` | `code: "RATE_LIMITED"` | The 600 per minute limit |

## Audit log (Super Users only)

### GET `/v1/staff/audit-log`

The append-only audit log: every staff change and every successful staff sign-in, **newest first, one page at a time**. Needs a **Super User's** staff access token. Reading the log is not itself audited (ADR 0017).

Query parameters, all optional:

| Parameter | Rules | Meaning |
|---|---|---|
| `limit` | Whole number, 1 to 100, default 50 | Entries per page |
| `before` | UUID | The `nextBefore` of the previous page: continue just after it |
| `action` | Like `thing.verb`, for example `admin.removed` | Only this action |
| `actorId` | UUID | Only what this account did |
| `targetId` | 1 to 100 characters | Only entries about this target, for example an Admin's, a category's, a product's, a pack's, an image's or a batch's ID |

The filters combine. Any other parameter is ignored.

Response `200`:
```json
{
  "entries": [
    {
      "id": "1ebda37e-6c2d-4f41-9a7b-2c0d5e8f4a13",
      "createdAt": "2026-10-31T16:26:02.408Z",
      "action": "admin.removed",
      "actorId": "5d1e8c2a-7b3f-4e9a-a1c6-2f8d0b4e7a93",
      "actor": { "id": "5d1e8c2a-7b3f-4e9a-a1c6-2f8d0b4e7a93", "email": "dev.super1@example.com", "fullName": "Dev Super One", "role": "SUPER_USER" },
      "targetType": "user",
      "targetId": "fc13b599-bdcb-4f62-8c45-42148baaddf7",
      "target": null,
      "before": { "email": "dev.admin2@example.com", "fullName": "Dev Admin Two", "status": "ACTIVE", "mfaEnabledAt": null, "invitationAcceptedAt": null },
      "after": null,
      "ip": "127.0.0.1",
      "requestId": "fe5c63ec-..."
    }
  ],
  "nextBefore": "1ebda37e-6c2d-4f41-9a7b-2c0d5e8f4a13"
}
```
- `actor`: the account that acted, or `null` for the developer commands or an account that no longer exists. `actorId` stays either way.
- `target`: the account an entry is about, for user targets only. It is `null` for other targets, such as the session of a `staff.signed_in`, a category, a product, a pack, an image or a batch, and for removed accounts.
- `before` and `after`: the relevant fields before and after the change, never a password, secret or token.
- `nextBefore`: send it as `?before=` to get the next, older page. It is `null` on the last page.

Actions today: `super_user.created`, `staff.mfa_set_up`, `staff.signed_in`, `admin.invited`, `admin.invite_accepted`, `admin.invitation_resent`, `admin.disabled`, `admin.enabled`, `admin.removed`, since part 4A `category.created`, `category.updated` (with only the fields that changed) and `category.deleted` (with what was deleted), since part 4B `product.created`, `product.updated` and `product.deleted`, which work the same way, since part 4C `variant.created`, `variant.updated` and `variant.deleted` for pack sizes, since part 4D `image.created`, `image.updated` and `image.deleted` for product images, and since part 5 `batch.received`, `batch.updated` and `stock.changed` for stock (with the quantity before and after, the change, the reason and the note). A price change is a `variant.updated` with the old and new price. A `product.deleted` entry also keeps the product's packs and images, in `before.variants` and `before.images`. A development database may also hold `dev.append_only_check`, the entry that tested the append-only triggers in part 3B-1.

Errors: `400 Validation failed` (a bad parameter, named in `errors`); `401` and `403` (as for the Admin endpoints); `429` (the 600 per minute limit).

Rules for clients:
- **Page with `nextBefore`, never by counting.** New entries arrive at the top all the time, and the cursor keeps the pages stable.
- An unknown `before` gives an empty page.

## Not yet implemented

Changing the email address, a verified phone number, deleting an account, a list of active sessions, and staff password changes. Of the catalog: search. Checkout and orders, with their delivery charges, GST invoices and payments. Of stock: reservations, which come with orders (a cart holds no stock, ADR 0025), and a list of batches near their expiry. Image files from object storage behind a CDN, before production. See `docs/requirements.md`, ADR 0007, ADR 0014 to ADR 0025 and `docs/security.md`.
