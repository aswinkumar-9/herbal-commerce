# API specification

Status: **Draft v0.36.** Describes only the endpoints that exist today. OpenAPI documentation will be generated later (ADR 0002).

Base path: `/v1` for business endpoints. Health endpoints are unversioned. Image files are served at `/media` (see "Image files").

## Conventions

- **JSON only.** Request bodies must be JSON (`Content-Type: application/json`), at most 100 kB and not compressed. A form body fails validation (`400`), a compressed body gets `415` and a larger body gets `413` (ADR 0008). The one exception is the image upload, whose body is the image itself (see "Managing product images").
- Every response carries an `X-Request-Id` header. A client may send its own `X-Request-Id` (8 to 64 characters of letters, digits, `_` or `-`); otherwise one is generated.
- **IDs in paths** are UUIDs. Any other value gets `400` with `"message": "Validation failed (uuid is expected)"`, before any other work.
- **Money** is a whole number, and its field name says the unit: `priceRupees: 449` is ₹449. Every amount is whole rupees, an order's too (ADR 0026), and so is everything about paying: Razorpay's payment page wants paise, and the app multiplies `totalRupees` by 100 itself (ADR 0027). Prices include GST (ADR 0022), so a GST amount, such as an order's `itemsGstRupees`, says how much of a price is GST: it is never added to a total.
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
| `code` | Only when a client must react to one specific case. Stable, in capitals. Today: `ACCOUNT_DISABLED`, `RATE_LIMITED`, `SERVER_BUSY`, `PAYMENTS_UNAVAILABLE`. |
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

Three answers mean "try again later". All carry a **`Retry-After`** header with the number of seconds to wait.

| Status | Body | Meaning |
|---|---|---|
| `429` | `{ "message": "Too many requests. Please try again later.", "code": "RATE_LIMITED" }` | You sent too much: a rate limit is used up, or a sign-in block is running |
| `503` | `{ "message": "The server is busy. Please try again in a few seconds.", "code": "SERVER_BUSY" }` | The server is too busy checking passwords, or checking uploaded images, right now (`Retry-After: 5`) |
| `503` | `{ "message": "Payments are not available right now. Please try again in a minute.", "code": "PAYMENTS_UNAVAILABLE" }` | Razorpay can't be reached, or refused our request, while starting or confirming a payment, or handling a webhook (`Retry-After: 30`) |

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
| Placing an order (`POST me/orders`) | client IP | 30 per hour |
| Starting a payment (`POST me/orders/:id/payment`) | client IP | 60 per hour |
| Confirming a payment (`POST me/orders/:id/payment/confirm`) | client IP | 60 per hour |
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

**Public.** The product categories customers see, with or without a token (ADR 0020). Only **active** top categories, each with its active **subcategories** (since part 15A), ordered as staff chose: by `position`, then by name, the subcategories among themselves.

Response `200`:
```json
{
  "categories": [
    {
      "name": "Hair Care",
      "slug": "hair-care",
      "description": "Oils and powders for the hair",
      "subcategories": [
        { "name": "Hair Oils", "slug": "hair-oils", "description": null }
      ]
    },
    { "name": "Herbal Teas", "slug": "herbal-teas", "description": null, "subcategories": [] }
  ]
}
```
- Each category has exactly these four fields, and each subcategory the first three. `description` may be `null`.
- **Only two levels:** a top category may hold products of its own as well as subcategories, and a subcategory holds only products. A subcategory of a hidden top category is hidden with it.
- `slug` is the readable part of a web address (`/categories/hair-care`): lowercase letters, digits and single hyphens. Use it in links. It stays the same when a category is renamed. Slugs are unique across both levels, so a subcategory has its own page too (`/categories/hair-oils`).
- An empty list while no category is active.

Errors: `429` (the 600 per minute limit).

### GET `/v1/categories/:slug/products`

**Public.** A category's page in the shop: the category, with the top category it sits in or its subcategories, and one page of the products shown in it (ADR 0021): its own, and those whose main category is another but which are also shown here (since part 15A). Only **live** products are listed: those that are active, with a main category customers see. The order is the one staff chose for this category, by place, then by name.

Query parameters, both optional:

| Parameter | Rules | Meaning |
|---|---|---|
| `limit` | Whole number, 1 to 50, default 20 | Products per page |
| `after` | A product's slug | The `nextAfter` of the previous page: continue just after it |

Response `200`:
```json
{
  "category": {
    "name": "Herbal Supplements",
    "slug": "herbal-supplements",
    "description": null,
    "parent": null,
    "subcategories": [
      { "name": "Immunity", "slug": "immunity", "description": null }
    ]
  },
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
- `category.parent`: for a subcategory, the top category it sits in, as `{ "name", "slug" }`; `null` for a top category (since part 15A).
- `category.subcategories`: a top category's active subcategories, in the order staff chose, each with `name`, `slug` and `description`. Always empty for a subcategory.
- **A subcategory's products are not listed here.** They are on the subcategory's own page, which the shop links to.
- Each product has exactly these five fields. Its page has the rest (below).
- `fromPriceRupees`: the lowest price among the product's packs on sale, for "from ₹400". It is `null` while no pack is on sale (ADR 0022).
- `imageUrl`: the small file of the product's main photo, at most 400 pixels on its longest side (ADR 0023). A live product always has an image.
- `nextAfter`: send it as `?after=` for the next page. It is `null` on the last page.
- The shop never shows IDs.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed` | `limit` outside 1 to 50, or `after` not a slug |
| `404` | `Category not found` | No category customers see with this slug: unknown, hidden, or a subcategory of a hidden one, which all look the same |
| `429` | `code: "RATE_LIMITED"` | The 600 per minute limit |

## Brands

### GET `/v1/brands`

**Public.** The brands customers can shop by, for the shop's brand filter (since part 15B). Only brands with at least one **live** product: active, with a main category customers see. By name.

Response `200`:
```json
{
  "brands": [
    { "name": "Himalaya", "slug": "himalaya" }
  ]
}
```
- Each brand has exactly these two fields. The shop never shows IDs.
- `slug`: use it as the search's `brand` filter (`/v1/products?brand=himalaya`). It stays the same when a brand is renamed.
- A brand whose products are all drafts or hidden isn't listed. No paging: a shop has only a few.

Errors: `429` (the 600 per minute limit).

## Products

### GET `/v1/products`

**Public.** The shop's search (ADR 0030): live products, active and in a category customers see, found by words in their name, brand, summary or description, and filtered by category, brand, type and price. Words may be part of a word, or misspelt: "ashwa" and "ashwaganda" both find Ashwagandha. Without words, it lists every live product.

Query parameters, all optional:

| Parameter | Rules | Meaning |
|---|---|---|
| `q` | 2 to 100 characters, after trimming; each run of spaces becomes one; empty means none | The search words. Since part 15B they find a product by its brand's name too, which counts as much as its own name: "himalaya" finds Himalaya's products. |
| `category` | A category's slug | Only that category, and for a top category its subcategories too (since part 15A). Products also shown in it are found too. A hidden or unknown one finds nothing. |
| `brand` | A brand's slug | Only that brand's products (since part 15B). An unknown one finds nothing. |
| `type` | `AYURVEDIC_MEDICINE`, `FOOD_OR_SUPPLEMENT` or `COSMETIC` | Only that type |
| `minPriceRupees`, `maxPriceRupees` | Whole numbers, 0 to 1000000; the lowest not above the highest | The product's lowest price on sale is within them. A product with no pack on sale is then never found. |
| `sort` | `relevance`, `price-asc`, `price-desc` or `name` | Default: `relevance` with words, `name` without. `relevance` needs words. |
| `page` | Whole number, 1 to 100, default 1 | The page |
| `limit` | Whole number, 1 to 50, default 20 | Products per page |

**Products in stock always come first,** then by the sort asked for, then by name, then by slug, so the same search answers in the same order every time. By price, a product with no pack on sale comes last.

Response `200`:
```json
{
  "products": [
    {
      "name": "Ashwagandha Capsules",
      "slug": "ashwagandha-capsules",
      "summary": "For calm and strength",
      "fromPriceRupees": 400,
      "imageUrl": "http://127.0.0.1:3000/media/products/32d470e1-c036-42a5-95c3-1b17c172e8e5-small.webp",
      "inStock": true
    }
  ],
  "total": 1,
  "page": 1,
  "nextPage": null
}
```
- Each product has exactly these six fields: those of a category page's card, and `inStock`, true when any of its packs on sale is in stock.
- `total`: how many products were found. `nextPage`: the next page's number, or `null` on the last page.
- Up to 500 products are weighed for one search (ADR 0030).
- The search words are never stored, and the request log shows them as `q=[REDACTED]`.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed` | A parameter breaks its rule. Each error names it: `Search with at least 2 characters`, `Search with at most 100 characters`, `Give a price in whole rupees`, `The lowest price is above the highest`, `Sorting by relevance needs search words`, and so on. |
| `429` | `code: "RATE_LIMITED"` | 120 searches per minute per IP, or the 600 per minute limit |

### GET `/v1/products/:slug`

**Public.** A product's own page in the shop (ADR 0021). Only for a live product: active, in a category customers see. That is an active category, and for a subcategory, one inside an active top category (since part 15A).

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
  "category": { "name": "Herbal Supplements", "slug": "herbal-supplements", "parent": null },
  "brand": { "name": "Himalaya", "slug": "himalaya" },
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
- `brand`: its brand's name and slug, or `null` for a product without one (since part 15A).
- `category.parent`: when its category is a subcategory, the top category it sits in, as `{ "name", "slug" }`; otherwise `null` (since part 15A).
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

Errors: `404 Product not found` (no live product with this slug: unknown, a draft, or in a hidden category or a subcategory of a hidden one, which all look the same); `429` (the 600 per minute limit).

## Image files

### GET `/media/products/<key>-large.webp` and `-small.webp`

**Public.** The files behind every `url`, `thumbnailUrl` and `imageUrl` (ADR 0023). Use the addresses exactly as the API gives them: the part before `/products/` comes from the setting `MEDIA_BASE_URL`, and will be a CDN once the API is deployed.

- Always `Content-Type: image/webp`.
- `Cache-Control: public, max-age=31536000, immutable`. A file never changes: a new photo gets a new address. So a browser may keep a file for a year.
- `Cross-Origin-Resource-Policy: cross-origin`: other sites, such as the shop's website, may show the files.
- Files only. A folder, a hidden file, a path that leads out of the folder, or a file that does not exist answers `404`. Like every address outside `/v1`, that `404` is a plain HTML page, not JSON.
- No rate limit on a laptop: these files are served before the API's guards. A CDN takes this job before production.

## Policy pages

### GET `/v1/policies/:page`

**Public.** A policy page as the website shows it: the newest version a Super User published (ADR 0040). `:page` is `privacy`, `terms`, `refunds`, `shipping` or `contact`.

Response `200`:
```json
{
  "page": "privacy",
  "version": 3,
  "body": "We keep only what we need to send your order.\n\n## What we keep\n\n- Your name and email address\n- Your delivery addresses",
  "publishedAt": "2026-11-21T10:42:07.512Z"
}
```
- `body` is plain text, never HTML. Read it with its three marks: a blank line between paragraphs (a single line break stays one), a line starting `## ` is a heading, and a line starting `- ` or `• ` is an item of a list. Anything else, `<b>` too, is text to show as written. `packages/design/src/text-marks.ts` reads it.
- At most 30,000 characters, with Unix line ends.
- Who published it is not shown.

Errors:

| Status | `message` | When |
|---|---|---|
| `404` | `This page has not been published yet` | A known page with no version yet. The website says it is still being written |
| `404` | `Policy page not found` | Any other word |
| `429` | | The 600 per minute limit |

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

The difference between `mrpTotalRupees` and `subtotalRupees` is what the customer saves against the MRP. Delivery and taxes are not part of the cart: prices include GST (ADR 0022), and the delivery charge comes with checkout (see "Checkout and orders").

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
- **Only a pack size sold now:** on sale, in a live product: active, in a category customers see. Any other answers `404`, like an unknown SKU, and can only be removed.

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

## Checkout and orders

The signed-in customer's own orders (ADR 0026). These endpoints need a **customer** access token, and a staff token gets `401`. The customer always comes from the token: **another customer's order answers `404`**, exactly like one that does not exist.

- **An order is placed from the whole cart,** at today's prices, to one of the customer's own addresses. Every line must be `AVAILABLE` (see "Cart"): there are no partial orders.
- **It keeps a copy** of its lines, their prices and the delivery address. What the customer agreed to never changes, and an order is never deleted.
- **It takes its stock at once and holds it for 15 minutes,** until `holdExpiresAt`, while the customer pays (see "Paying for an order"). An order not paid by then expires within about a minute, and its stock comes back.
- **At most 3 orders wait for payment** per customer.
- **Once paid, the shop packs it, ships it and delivers it** (ADR 0028), and the order shows each step, with the courier and its tracking number. It may be cancelled until it ships, and a paid order's payment then goes back in full.
- **Money is whole rupees.** GST is **inside** the prices, never added: `gstRupees` and `itemsGstRupees` say how much of an amount is GST, rounded to the nearest rupee. Delivery costs ₹49 while the items come to less than ₹499, and is free from ₹499. The total is the items plus delivery.

An order, as `POST /v1/me/orders`, `GET /v1/me/orders/:id` and the cancel return it:
```json
{
  "id": "4f7c2a9e-3b1d-4e8a-9c6f-2d5b8e1a7c30",
  "reference": "7KQ2M9XDPA",
  "status": "PENDING_PAYMENT",
  "holdExpiresAt": "2026-11-07T14:57:38.771Z",
  "createdAt": "2026-11-07T14:42:38.771Z",
  "packedAt": null,
  "shippedAt": null,
  "courierName": null,
  "trackingNumber": null,
  "deliveredAt": null,
  "itemsTotalRupees": 1347,
  "itemsGstRupees": 64,
  "deliveryChargeRupees": 0,
  "totalRupees": 1347,
  "items": [
    {
      "sku": "ASH-CAP-60",
      "productName": "Ashwagandha Capsules",
      "quantity": 60,
      "unit": "CAPSULES",
      "packs": 3,
      "mrpRupees": 500,
      "priceRupees": 449,
      "lineTotalRupees": 1347,
      "gstRate": 5,
      "gstRupees": 64
    }
  ],
  "delivery": {
    "fullName": "Asha K",
    "phone": "9845012345",
    "line1": "12, 3rd Cross, Indiranagar",
    "line2": null,
    "city": "Bengaluru",
    "state": "Karnataka",
    "pincode": "560038"
  },
  "payment": null
}
```

| Field | Meaning |
|---|---|
| `reference` | 10 letters and digits, without `I`, `O`, `0` or `1`. Show it to the customer: support asks for it. It is random, never a running number. |
| `status` | `PENDING_PAYMENT`: waiting for payment, and holding its stock. `PAID`: paid. `PACKED`: packed by the shop. `SHIPPED`: on its way with the courier. `DELIVERED`: delivered. `CANCELLED`: cancelled before it shipped, by the customer or by the shop. `EXPIRED`: not paid in time. An expired order can still become `PAID` if a late payment finds its stock free (see "Paying for an order"). |
| `holdExpiresAt` | Until when the order holds its stock: 15 minutes after `createdAt` |
| `packedAt`, `shippedAt`, `deliveredAt` | When the shop packed it, handed it to the courier and marked it delivered, or `null` until then (ADR 0028). A packed order that was cancelled keeps its `packedAt`. |
| `courierName`, `trackingNumber` | The courier and its tracking number, from when the order ships, or `null` until then. Show them, so the customer can follow the parcel on the courier's site. |
| `itemsTotalRupees` | The lines added up |
| `itemsGstRupees` | The GST inside `itemsTotalRupees`: the lines' `gstRupees` added up. **It is not added to the total.** |
| `deliveryChargeRupees` | `49` while the items come to less than ₹499, otherwise `0` |
| `totalRupees` | `itemsTotalRupees` plus `deliveryChargeRupees`: what the customer pays |
| `items` | The lines, in the cart's order. Each names its pack size by SKU, with the product's name, the size, `packs`, the MRP and price when the order was placed, `lineTotalRupees` (`packs` times `priceRupees`), the GST rate in percent and the GST inside the line (`gstRupees`). |
| `delivery` | A copy of the address, as it was when the order was placed |
| `payment` | `null` until paying starts. Then `paidAt` (`null` until paid) and `refunds`: any money going back, each with `amountRupees`, `reason` and `status`, and when it was made (see "Paying for an order"). Razorpay's IDs are never shown. |

### GET `/v1/me/checkout`

What the cart would cost as an order now, by the same rules as placing it. Show it before the customer places the order, and send its `totalRupees` with the order.

Response `200`:
```json
{
  "items": [
    {
      "sku": "ASH-CAP-60",
      "productName": "Ashwagandha Capsules",
      "quantity": 60,
      "unit": "CAPSULES",
      "packs": 1,
      "mrpRupees": 500,
      "priceRupees": 449,
      "gstRate": 5,
      "lineTotalRupees": 449,
      "gstRupees": 21
    }
  ],
  "itemsTotalRupees": 449,
  "itemsGstRupees": 21,
  "deliveryChargeRupees": 49,
  "totalRupees": 498
}
```

Errors:

| Status | Body | When |
|---|---|---|
| `401` | see "Authentication errors on protected endpoints" | No valid customer access token, or a staff token |
| `409` | `The cart is empty.` | Nothing in the cart |
| `409` | `These packs can't be ordered now: ASH-CAP-60. Change or remove them first.` | A line is not `AVAILABLE`. Each such SKU is named. |
| `409` | `The total has changed. Check the cart and try again.` | A pack size in the cart was deleted a moment ago |
| `429` | `code: "RATE_LIMITED"` | The 600 per minute limit |

### POST `/v1/me/orders`

Places an order from the whole cart. One transaction prices the lines, checks the total, takes the stock from the batches that expire first, and empties the cart. A refused order changes nothing.

**Header `Idempotency-Key`:** a new UUID for each order the customer means to place. Make it when the customer taps "Place order", and send the same one again only to retry that request. **The same key again answers the order it placed the first time,** and places nothing, whatever the body.

Request:
```json
{ "addressId": "6f2b9d1e-4c7a-4e3b-9a85-1d2c3e4f5a6b", "totalRupees": 498 }
```

| Field | Rules |
|---|---|
| `addressId` | One of the customer's own addresses |
| `totalRupees` | The `totalRupees` the checkout showed, a whole number from 1. If the total is different now, the order is refused. |

Response `201`: the order, `PENDING_PAYMENT`. A repeated key gets the same answer.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed` | No `Idempotency-Key`, or not a UUID (`Send an Idempotency-Key header: a new UUID for each order`, with the `field` `Idempotency-Key`); `addressId` not a UUID (`Choose one of your delivery addresses`); `totalRupees` missing, or not a whole number from 1 |
| `401` | see "Authentication errors on protected endpoints" | No valid customer access token, or a staff token |
| `404` | `Address not found` | The address is not one of the customer's own |
| `409` | `The cart is empty.` | Nothing in the cart |
| `409` | `These packs can't be ordered now: ASH-CAP-60. Change or remove them first.` | As for the checkout |
| `409` | `The total has changed. Check the cart and try again.` | `totalRupees` is not today's total, or a pack size was deleted a moment ago. Show the checkout again. |
| `409` | `You have 3 orders waiting for payment. Pay for one or cancel it first.` | 3 of the customer's orders wait for payment |
| `409` | `ASH-CAP-60 is out of stock, or not enough of it is left. Change it in the cart and try again.` | Other orders took the last packs in between |
| `429` | `code: "RATE_LIMITED"` | 30 orders per hour per IP, or the 600 per minute limit |

Two orders from one cart at the same moment take turns. The second finds the cart empty, or, with the same key, the first order.

### GET `/v1/me/orders`

The customer's orders, **newest first, one page at a time**.

Query parameters, both optional:

| Parameter | Rules | Meaning |
|---|---|---|
| `limit` | Whole number, 1 to 50, default 20 | Orders per page |
| `before` | UUID | The `nextBefore` of the previous page: continue just after it |

Response `200`:
```json
{
  "orders": [
    {
      "id": "4f7c2a9e-3b1d-4e8a-9c6f-2d5b8e1a7c30",
      "reference": "7KQ2M9XDPA",
      "status": "CANCELLED",
      "totalRupees": 1347,
      "holdExpiresAt": "2026-11-07T14:57:38.771Z",
      "createdAt": "2026-11-07T14:42:38.771Z",
      "firstProductName": "Ashwagandha Capsules",
      "moreProducts": 2
    }
  ],
  "nextBefore": null
}
```
`nextBefore` is `null` on the last page.

Since part 14D, each order says what is in it at a glance, for a list such as "Ashwagandha Capsules and 2 more": `firstProductName` is the product of its first line, and `moreProducts` how many other products it has. Two pack sizes of one product count as one. An order always has a line, so `firstProductName` is `null` only for one that has none.

Errors: `400` (a bad parameter); `401`; `429` (the 600 per minute limit).

### GET `/v1/me/orders/:id`

Response `200`: the order, with its lines and delivery address.

Errors: `400` (the ID is not a UUID); `401`; `404 Order not found`, also for another customer's order; `429` (the 600 per minute limit).

### POST `/v1/me/orders/:id/cancel`

Cancels the customer's order until it ships: while it waits for payment, and once paid, while it is `PAID` or `PACKED` (ADR 0028). Its stock comes back at once, in one transaction. **A paid order's payment goes back in full:** a refund with the reason `CANCELLED_BY_CUSTOMER` is saved in the same transaction, and asked of Razorpay just after.

Response `200`: the order, now `CANCELLED`. A paid one shows its refund in `payment.refunds`: `PENDING` once Razorpay has taken it, or `REQUESTED` while the API asks again (see "Paying for an order"). The customer is emailed that the order is cancelled (see "Order emails").

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed (uuid is expected)` | The ID is not a UUID |
| `401` | see "Authentication errors on protected endpoints" | No valid customer access token, or a staff token |
| `404` | `Order not found` | No such order, or another customer's |
| `409` | `This order can no longer be cancelled.` | The order has shipped, or it is delivered, cancelled or expired |
| `429` | `code: "RATE_LIMITED"` | The 600 per minute limit |

## Paying for an order

Customers pay through Razorpay (ADR 0027). These two endpoints need a **customer** access token, for the customer's own order: another customer's order answers `404`, and a staff token `401`.

1. **Start paying:** `POST /v1/me/orders/:id/payment` answers what the app needs to open Razorpay's payment page.
2. **Open Razorpay's payment page** (`https://checkout.razorpay.com/v1/checkout.js`) with:
   - `key`: `razorpayKeyId`;
   - `order_id`: `razorpayOrderId`;
   - `amount`: **`totalRupees` × 100.** Razorpay's page counts in paise, and this API answers rupees only;
   - `currency`: `INR`.
3. **When the page says the customer paid,** it gives `razorpay_payment_id`, `razorpay_order_id` and `razorpay_signature`. Send the first and the last to `POST /v1/me/orders/:id/payment/confirm`. The answer is the order as it is now.
4. **If the app closes before confirming,** nothing is lost: Razorpay tells the API with a webhook, and the API also asks Razorpay before an order expires. Show the order again (`GET /v1/me/orders/:id`) when the customer comes back.

**On a website, Razorpay's own page** (its Hosted Checkout) can take the place of `checkout.js`, as the customer website does (ADR 0042):
- **The page sends a form** to `https://api.razorpay.com/v1/checkout/embedded` (`POST`) with `key_id` (`razorpayKeyId`), `order_id` (`razorpayOrderId`), `amount` (**`totalRupees` × 100**), `currency` (`INR`), `name`, `prefill[email]`, `prefill[contact]`, `callback_url` and, if wanted, `description` and `cancel_url`.
- **Razorpay sends the customer back** to `callback_url` with a form of its own: `razorpay_payment_id`, `razorpay_order_id` and `razorpay_signature` when paid, its error fields when not. Send the first and the last to `POST /v1/me/orders/:id/payment/confirm`, as in step 3. Leaving Razorpay's page goes to `cancel_url`, with a plain `GET`.
- **That form comes from Razorpay's site,** so a `SameSite` cookie doesn't come with it: confirm from the page the browser opens next, with the customer's session.

**The API decides only on Razorpay's word.** It asks Razorpay about every payment, and only a captured payment for the order's amount counts:

| The order is | When a payment comes |
|---|---|
| `PENDING_PAYMENT` | It becomes `PAID`. |
| `EXPIRED` | It becomes `PAID` if its stock can be taken again. Otherwise the payment goes back in full (`ORDER_EXPIRED`). |
| `CANCELLED` | The payment goes back in full (`ORDER_CANCELLED`). |
| `PAID` already | Another payment goes back in full (`ALREADY_PAID`). |

Money going back shows in the order's `payment.refunds`:
```json
"payment": {
  "paidAt": null,
  "refunds": [
    { "amountRupees": 498, "reason": "ORDER_CANCELLED", "status": "PENDING", "createdAt": "2026-11-08T12:26:16.311Z", "givenBackAt": null }
  ]
}
```

Cancelling a paid order before it ships gives its payment back too: `CANCELLED_BY_CUSTOMER`, or `CANCELLED_BY_STAFF` when the shop cancelled it (ADR 0028).

| Refund `status` | Meaning |
|---|---|
| `REQUESTED` | Saved, but Razorpay hasn't taken it yet. The API asks again every minute. |
| `PENDING` | Razorpay has taken it, and the money is on its way back. |
| `PROCESSED` | The money is back with the customer. |
| `FAILED` | Razorpay couldn't give it back. Staff give it back by hand, and then `givenBackAt` says when (since part 12G, ADR 0038). It stays `FAILED`. |

The customer is emailed once the order is paid, and once a refund is `PROCESSED`. The Super Users are emailed when a refund is `FAILED` (see "Order emails").

### POST `/v1/me/orders/:id/payment`

Starts paying for an order waiting for payment, while its stock is held. The first time, it makes a Razorpay order for the order's total. **Asking again answers the same Razorpay order,** so a retry does no harm.

Response `200`:
```json
{
  "reference": "7KQ2M9XDPA",
  "totalRupees": 498,
  "holdExpiresAt": "2026-11-08T12:21:16.431Z",
  "razorpayKeyId": "rzp_test_ABCDEFGHijkl01",
  "razorpayOrderId": "order_RB58MiP5SPFYyM"
}
```

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed (uuid is expected)` | The ID is not a UUID |
| `401` | see "Authentication errors on protected endpoints" | No valid customer access token, or a staff token |
| `404` | `Order not found` | No such order, or another customer's |
| `409` | `Only an order waiting for payment can be paid.` | The order is paid, cancelled or expired |
| `409` | `The time to pay for this order is over. Please order again.` | Its `holdExpiresAt` has passed, even before the job expires it |
| `429` | `code: "RATE_LIMITED"` | 60 per hour per IP, or the 600 per minute limit |
| `503` | `code: "PAYMENTS_UNAVAILABLE"` | Razorpay can't be reached. Try again after `Retry-After` (30 seconds). |

### POST `/v1/me/orders/:id/payment/confirm`

Confirms a payment with what Razorpay's payment page gave the app. The API checks Razorpay's signature against **the Razorpay order it made for this order,** then asks Razorpay itself about the payment.

Request:
```json
{ "razorpayPaymentId": "pay_G3P9vcIhRs3NV4", "razorpaySignature": "<64 hex characters>" }
```

| Field | Rules |
|---|---|
| `razorpayPaymentId` | The page's `razorpay_payment_id`: `pay_`, then letters and digits |
| `razorpaySignature` | The page's `razorpay_signature`: 64 hexadecimal characters |

The page's `razorpay_order_id` is not needed: the API uses the one it saved.

Response `200`: the order, as it is now:
- `PAID`, with `payment.paidAt`;
- still `PENDING_PAYMENT`, if Razorpay hasn't captured the payment yet, or it failed. Show the order again in a moment;
- or with the money on its way back, in `payment.refunds`.

Confirming again changes nothing, and answers the same.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed` | A field is missing or not in its form (`Send the razorpay_payment_id from Razorpay's payment page`, or `Send the razorpay_signature from Razorpay's payment page`) |
| `400` | `The payment could not be verified.` | The signature is wrong, or the payment is for another order |
| `401` | see "Authentication errors on protected endpoints" | No valid customer access token, or a staff token |
| `404` | `Order not found` | No such order, or another customer's |
| `409` | `Start paying for this order first.` | Paying for this order was never started |
| `429` | `code: "RATE_LIMITED"` | 60 per hour per IP, or the 600 per minute limit |
| `503` | `code: "PAYMENTS_UNAVAILABLE"` | Razorpay can't be reached. Try again after `Retry-After` (30 seconds). |

## Razorpay webhooks

### POST `/v1/payments/razorpay/webhook`

**Public,** for Razorpay only: Razorpay calls it when a payment or a refund changes (ADR 0027). Instead of a token, Razorpay signs each webhook:
- **`X-Razorpay-Signature`:** the hex HMAC-SHA256 of the body, **exactly as it was sent,** with the webhook secret set in the Razorpay dashboard (`RAZORPAY_WEBHOOK_SECRET`). The same JSON with other spacing fails the check;
- the body is JSON, at most 100 kB, like every other body.

| Event | What the API does |
|---|---|
| `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid` | Asks Razorpay about the payment named in `payload.payment.entity.id`, and settles it as a confirmation does |
| `refund.created`, `refund.processed`, `refund.failed` | Moves our refund forward, found by Razorpay's refund ID or by its receipt (our refund's ID) |
| Anything else | Nothing |

Response `200`, empty, also for an event the API has no use for. **The same webhook twice changes nothing.**

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `The webhook could not be verified.` | No signature, or a wrong one |
| `429` | `code: "RATE_LIMITED"` | The 600 per minute limit |
| `503` | `code: "PAYMENTS_UNAVAILABLE"` | Razorpay can't be asked about the payment now. Razorpay sends the webhook again later, for up to 24 hours. |

## Order emails

No endpoint sends these directly: the changes below each save an email in their own transaction, and the API sends it once that transaction is saved (ADR 0029). They are sent through the API's mail server (Mailpit in development).

| The change | Who gets it | Subject |
|---|---|---|
| An order becomes `PAID`: a confirmation, a webhook, or the job before an order expires (see "Paying for an order") | The customer | `Your order 7KQ2M9XDPA is confirmed`, with each line, the totals with the GST included, the delivery charge and the delivery address |
| `POST /v1/staff/orders/:id/packed` | The customer | `Your order 7KQ2M9XDPA is packed` |
| `POST /v1/staff/orders/:id/shipped` | The customer | `Your order 7KQ2M9XDPA is on its way`, with the courier and tracking number |
| `PATCH /v1/staff/orders/:id/shipment`, when it changes something | The customer | `New tracking details for your order 7KQ2M9XDPA` |
| `POST /v1/staff/orders/:id/delivered` | The customer | `Your order 7KQ2M9XDPA is delivered` |
| `POST /v1/me/orders/:id/cancel` or `POST /v1/staff/orders/:id/cancel` | The customer | `Your order 7KQ2M9XDPA is cancelled`, saying that a paid order's payment is going back in full |
| A refund becomes `PROCESSED`: Razorpay's answer, or a `refund.processed` webhook | The customer | `Your refund for order 7KQ2M9XDPA is complete`, with the amount and why |
| A refund becomes `FAILED`: Razorpay refuses it, or a `refund.failed` webhook | Every active Super User, in one email | `Action needed: a refund for order 7KQ2M9XDPA failed` |

- **The answer never waits for the email,** and never fails because of it. An email that can't be sent is tried again, waiting 1, 2, 4 and so on up to 60 minutes, and given up on after 10 tries.
- **Each step is told once.** A step done already (`409`), or a correction that changes nothing, sends nothing.
- **An email is sent at least once:** rarely, twice.
- **No email has a link.** Amounts are written like `Rs 1,299`.
- **Nothing is emailed** when an order expires, or when a late or second payment is given back: the customer hears once the refund is complete.

## Staff authentication

For Admins and Super Users only. Customers cannot sign in here, and staff cannot sign in at `/v1/auth/login`. An invited Admin chooses a password and sets up an authenticator app with the emailed link (`setup-link` and `accept-invite` below), and sets the app up again the same way after a Super User reset it (`reset-authenticator`, ADR 0038). A developer sets up a Super User's app (README, "Set up staff MFA").

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

**From the admin console** (ADR 0031): when the request's `Origin` header is exactly `ADMIN_ORIGIN`, the answer has no `refreshToken`. It comes in a cookie the page cannot read:
```
Set-Cookie: herbal_staff_refresh=<token>; Path=/v1/staff/auth; Max-Age=43200; HttpOnly; SameSite=Strict
```
with `Secure` when `ADMIN_ORIGIN` is `https`. A failed sign-in sets no cookie. Every other client works as above.

### POST `/v1/staff/auth/refresh`

**Public.** Works like `/v1/auth/refresh`, for staff refresh tokens only: each token works once, and reusing one ends the session. The session still ends 12 hours after the login.

A customer refresh token gets `401 Invalid refresh token`, and is not used up: it keeps working on its own path. Errors otherwise as for `/v1/auth/refresh`.

**From the admin console** (`Origin` exactly `ADMIN_ORIGIN`): no body is needed, and a token in the body is ignored. The cookie's token is swapped: the answer is `accessToken`, `tokenType` and `expiresIn`, and the new refresh token comes in a new cookie. Without a cookie, or with one the API refuses, the answer is `401 Invalid refresh token`, with a `Set-Cookie` that clears it (`Max-Age=0`).

### POST `/v1/staff/auth/logout`

**Public.** Works like `/v1/auth/logout`, for staff sessions. Always `204`; a customer refresh token is ignored.

**From the admin console** (`Origin` exactly `ADMIN_ORIGIN`): no body is needed. The cookie's session ends, if there is one, and the cookie is always cleared.

### POST `/v1/staff/auth/accept-invite`

**Public.** The invited Admin chooses their password and sets up their authenticator app, together, with the token from the invitation email (ADR 0038). The link opens the admin console's page (`/accept-invite?token=...`), which first shows the key with `setup-link` below, then posts here. It is valid for **72 hours, once**.

Request:
```json
{ "token": "<token from the email>", "password": "a-long-staff-password-1", "code": "123456" }
```
Rules: the token is 20 to 200 characters; the password 16 to 128 characters; the code exactly 6 digits, from the key `setup-link` showed (spaces around it are trimmed).

Response `200`:
```json
{ "message": "Your password and authenticator app are set. Sign in with them." }
```
What accepting also does, in one transaction:
- the password and the authenticator key are saved, and the code just typed can't be used again to sign in;
- the email address counts as verified;
- any session of the account ends, and any other unused link of the Admin stops working;
- two audit entries, both with the Admin as the actor: `admin.invite_accepted` and `staff.mfa_set_up`.

The Admin is **not** signed in: they sign in next, with the password and a new code.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed` | Missing fields, a password shorter than 16 characters, or a code that is not 6 digits |
| `400` | `Validation failed`, with `code`: `Open the link again, and add the key it shows to your authenticator app first.` | The link's key was never shown: call `setup-link` first |
| `400` | `Validation failed`, with `code`: `That code is not right. Type the code your authenticator app shows now.` | The code doesn't come from the key the link showed, or is too old |
| `400` | `Invalid or expired invitation link` | Unknown, used or expired link, or an account that is no longer an active Admin. One answer for all cases. |
| `429` | `code: "RATE_LIMITED"` | Per-IP limit (20 per hour, shared with `setup-link` and `reset-authenticator`) |
| `503` | `code: "SERVER_BUSY"` | Too many password hashes at once; try again after `Retry-After` |

Client tip: on `400 Invalid or expired invitation link`, tell the Admin to ask a Super User for a new invitation.

### POST `/v1/staff/auth/setup-link`

**Public.** Whoever opened an emailed link asks for the key to put into the authenticator app (ADR 0038). Works for both kinds of link: an invitation, and a new start after a reset.

Request:
```json
{ "token": "<token from the email>" }
```

Response `200`, with `Cache-Control: no-store`:
```json
{
  "purpose": "INVITE",
  "email": "dev.admin1@example.com",
  "fullName": "Dev Admin One",
  "key": "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
  "uri": "otpauth://totp/Herbal%20Commerce:dev.admin1%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Herbal%20Commerce&algorithm=SHA1&digits=6&period=30",
  "expiresAt": "2026-11-23T10:00:00.000Z"
}
```
- `purpose`: `INVITE` or `AUTHENTICATOR_RESET`.
- `key`: the key in base32 (`A`–`Z`, `2`–`7`), to type in by hand. `uri`: the same key as an address for a QR code.
- **The key is made the first time the link is opened,** and every later call answers the same key, so a page opened again shows what was already scanned. Of two calls at the same moment, one key wins. Nothing else changes until `accept-invite` or `reset-authenticator` confirms it with a code.
- Not audited: it changes nothing an Admin can use.

Errors: `400 Validation failed` (a missing token); `400 Invalid or expired invitation link`, or `Invalid or expired link` for a reset link: one answer for every link that doesn't work, as for `accept-invite`; `429` (20 per hour per IP, shared with `accept-invite` and `reset-authenticator`).

### POST `/v1/staff/auth/reset-authenticator`

**Public.** After a Super User reset their authenticator app (`POST /v1/staff/admins/:id/authenticator-reset`), the Admin sets it up again with the emailed link, their own password and a code from the new key (ADR 0038). The link opens the admin console's page (`/reset-authenticator?token=...`). It is valid for **72 hours, once**.

Request:
```json
{ "token": "<token from the email>", "password": "the-admin-s-own-password", "code": "123456" }
```
Rules: the token is 20 to 200 characters; the password 1 to 128 characters; the code exactly 6 digits, from the key `setup-link` showed.

Response `200`:
```json
{ "message": "Your authenticator app is set. Sign in with it." }
```
What it also does, in one transaction: the new key is saved, and the code just typed can't be used again to sign in; every session of the Admin ends; any other unused link stops working; `staff.mfa_set_up` is written, with the Admin as the actor.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed` | Missing fields, or a code that is not 6 digits |
| `400` | `Validation failed`, with `code`: `Open the link again, and add the key it shows to your authenticator app first.` | The link's key was never shown |
| `400` | `Invalid or expired link` | Unknown, used or expired link, or an Admin who is no longer active. One answer for all cases. |
| `401` | `Invalid password or code` | A wrong password or a wrong code. One answer for both, as at the staff login, and it counts against the same failure limits. |
| `429` | `code: "RATE_LIMITED"` | 20 per hour per IP, or too many failed attempts for this Admin (as at the staff login) |
| `503` | `code: "SERVER_BUSY"` | Too many password checks at once; try again after `Retry-After` |

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
| `POST /v1/staff/admins/:id/authenticator-reset` | Reset a lost authenticator app, and email a link to set it up again |
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

Until the invitation is accepted, the Admin cannot sign in. Accepting it sets up their authenticator app too (`accept-invite`, ADR 0038).

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
      "authenticatorLinkExpiresAt": null,
      "mfaEnabledAt": "2026-10-30T11:47:36.000Z",
      "createdAt": "2026-10-30T11:28:51.000Z"
    }
  ]
}
```
- `status`: `ACTIVE` or `DISABLED`.
- `invitationAcceptedAt`: when the Admin chose their password, or `null` while the invitation is pending.
- `invitationExpiresAt`: when the newest unused invitation ends, or `null` if there is none. A time in the past means the link has expired: send a new one.
- `authenticatorLinkExpiresAt`: after a reset, when the newest unused link to set up the app again ends, or `null` if there is none (since part 12G). A time in the past means it has expired: reset again to send a new one.
- `mfaEnabledAt`: when the authenticator app was set up, or `null`: never yet, or reset since. Until it is set, the Admin cannot sign in.

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

### POST `/v1/staff/admins/:id/authenticator-reset`

An Admin lost their phone, or someone else may have it (ADR 0038). No request body. In one transaction:
- their authenticator key is cleared, so the old app's codes stop working at once;
- every session of the Admin ends;
- every older unused link stops working, and a new one is made, valid for 72 hours and once;
- `admin.authenticator_reset` is written, with the link's end.

Then the Admin is emailed the link ("Set up your authenticator app again for Herbal Commerce"), which opens the console's page for `reset-authenticator`. They set the app up again there with their own password.

Response `201`:
```json
{
  "id": "3c9a7e21-5b4d-4f8e-9a16-7d2e0c5b8f41",
  "email": "dev.admin1@example.com",
  "fullName": "Dev Admin One",
  "authenticatorLinkExpiresAt": "2026-11-23T10:00:00.000Z",
  "emailSent": true
}
```
`emailSent` is `false` if the email could not be sent. The reset stands anyway: reset again to send a new link. The answer never contains the token or the link.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed (uuid is expected)` | The ID is not a UUID |
| `401`, `403` | as above | |
| `404` | `Admin not found` | No Admin with this ID |
| `409` | `Enable this Admin before resetting their authenticator app.` | The Admin is disabled |
| `409` | `This Admin has not accepted the invitation yet: send the invitation again.` | The Admin never accepted: the invitation sets up the app |
| `429` | `code: "RATE_LIMITED"` | Per-IP limit (20 per hour, shared with invitations), or 5 emails per hour to this address. Nothing was changed. |

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
| `PATCH /v1/staff/categories/:id` | Change, activate, deactivate or move a category |
| `PUT /v1/staff/categories/order` | Put the top categories, or one top category's subcategories, in a new order, as staff dragged them (ADR 0032) |
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
  "parentId": null,
  "createdAt": "2026-11-03T06:15:05.292Z",
  "updatedAt": "2026-11-03T06:15:05.292Z"
}
```

**Subcategories (since part 15A):** a category may sit inside a top category. Only two levels: a top category may hold products of its own as well as subcategories, and a subcategory holds only products. Hiding a top category hides its subcategories and their products too. A product's category may be either.

The rules for each field:

| Field | Rules |
|---|---|
| `name` | 1 to 60 characters, trimmed |
| `slug` | Lowercase letters `a`–`z`, digits and single hyphens, at most 60 characters, like `hair-care`. Unique. |
| `description` | Optional, up to 500 characters, trimmed. An empty value, or `null` in a change, means none. |
| `position` | A whole number from 0 to 9999. Customers see lower numbers first. Default `0`. |
| `isActive` | `true` shows the category to customers. Default `false`. |
| `parentId` | The top category it sits in, by its ID, or `null` for a top category. Default `null`. It must be a top category, never a subcategory, and never the category itself. |

### GET `/v1/staff/categories`

Every category, hidden ones too, in the order customers see them: each top category followed by its own subcategories. No paging: a catalog has only a few categories.

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
- **A subcategory** is created inside a top category by sending its `parentId`.
- Any other field, such as `id`, is ignored.

Response `201`: the category.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed` | A missing or invalid field, each named in `errors`. A name without Latin letters and no slug gives `The name has no Latin letters or digits: give a slug` for `slug`. A `parentId` that is unknown gives `No category with this ID`, and one of a subcategory `This is a subcategory. Choose a top category: there are only two levels.` |
| `401` | see "Authentication errors on protected endpoints" | No staff access token, or a customer's |
| `409` | `Another category already has this slug. Choose a different one.` | The slug, sent or made from the name, is taken |
| `429` | `code: "RATE_LIMITED"` | The 600 per minute limit |

### PATCH `/v1/staff/categories/:id`

Changes a category. Send only the fields that change: `{ "isActive": true }` activates it, and `{ "description": null }` removes the description.

- **Renaming keeps the slug,** so links keep working. Send a `slug` to change it.
- **Moving:** `{ "parentId": "…" }` moves the category into that top category, and `{ "parentId": null }` makes it a top category. It keeps its `position`: reorder its new level to place it. Its products go with it.
- **Sending the values the category already has changes nothing,** answers `200` too, and writes no audit entry. It is safe to send the same request twice.

Response `200`: the category, as it is now.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed (uuid is expected)` | The ID is not a UUID |
| `400` | `Validation failed` | An invalid field, or an empty change (`Nothing to change`) |
| `400` | `Validation failed` | A move refused, for `parentId`: `No category with this ID`, `This is a subcategory. Choose a top category: there are only two levels.`, `A category cannot sit inside itself`, or `This category has subcategories, so it cannot sit inside another. Move them first.` |
| `401` | see above | No staff access token, or a customer's |
| `404` | `Category not found` | No category with this ID |
| `409` | `Another category already has this slug. Choose a different one.` | The new slug is taken |
| `429` | `code: "RATE_LIMITED"` | The 600 per minute limit |

### PUT `/v1/staff/categories/order`

Puts one level of categories in a new order, the one customers see: what staff dragged in the admin console (ADR 0032).

Request: **every top category, hidden ones too, each once,** first to last:
```json
{ "ids": ["0b8f3a52-6d1e-4c7a-9f2b-3e4d5c6b7a81", "7c9e6679-7425-40de-944b-e07fc1f90ae7", "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"] }
```
Or **every subcategory of one top category,** named by `parentId` (since part 15A):
```json
{ "parentId": "7c9e6679-7425-40de-944b-e07fc1f90ae7", "ids": ["2b7e4f1a-6c3d-4e8f-9a0b-5d1c7e3f9a26", "4e8a1c5f-2d6b-4f9e-8c3a-7b0d2e6f1a94"] }
```
Without `parentId`, or with `null`, the list is the top categories.

- Each category's `position` becomes its place in the list: `0`, `1`, `2` and so on.
- Only the categories that moved are changed, each with its own audit entry (`category.updated`, the position before and after). All of it is saved in one transaction.
- The same order again changes nothing and writes no audit entry.

Response `200`: `{ "categories": [...] }`, every category in the new order, in the form above.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed` | No list, an ID that is not a UUID (`Each category by its ID`), an ID twice (`List each category once`), or more than 500; a `parentId` that is not a UUID, or no category's (`No category with this ID`) |
| `401` | see above | No staff access token, or a customer's |
| `409` | `The categories changed while you were ordering them. Reload and try again.` | The list is not exactly every category of that level: one was added, moved or deleted since the list was read, or an ID is unknown |
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
| `409` | `This category still has subcategories. Move them to another category or delete them first.` | The category still has subcategories, hidden or not (since part 15A) |
| `409` | `This category still shows products from other categories. Take it off their other categories first.` | A product whose main category is another is still also shown in it (since part 15A) |
| `409` | `This category still has products. Move them to another category or delete them first.` | The category still has products, live or not. The database refuses the delete. |
| `429` | `code: "RATE_LIMITED"` | The 600 per minute limit |

## Managing brands (staff)

Brands for staff (part 15A). Each product may have one, which the shop shows and reports group sales by. Staff keep the list, so a brand is spelled one way only. These endpoints need a **staff** access token: an Admin's or a Super User's. **Deleting is for Super Users only.** Every change is written to the audit log, with the staff member, the client IP and the request ID.

| Endpoint | Purpose |
|---|---|
| `GET /v1/staff/brands` | List every brand, with how many products have it |
| `POST /v1/staff/brands` | Create a brand |
| `PATCH /v1/staff/brands/:id` | Rename a brand, or change its slug |
| `DELETE /v1/staff/brands/:id` | Delete a brand no product has (Super Users only) |

A brand, as these endpoints return it:
```json
{
  "id": "3f6c1a2e-9b4d-4c7e-8a15-6d2f0e9b7c41",
  "name": "Himalaya",
  "slug": "himalaya",
  "createdAt": "2026-11-23T09:15:00.000Z",
  "updatedAt": "2026-11-23T09:15:00.000Z"
}
```

The rules for each field:

| Field | Rules |
|---|---|
| `name` | 1 to 60 characters, trimmed |
| `slug` | As for categories: lowercase letters `a`–`z`, digits and single hyphens, at most 60, unique among brands. Made from the name if not sent, so `Himalaya` and `HIMALAYA` can't both exist. |

### GET `/v1/staff/brands`

Every brand, by name. No paging: a shop has only a few.

Response `200`: `{ "brands": [...] }`, each in the form above with `productCount`, how many products have it, drafts too. A brand can be deleted only at `0`.

Errors: `401` (see "Authentication errors on protected endpoints"), also for a customer access token; `429` (the 600 per minute limit).

### POST `/v1/staff/brands`

Creates a brand: `{ "name": "Himalaya" }`. Without a `slug`, it is made from the name, as for categories; a name without Latin letters or digits needs one. Any other field is ignored.

Response `201`: the brand.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed` | A missing or invalid field, each named in `errors` |
| `401` | see above | No staff access token, or a customer's |
| `409` | `Another brand already has this slug. Choose a different one.` | The slug, sent or made from the name, is taken |
| `429` | `code: "RATE_LIMITED"` | The 600 per minute limit |

### PATCH `/v1/staff/brands/:id`

Renames a brand, or changes its slug. **Renaming keeps the slug,** so links to the shop filtered by the brand keep working. Sending the values the brand already has changes nothing, answers `200` too, and writes no audit entry.

Response `200`: the brand, as it is now.

Errors: `400` (the ID is not a UUID, an invalid field, or `Nothing to change`); `401`; `404 Brand not found`; `409 Another brand already has this slug. Choose a different one.`; `429`.

### DELETE `/v1/staff/brands/:id`

Deletes a brand for good. **Super Users only.** The audit log keeps what was deleted.

Response `204 No Content`.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed (uuid is expected)` | The ID is not a UUID |
| `401` | see above | No staff access token, or a customer's |
| `403` | `Only a Super User may do this.` | Called by an Admin |
| `404` | `Brand not found` | No brand with this ID, also when it was just deleted |
| `409` | `This brand still has products. Choose another brand for them, or none, first.` | A product, live or not, still has it. The database refuses the delete. |
| `429` | `code: "RATE_LIMITED"` | The 600 per minute limit |

## Managing products (staff)

Products for staff (ADR 0021). These endpoints need a **staff** access token: an Admin's or a Super User's. **Deleting is for Super Users only.** Every change is written to the audit log, with the staff member, the client IP and the request ID.

| Endpoint | Purpose |
|---|---|
| `GET /v1/staff/products` | List every product, drafts too, one page at a time, or search them by name |
| `GET /v1/staff/products/order` | Every product shown in a category, in order (since part 15A) |
| `GET /v1/staff/products/:id` | Read one product, a draft too (ADR 0032) |
| `POST /v1/staff/products` | Create a product |
| `PATCH /v1/staff/products/:id` | Change it, move it to another category, activate or deactivate it |
| `PUT /v1/staff/products/order` | Put the products shown in a category in a new order, as staff dragged them (ADR 0032) |
| `DELETE /v1/staff/products/:id` | Delete a product (Super Users only) |

A product, as these endpoints return it:
```json
{
  "id": "3f2b8c1d-5e6a-4b7c-8d9e-0f1a2b3c4d5e",
  "categoryId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "otherCategoryIds": ["1d4f7a2c-8b3e-4c6d-9e0f-2a5b8c1d4e7f"],
  "brandId": "3f6c1a2e-9b4d-4c7e-8a15-6d2f0e9b7c41",
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
| `categoryId` | The ID of an existing category: its **main** category. Required to create. Reports count its sales here only. |
| `otherCategoryIds` | Optional: the IDs of up to 5 other categories it is also shown in (since part 15A), each once, never its main one. Default none. A change replaces the whole list, and `[]` shows it in its main category only. The answer lists them by ID, in no meaningful order. |
| `brandId` | Optional: the ID of an existing brand (since part 15A). `null` takes the brand away. Going live doesn't need one. |
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
| `position` | A whole number from 0 to 9999, the order within its main category. Its place in each other category is set by ordering that category. Without one, the product goes **last** in its category: one more than the highest place there, among its own products and those also shown in it (at most 9999). Until part 15A the default was `0`. |

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
| `categoryId` | UUID | Only the products whose main category it is. For every product shown in it, use `GET /v1/staff/products/order`. |
| `brandId` | UUID | Only this brand's products (since part 15A) |
| `isActive` | `true` or `false` | Only live products, or only drafts |
| `q` | 2 to 100 characters | Search by name (since part 12B, ADR 0032) |

Response `200`: `{ "products": [...], "nextAfter": "<id>" }`, each product in the form above. `nextAfter` is `null` on the last page.

**Searching by name** (`q`), for the admin console's product list:
- **Only the name is searched,** with the shop's matching (ADR 0030): a part of a word or a typo still finds a product. `ashwa` finds "Ashwagandha Capsules", and so does `ashwaganda`.
- **The closest names come first, all on one page** of up to `limit`, so `nextAfter` is always `null`. Sending `after` with `q` is refused: narrow the words instead.
- It combines with `categoryId`, `brandId` and `isActive`.
- Spaces at the ends are dropped and each run of spaces counts as one. An empty `q` means no search.
- The words are a bound parameter in the query, never part of the SQL.

Errors: `400 Validation failed` (a bad parameter, named in `errors`, such as `Search with at least 2 characters`, or `after` with `q`: `A search shows its best matches on one page: leave out after`); `401` (see "Authentication errors on protected endpoints"), also for a customer access token; `429` (the 600 per minute limit).

### GET `/v1/staff/products/order`

Every product shown in one category, drafts too, in the order customers see them there (since part 15A): what staff drag into a new order. Those whose main category it is, and those also shown in it, each at its place there. No paging: it is the list `PUT /v1/staff/products/order` takes.

Query parameter: `categoryId`, required, a UUID.

Response `200`: `{ "products": [...] }`, each product in the form above. One whose `categoryId` is another category is shown here from there.

Errors: `400 Validation failed` (no `categoryId`, one that is not a UUID, or a category that doesn't exist: `No category with this ID`); `401` (see above), also for a customer access token; `429` (the 600 per minute limit).

### GET `/v1/staff/products/:id`

One product, a draft too, for its page in the admin console (ADR 0032).

Response `200`: the product, in the form above.

Errors: `400` (the ID is not a UUID); `401` (see above), also for a customer access token; `404 Product not found`; `429` (the 600 per minute limit).

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
| `400` | `Validation failed` | A missing or invalid field, `"isActive": true` (a new product has no image), or a `categoryId` with no category behind it (`No category with this ID`), or a `brandId` with no brand behind it (`No brand with this ID`). For `otherCategoryIds`: `No category with one of these IDs`, `Its main category cannot be one of its other categories too`, `List each category once`, or `At most 5 other categories`. |
| `401` | see "Authentication errors on protected endpoints" | No staff access token, or a customer's |
| `409` | `Another product already has this slug. Choose a different one.` | The slug, sent or made from the name, is taken |
| `429` | `code: "RATE_LIMITED"` | The 600 per minute limit |

### PATCH `/v1/staff/products/:id`

Changes a product. Send only the fields that change:
- `{ "isActive": false }` takes it out of the shop;
- `{ "categoryId": "..." }` moves it to another category, where it goes last, as a new product does, unless the change gives a `position` too.
- `{ "brandId": "..." }` gives it a brand, and `{ "brandId": null }` takes it away.
- `{ "otherCategoryIds": [...] }` sets the other categories it is also shown in. A category kept on the list keeps the product's place there; one added puts it last there. To make one of them its main category, send both: `{ "categoryId": "<it>", "otherCategoryIds": [...without it] }`.

**Renaming keeps the slug.** Sending the values the product already has changes nothing, answers `200` too, and writes no audit entry.

Response `200`: the product, as it is now.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed (uuid is expected)` | The ID is not a UUID |
| `400` | `Validation failed` | An invalid field, an empty change (`Nothing to change`), the going-live rules above, a category or brand that doesn't exist, or other categories refused as for a new product |
| `401` | see above | No staff access token, or a customer's |
| `404` | `Product not found` | No product with this ID |
| `409` | `Another product already has this slug. Choose a different one.` | The new slug is taken |
| `429` | `code: "RATE_LIMITED"` | The 600 per minute limit |

### PUT `/v1/staff/products/order`

Puts one category's products in a new order, the one customers see in that category: what staff dragged in the admin console (ADR 0032).

Request: the category, and **every product shown in it, drafts too, each once,** first to last: those whose main category it is, and those also shown in it (since part 15A), as `GET /v1/staff/products/order` lists them:
```json
{
  "categoryId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "ids": ["4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a", "3f2b8c1d-5e6a-4b7c-8d9e-0f1a2b3c4d5e"]
}
```

- Each product's place becomes its place in the list: `0`, `1`, `2` and so on. For a product whose main category it is, that is its `position`; for one also shown in it, its place in this category only.
- Only the products that moved are changed, each with its own audit entry (`product.updated`): the `position` before and after, or for a product also shown here, `otherCategoryPosition` with the category and the place before and after. All of it is saved in one transaction, and the category can't be deleted meanwhile.
- The same order again changes nothing and writes no audit entry.

Response `200`: `{ "products": [...] }`, every product shown in the category, in the new order, in the form above.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed` | No category or no list, an ID that is not a UUID, an ID twice (`List each product once`), more than 1000, or a category that doesn't exist (`No category with this ID`, for `categoryId`) |
| `401` | see above | No staff access token, or a customer's |
| `409` | `The products in this category changed while you were ordering them. Reload and try again.` | The list is not exactly the products shown in the category: one was added, moved, shown or taken off it, or deleted since the list was read, or an ID is not one of them |
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
| `PUT /v1/staff/products/:productId/variants/order` | Put all of a product's packs in a new order, as staff dragged them (ADR 0033) |
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
  "lowStockAt": 10,
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
| `lowStockAt` | When staff see the pack as low on stock: at this many packs that may be sold, or fewer. A whole number from 0 to 1,000,000; `0` means never low, only out of stock. Default `10` (ADR 0034). Customers never see it. |
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

### PUT `/v1/staff/products/:productId/variants/order`

Puts a product's packs in a new order, the one its page shows: what staff dragged in the admin console (ADR 0033).

Request: **every pack of the product, off sale ones too, each once,** first to last:
```json
{ "ids": ["b2c4e6f8-1a3c-4e5f-9a7b-2c4d6e8f0a1b", "5d7f9b1c-3e5a-4c7e-8b9d-1f3a5c7e9b2d"] }
```

- Each pack's `position` becomes its place in the list: `0`, `1`, `2` and so on.
- Only the packs that moved are changed, each with its own audit entry (`variant.updated`, the position before and after). All of it is saved in one transaction.
- The product can't be deleted meanwhile. Its packs can still be sold, put in carts and given stock: the lock doesn't hold them up.
- The same order again changes nothing and writes no audit entry.

Response `200`: `{ "variants": [...] }`, every pack of the product in the new order, in the form above.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed (uuid is expected)` | The product ID is not a UUID |
| `400` | `Validation failed` | No list (`List the pack sizes`), an ID that is not a UUID (`Each pack size by its ID`), an ID twice (`List each pack size once`), or more than 100 |
| `401` | see above | No staff access token, or a customer's |
| `404` | `Product not found` | No product with this ID |
| `409` | `The product's pack sizes changed while you were ordering them. Reload and try again.` | The list is not exactly the product's packs: one was added or deleted since the list was read, or an ID is not one of them |
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
| `PUT /v1/staff/products/:productId/images/order` | Put all of a product's images in a new order, as staff dragged them (ADR 0033) |
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

The new image goes after the last one: its `position` is one more than the highest of the product's images (at most 9999), or `0` for the first. Until part 12C it got `0`, which put it second once staff had ordered the images (ADR 0033). To make it the main photo, put the images in a new order.

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

### PUT `/v1/staff/products/:productId/images/order`

Puts a product's images in a new order, as staff dragged them in the admin console (ADR 0033). **The first becomes the main photo,** the one on the product's card in the shop.

Request: **every image of the product, each once,** first to last:
```json
{ "ids": ["9e783ece-f6d7-4547-a609-bfd8b4b21829", "2b4d6f8a-0c1e-4a3b-9d5f-7e9a1c3b5d7f"] }
```

- Each image's `position` becomes its place in the list: `0`, `1`, `2` and so on.
- Only the images that moved are changed, each with its own audit entry (`image.updated`, the position before and after). All of it is saved in one transaction.
- The product is locked as for an upload or a deletion, so no image is added or deleted meanwhile.
- The same order again changes nothing and writes no audit entry.

Response `200`: `{ "images": [...] }`, every image of the product in the new order, in the form above.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed (uuid is expected)` | The product ID is not a UUID |
| `400` | `Validation failed` | No list (`List the images`), an ID that is not a UUID (`Each image by its ID`), an ID twice (`List each image once`), or more than 6 |
| `401` | see above | No staff access token, or a customer's |
| `404` | `Product not found` | No product with this ID |
| `409` | `The product's images changed while you were ordering them. Reload and try again.` | The list is not exactly the product's images: one was uploaded or deleted since the list was read, or an ID is not one of them |
| `429` | `code: "RATE_LIMITED"` | The 600 per minute limit |

### DELETE `/v1/staff/images/:id`

Deletes an image for good, with its two files. **Admins and Super Users alike.** The audit log keeps what the image was.

Response `204 No Content`.

Errors: `400` (the ID is not a UUID); `401`; `404 Image not found`; `409 A live product needs at least one image. Add another first, or take the product offline.`; `429` (the 600 per minute limit).

## Managing stock (staff)

The stock of each pack size, batch by batch, in one warehouse (ADR 0024). These endpoints need a **staff** access token: an Admin's or a Super User's. **Nothing here is deleted:** every change is a movement, and a mistake is put right by another movement. Every change is written to the audit log, with the staff member, the client IP and the request ID.

| Endpoint | Purpose |
|---|---|
| `GET /v1/staff/stock` | Every pack size with its stock, for the Stock page: out of stock, low, or a batch that stops selling soon (ADR 0034) |
| `GET /v1/staff/variants/:variantId/batches` | List a pack size's batches, with its stock |
| `POST /v1/staff/variants/:variantId/batches` | Receive a delivery: a new batch |
| `PATCH /v1/staff/batches/:id` | Correct a batch's label details |
| `GET /v1/staff/batches/:id/movements` | A batch's history, newest first |
| `POST /v1/staff/batches/:id/movements` | Change a batch's stock |
| `POST /v1/staff/batches/:id/count` | Put a batch's stock right from a count of its shelf (ADR 0034) |

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
  "sellable": true,
  "stopsSellingOn": "2028-04-01",
  "awaitingPacking": 2,
  "packed": 1,
  "onShelf": 120
}
```

| Field | Rules |
|---|---|
| `batchNumber` | As printed on the pack: 1 to 40 letters, digits, `/`, `.` and `-`. Spaces are dropped and letters made capitals: ` ab 2611 ` is stored as `AB2611`. Unique within its pack size. |
| `manufacturedOn`, `expiresOn` | Dates as on the label, such as `2026-10-31`. Another form, or an impossible date, answers `Use a date like 2026-10-31`. The expiry is after the manufacturing date, and the manufacturing date is not in the future. "Today" is India's date. |
| `quantity` | The packs on hand and free to sell: changed only by movements, never below 0. Packs held by orders waiting for payment are not counted (ADR 0026). |
| `sellable` | Whether the batch may be sold today: it expires on or after today plus 6 months (on 6 November 2026, from 6 May 2027) |
| `stopsSellingOn` | The first day the batch may no longer be sold: from then on it has less than 6 months left (ADR 0034). For a batch expiring on 30 September 2028, that is 1 April 2028: on 31 March it still has 6 months left. |
| `awaitingPacking` | Packs orders took and have not packed yet: waiting for payment, or paid. They are still on the shelf. |
| `packed` | Packs of orders packed but not shipped: in their boxes, off the shelf. |
| `onShelf` | What a count of the shelf should find: `quantity` plus `awaitingPacking`. |

A pack size's stock, summed over its batches (ADR 0034):
```json
{
  "free": 148,
  "sellable": 118,
  "awaitingPacking": 2,
  "packed": 1,
  "level": "OK",
  "stopsSellingOn": "2026-12-03",
  "expiringSoon": true
}
```
- `free`: packs free to sell, in every batch; `sellable`: those in batches that may be sold today;
- `awaitingPacking`, `packed`: as for a batch, summed;
- `level`: `OUT` when no pack may be sold, `LOW` at the pack size's `lowStockAt` or fewer (never, when it is `0`), otherwise `OK`;
- `stopsSellingOn`: the next day a batch that may be sold today and still holds packs stops selling, or `null`;
- `expiringSoon`: whether that day is within 30 days.

### GET `/v1/staff/stock`

Every pack size with its stock: drafts and packs off sale too, by product name, then in each product's own order. The stock is summed from the batches each time, so it is never out of date.

Query parameters, all optional:

| Parameter | Rules | Meaning |
|---|---|---|
| `status` | `out`, `low` or `expiring` | Only the pack sizes out of stock; low or out; or with a batch that stops selling within 30 days |
| `productId` | UUID | Only this product's pack sizes |
| `q` | 2 to 100 characters, spaces tidied | Words in the product's name or the SKU, as typed: `%` and `_` are plain characters |
| `limit` | Whole number, 1 to 100, default 100 | Pack sizes per page |
| `after` | UUID | The `nextAfter` of the previous page: continue after that pack size |

Response `200`:
```json
{
  "lines": [
    {
      "variant": { "id": "…", "sku": "ASH-CAP-60", "quantity": 60, "unit": "CAPSULES", "isActive": true, "lowStockAt": 10, "position": 0 },
      "product": { "id": "…", "name": "Ashwagandha Capsules", "isActive": true },
      "stock": { "free": 148, "sellable": 118, "awaitingPacking": 2, "packed": 1, "level": "OK", "stopsSellingOn": "2026-12-03", "expiringSoon": true }
    }
  ],
  "nextAfter": null
}
```

A page goes on after the pack size the last one ended with, even if its stock changed since and it no longer matches the filter.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed` | A bad parameter, such as `Choose out, low or expiring` or `Search with at least 2 characters` |
| `400` | `This pack size is no longer in the list: start from the first page` (field `after`) | The `after` pack size is no longer in the list: deleted, or no longer matching `productId` or `q` |
| `401` | see "Authentication errors on protected endpoints" | No staff access token, or a customer's |
| `429` | `code: "RATE_LIMITED"` | The 600 per minute limit |

### GET `/v1/staff/variants/:variantId/batches`

Every batch of the pack size, the first to expire first, which is the order in which orders take them, with the pack size and its stock.

Response `200`:
```json
{
  "variant": { "id": "…", "sku": "ASH-CAP-60", "quantity": 60, "unit": "CAPSULES", "isActive": true, "lowStockAt": 10, "position": 0 },
  "product": { "id": "…", "name": "Ashwagandha Capsules", "isActive": true },
  "stock": { "free": 148, "sellable": 118, "awaitingPacking": 2, "packed": 1, "level": "OK", "stopsSellingOn": "2026-12-03", "expiringSoon": true },
  "batches": [...],
  "quantity": 148,
  "sellableQuantity": 118
}
```
- `variant`, `product` and `stock`: as a line of `GET /v1/staff/stock` (since part 12D);
- `quantity`: every pack on hand and free to sell, in all batches (the same as `stock.free`);
- `sellableQuantity`: those in sellable batches (the same as `stock.sellable`). The shop shows the pack size as in stock while this is above 0.

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

Since part 7, orders make movements too: `ORDERED` when an order takes packs, and `RELEASED` when a cancelled or expired order gives them back. They show with `"actorId": null` (ADR 0026).

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
| `reason` | `RECEIVED` (more of this batch arrived: `change` above 0), `DAMAGED` or `EXPIRED` (written off: `change` below 0), or `CORRECTION` (a count found a difference: either way). `ORDERED` and `RELEASED` are made by orders only. |
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

### POST `/v1/staff/batches/:id/count`

Puts a batch's stock right from a count of its shelf (ADR 0034). Staff send what they counted, and what they were shown should be there when they started: the batch's `onShelf`. The API works out the difference.

Request:
```json
{ "counted": 117, "onShelf": 120, "note": "3 found broken" }
```

| Field | Rules |
|---|---|
| `counted` | The packs found on the shelf, leaving out those packed in boxes: a whole number from 0 to 1,000,000 |
| `onShelf` | The batch's `onShelf` as staff were shown it |
| `note` | Up to 200 characters. **Required when the count differs.** |

The batch is locked first. Then:
- if its `onShelf` is no longer what was sent, an order took or gave back packs while staff counted, and nothing is saved (`409`);
- if the count matches, nothing is saved, and `change` is `0`;
- otherwise one `CORRECTION` movement puts the difference right, with the note, and the audit log gets `stock.counted`, with the packs and what should have been on the shelf before and after.

A count can't go below the packs that orders waiting to be packed still need from the batch.

Response `200`:
```json
{ "batch": { ... }, "change": -3 }
```
- `batch`: the batch, as it is now;
- `change`: the packs added (above 0) or taken off (below 0), or `0`.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed` | An invalid field, or a count that differs without a note (`Say why the count differs`) |
| `401` | see above | No staff access token, or a customer's |
| `404` | `Batch not found` | No batch with this ID |
| `409` | `This batch's stock changed while you were counting. Check the new numbers and count again.` | `onShelf` is no longer the batch's |
| `409` | `Orders waiting to be packed need 3 packs of this batch, more than the count found. Check those orders before correcting the count.` | Fewer packs counted than those orders need |
| `429` | `code: "RATE_LIMITED"` | The 600 per minute limit |

## Handling orders (staff)

Every order, for staff to pack, ship and deliver (ADR 0028). These endpoints need a **staff** access token: an Admin's or a Super User's. A customer token, or none, gets `401`. **Only a Super User** sees an order's payment and cancels an order: an Admin gets `403 Only a Super User may do this.` on the cancel. Every step is written to the audit log in the same transaction, with the staff member, the client IP and the request ID. Reading is not audited. Since part 10, each step, a correction that changes something, and a cancel email the customer (see "Order emails").

| Endpoint | Purpose |
|---|---|
| `GET /v1/staff/orders` | Every order, one page at a time |
| `GET /v1/staff/orders/:id` | One order, to pack and ship it |
| `POST /v1/staff/orders/:id/packed` | A paid order is packed |
| `POST /v1/staff/orders/:id/shipped` | A packed order is handed to the courier |
| `PATCH /v1/staff/orders/:id/shipment` | Corrects the courier or tracking number of an order on its way |
| `POST /v1/staff/orders/:id/delivered` | A shipped order is delivered |
| `POST /v1/staff/orders/:id/cancel` | **Super Users only.** Cancels an order until it ships |

An order, as these endpoints return it to a Super User:
```json
{
  "id": "4f7c2a9e-3b1d-4e8a-9c6f-2d5b8e1a7c30",
  "reference": "7KQ2M9XDPA",
  "status": "SHIPPED",
  "createdAt": "2026-11-09T05:10:12.408Z",
  "holdExpiresAt": "2026-11-09T05:25:12.408Z",
  "packedAt": "2026-11-09T06:02:41.117Z",
  "shippedAt": "2026-11-09T09:30:05.902Z",
  "courierName": "Delhivery",
  "trackingNumber": "EE149081123456",
  "deliveredAt": null,
  "itemsTotalRupees": 449,
  "itemsGstRupees": 21,
  "deliveryChargeRupees": 49,
  "totalRupees": 498,
  "items": [
    {
      "sku": "ASH-CAP-60",
      "productName": "Ashwagandha Capsules",
      "quantity": 60,
      "unit": "CAPSULES",
      "packs": 1,
      "mrpRupees": 500,
      "priceRupees": 449,
      "lineTotalRupees": 449,
      "gstRate": 5,
      "gstRupees": 21,
      "hsnCode": "300490"
    }
  ],
  "delivery": {
    "fullName": "Asha K",
    "phone": "9845012345",
    "line1": "12, 3rd Cross, Indiranagar",
    "line2": null,
    "city": "Bengaluru",
    "state": "Karnataka",
    "pincode": "560038"
  },
  "payment": {
    "razorpayOrderId": "order_RB58MiP5SPFYyM",
    "razorpayPaymentId": "pay_G3P9vcIhRs3NV4",
    "amountRupees": 498,
    "paidAt": "2026-11-09T05:12:30.514Z",
    "createdAt": "2026-11-09T05:11:02.233Z",
    "refunds": []
  }
}
```

| Field | Meaning |
|---|---|
| `status` | `PAID`, then `PACKED`, `SHIPPED` and `DELIVERED`. The others are as in "Checkout and orders". |
| `packedAt`, `shippedAt`, `deliveredAt` | When staff took each step, or `null` until then. A packed order that was cancelled keeps its `packedAt`. |
| `courierName`, `trackingNumber` | Set when the order ships, or `null` until then |
| `items` | As the customer sees them, with each product's `hsnCode` |
| `delivery` | Where it goes: the name, phone and address the customer chose. The customer's email and account are not shown. |
| `payment` | **Super Users only:** an Admin's answer has no `payment` field. `null` before paying starts. Otherwise Razorpay's order ID, the ID of the payment that paid it (`null` until paid), the amount, when it was paid, when paying started, and every refund, the oldest first, as `GET /v1/staff/refunds` shows them but without `orderId` and `orderReference`. |

### GET `/v1/staff/orders`

Every order, **one page at a time**, the newest first unless asked otherwise.

Query parameters, all optional:

| Parameter | Rules | Meaning |
|---|---|---|
| `limit` | Whole number, 1 to 100, default 50 | Orders per page |
| `after` | UUID | The `nextAfter` of the previous page: continue just after it |
| `status` | An order status, such as `PAID`, else `Use an order status, such as PAID or PACKED` | Only orders in this status |
| `reference` | 10 letters and digits, small letters too, else `An order reference has 10 letters and digits` | Only the order a customer quoted |
| `sort` | `newest` (the default) or `oldest`, else `Use newest or oldest` | By when the order was placed |

The filters combine, and any other parameter is ignored. `?status=PAID&sort=oldest` is the work to pack, in turn.

Response `200`:
```json
{
  "orders": [
    {
      "id": "4f7c2a9e-3b1d-4e8a-9c6f-2d5b8e1a7c30",
      "reference": "7KQ2M9XDPA",
      "status": "PAID",
      "totalRupees": 498,
      "deliveryName": "Asha K",
      "deliveryCity": "Bengaluru",
      "deliveryState": "Karnataka",
      "createdAt": "2026-11-09T05:10:12.408Z"
    }
  ],
  "nextAfter": null
}
```
`nextAfter` is `null` on the last page.

Errors: `400 Validation failed` (a bad parameter, named in `errors`); `401`; `429` (the 600 per minute limit).

### GET `/v1/staff/orders/:id`

Response `200`: the order, with its payment for a Super User.

Errors: `400` (the ID is not a UUID); `401`; `404 Order not found`; `429` (the 600 per minute limit).

### POST `/v1/staff/orders/:id/packed`

Marks a paid order packed. No body. Written to the audit log as `order.packed`.

Response `200`: the order, now `PACKED`, with `packedAt`.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed (uuid is expected)` | The ID is not a UUID |
| `401` | see "Authentication errors on protected endpoints" | No valid staff access token, or a customer token |
| `404` | `Order not found` | No such order |
| `409` | `This order is packed already.` | It was packed before, maybe by someone else. Nothing changed. |
| `409` | `Only a paid order can be packed.` | The order is in another status |
| `429` | `code: "RATE_LIMITED"` | The 600 per minute limit |

### POST `/v1/staff/orders/:id/shipped`

Marks a packed order shipped, once the courier has it. Written to the audit log as `order.shipped`, with the courier and the tracking number.

Request:
```json
{ "courierName": "Delhivery", "trackingNumber": "ee 1490 8112 3456" }
```

| Field | Rules |
|---|---|
| `courierName` | The courier staff booked: 2 to 60 characters, else `Name the courier in 2 to 60 characters`. Spaces at the ends are dropped, and each run of spaces becomes one. |
| `trackingNumber` | 4 to 40 letters, digits or hyphens, starting with a letter or digit, else `A tracking number has 4 to 40 letters, digits or hyphens`. Spaces are dropped and letters made capitals: `ee 1490 8112 3456` is stored as `EE149081123456`. |

Response `200`: the order, now `SHIPPED`, with `shippedAt`, `courierName` and `trackingNumber`.

Errors: as for `packed`, with `400 Validation failed` for a missing or wrong field, and `409 This order has shipped already.` or `409 Only a packed order can be shipped.`

### PATCH `/v1/staff/orders/:id/shipment`

Corrects a typing mistake in the courier, the tracking number or both, while the order is `SHIPPED`. Send only what changes, by the same rules. The order is locked meanwhile, so two corrections take turns. Written to the audit log as `order.shipment_corrected`, with only the fields that changed. A correction that changes nothing writes no entry.

Response `200`: the order as it is now.

Errors: `400 Validation failed`, also with `Nothing to change` for an empty body; `401`; `404 Order not found`; `409 Only an order on its way can have its courier or tracking number corrected.` (it hasn't shipped yet, or it is delivered or cancelled); `429` (the 600 per minute limit).

### POST `/v1/staff/orders/:id/delivered`

Marks a shipped order delivered, once the courier says so. No body. Written to the audit log as `order.delivered`.

Response `200`: the order, now `DELIVERED`, with `deliveredAt`.

Errors: as for `packed`, with `409 This order is delivered already.` or `409 Only a shipped order can be marked delivered.`

### POST `/v1/staff/orders/:id/cancel`

**Super Users only.** Cancels an order until it ships: while it waits for payment, is paid or is packed. In one transaction, its stock comes back, and a paid order's payment goes back in full: a refund with the reason `CANCELLED_BY_STAFF` is saved, and asked of Razorpay just after. Written to the audit log as `order.cancelled`, with the status before, and the refund's ID for a paid order.

Response `200`: the order, now `CANCELLED`. A paid one shows its refund in `payment.refunds`: `PENDING` once Razorpay has taken it, or `REQUESTED` while the API asks again.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed (uuid is expected)` | The ID is not a UUID |
| `401` | see "Authentication errors on protected endpoints" | No valid staff access token, or a customer token |
| `403` | `Only a Super User may do this.` | Called by an Admin |
| `404` | `Order not found` | No such order |
| `409` | `This order can no longer be cancelled.` | The order has shipped, or it is delivered, cancelled or expired |
| `429` | `code: "RATE_LIMITED"` | The 600 per minute limit |

- **A packed order's packs go back into stock at once:** staff unpack it, and put the packs back on the shelf.
- **Each refund costs Razorpay's fee,** about 2.36% of the order (ADR 0027).

## Refunds (Super Users only)

### GET `/v1/staff/refunds`

Every refund, **newest first, one page at a time**, each naming its order by its ID and its reference (ADR 0028, ADR 0037). Needs a **Super User's** staff access token: an Admin gets `403 Only a Super User may do this.` Reading is not audited.

Query parameters, all optional:

| Parameter | Rules | Meaning |
|---|---|---|
| `limit` | Whole number, 1 to 100, default 50 | Refunds per page |
| `after` | UUID | The `nextAfter` of the previous page: continue just after it |
| `status` | `REQUESTED`, `PENDING`, `PROCESSED` or `FAILED`, else `Use REQUESTED, PENDING, PROCESSED or FAILED` | Only refunds in this status |
| `givenBack` | `true` or `false`, else `Use true or false` | `false`: only those not given back by hand. `true`: only those that were (since part 12G) |

Response `200`:
```json
{
  "refunds": [
    {
      "id": "c3d2e1f0-9a8b-4c7d-8e6f-5a4b3c2d1e0f",
      "razorpayPaymentId": "pay_G3P9vcIhRs3NV4",
      "razorpayRefundId": "rfnd_RCe7Qm0LhZ2xYw",
      "amountRupees": 498,
      "reason": "CANCELLED_BY_STAFF",
      "status": "PENDING",
      "createdAt": "2026-11-10T17:08:32.294Z",
      "updatedAt": "2026-11-10T17:08:33.010Z",
      "givenBackAt": null,
      "givenBackNote": null,
      "givenBackBy": null,
      "orderId": "4f7c2a9e-3b1d-4e8a-9c6f-2d5b8e1a7c30",
      "orderReference": "7KQ2M9XDPA"
    }
  ],
  "nextAfter": null
}
```

| Field | Meaning |
|---|---|
| `reason` | `ORDER_EXPIRED`, `ORDER_CANCELLED` or `ALREADY_PAID`: a payment that couldn't be kept (see "Paying for an order"). `CANCELLED_BY_CUSTOMER` or `CANCELLED_BY_STAFF`: a paid order cancelled before it shipped. |
| `status` | As in "Paying for an order". **`FAILED` means Razorpay refused it:** staff give the money back by hand, in the Razorpay dashboard. |
| `razorpayRefundId` | Razorpay's refund ID, once Razorpay has taken the refund, else `null` |
| `orderId` | The order it belongs to: see it with `GET /v1/staff/orders/:id` |
| `orderReference` | That order's reference, as the customer quotes it (since part 12F) |
| `givenBackAt`, `givenBackNote`, `givenBackBy` | For a `FAILED` refund a Super User gave back by hand: when, how, and who (`id` and `fullName`). All `null` otherwise (since part 12G) |

`?status=FAILED&givenBack=false` lists the refunds still to give back by hand. `nextAfter` is `null` on the last page.

Errors: `400 Validation failed` (a bad parameter, named in `errors`); `401`; `403 Only a Super User may do this.` (an Admin); `429` (the 600 per minute limit).

### POST `/v1/staff/refunds/:id/given-back`

A refund Razorpay could not give back (`FAILED`), which a Super User gave back another way: in the Razorpay dashboard, or by a bank transfer (ADR 0038). They say how, once. Needs a **Super User's** staff access token.

Request:
```json
{ "note": "Bank transfer, UTR 412345678901, on 20 Nov" }
```
Rules: the note is trimmed, and Windows line breaks are made plain. Then 3 to 500 characters, else `Say how the money was given back, in 3 to 500 characters`.

Response `200`: the refund as `GET /v1/staff/refunds` lists it, with `givenBackAt`, `givenBackNote` and `givenBackBy` set. Its `status` stays `FAILED`.

- **Once only, and atomic:** of two Super Users at the same moment, one wins, and the other gets `409`.
- **The audit log** gets `order.refund_given_back` on the refund's order, with the refund's ID, the amount, the time and the note, so the order's history shows it.
- **No email:** whoever gave the money back tells the customer.
- **The database holds the rules too:** the three fields come together, only on a `FAILED` refund, only with a Super User, and never change afterwards.

Errors:

| Status | Body | When |
|---|---|---|
| `400` | `Validation failed` | A missing note, or one too short or too long |
| `400` | `Validation failed (uuid is expected)` | The ID is not a UUID |
| `401`, `403` | as for `GET /v1/staff/refunds` | |
| `404` | `Refund not found` | No refund with this ID |
| `409` | `Only a refund Razorpay could not give back is given back by hand.` | The refund is not `FAILED` |
| `409` | `This refund is already marked as given back by hand.` | Someone marked it already |
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
| `kind` | `accounts`, `sign_ins`, `orders`, `catalog`, `stock` or `policies`, else `Use accounts, sign_ins, orders, catalog, stock or policies` | Only one kind of change (since part 12G, ADR 0038): `accounts` is every `admin.` action, `super_user.created` and `staff.mfa_set_up`; `sign_ins` is `staff.signed_in`; `orders` every `order.` action; `catalog` every `category.`, `product.`, `variant.` and `image.` action; `stock` every `batch.` and `stock.` action; since part 14B, `policies` every `policy.` action |
| `actorId` | UUID | Only what this account did |
| `targetId` | 1 to 100 characters | Only entries about this target, for example an Admin's, a category's, a product's, a pack's, an image's, a batch's or an order's ID |

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
      "requestId": "fe5c63ec-...",
      "subject": null
    }
  ],
  "nextBefore": "1ebda37e-6c2d-4f41-9a7b-2c0d5e8f4a13"
}
```
- `actor`: the account that acted, or `null` for the developer commands or an account that no longer exists. `actorId` stays either way.
- `target`: the account an entry is about, for user targets only. It is `null` for other targets, such as the session of a `staff.signed_in`, a category, a product, a pack, an image or a batch, and for removed accounts.
- `subject` (since part 12G): what any other target is called now, `{ "name": …, "parent": { "id": …, "name": … } }`, so a client can say it in words. A category or a product by its name; a pack by its SKU, with its product as `parent`; an image by its description (`name` may be `null`), with its product; a batch by its batch number, with its pack (by SKU); an order by its reference. `null` when the thing no longer exists, or for any other target, such as an account or a session.
- `before` and `after`: the relevant fields before and after the change, never a password, secret or token.
- `nextBefore`: send it as `?before=` to get the next, older page. It is `null` on the last page.

Actions today: `super_user.created`, `staff.mfa_set_up`, `staff.signed_in`, `admin.invited`, `admin.invite_accepted`, `admin.invitation_resent`, `admin.disabled`, `admin.enabled`, `admin.removed`, since part 4A `category.created`, `category.updated` (with only the fields that changed) and `category.deleted` (with what was deleted), since part 4B `product.created`, `product.updated` and `product.deleted`, which work the same way, since part 4C `variant.created`, `variant.updated` and `variant.deleted` for pack sizes, since part 4D `image.created`, `image.updated` and `image.deleted` for product images, since part 5 `batch.received`, `batch.updated` and `stock.changed` for stock (with the quantity before and after, the change, the reason and the note), and since part 9 `order.packed`, `order.shipped` (with the courier and tracking number), `order.delivered`, `order.shipment_corrected` (with only the fields that changed) and `order.cancelled` (with the status before, and the refund's ID for a paid order) for orders, and since part 12G `admin.authenticator_reset` (with when the new link ends) and `order.refund_given_back` (on the order, with the refund's ID, the amount, the time and the note), and since part 14B `policy.draft_saved`, `policy.draft_discarded` and `policy.published` (see "Policy pages (Super Users only)"), and since part 15A `brand.created`, `brand.updated` and `brand.deleted`. Since part 15A, a category entry also keeps `parentId`, the top category it sits in, and a product entry `otherCategoryIds`, the other categories it is also shown in; a product moved within one of those is a `product.updated` with `otherCategoryPosition` (the category and its place) before and after. Since part 12G, an Admin who sets up their app from an emailed link writes `staff.mfa_set_up` as the actor. A price change is a `variant.updated` with the old and new price. A `product.deleted` entry also keeps the product's packs and images, in `before.variants` and `before.images`. A development database may also hold `dev.append_only_check`, the entry that tested the append-only triggers in part 3B-1.

Errors: `400 Validation failed` (a bad parameter, named in `errors`); `401` and `403` (as for the Admin endpoints); `429` (the 600 per minute limit).

Rules for clients:
- **Page with `nextBefore`, never by counting.** New entries arrive at the top all the time, and the cursor keeps the pages stable.
- An unknown `before` gives an empty page.

## Policy pages (Super Users only)

Super Users write the five policy pages in the console: a draft only they see, then Publish, which adds a version customers see (ADR 0040). Every endpoint needs a **Super User's** staff access token: an Admin gets `403 Only a Super User may do this.` `:page` is `privacy`, `terms`, `refunds`, `shipping` or `contact`; any other word answers `404 Policy page not found`.

**The revision.** Each page has a `revision`, 0 until its first change, which goes up by one with every save, discard and publish. Each change names the revision it was made on. If the page changed meanwhile, the API answers `409 This page was saved, published or discarded since you opened it. Open it again to see the newest text.` and changes nothing, so a Super User never overwrites another's work unseen.

### GET `/v1/staff/policies`

The five pages, in the website's order, without their texts.

Response `200`:
```json
{
  "pages": [
    {
      "page": "privacy",
      "revision": 4,
      "draft": { "updatedAt": "2026-11-21T11:02:44.091Z", "updatedBy": { "id": "5d1e8c2a-7b3f-4e9a-a1c6-2f8d0b4e7a93", "fullName": "Dev Super One" } },
      "published": { "version": 1, "publishedAt": "2026-11-21T10:42:07.512Z", "publishedBy": { "id": "5d1e8c2a-7b3f-4e9a-a1c6-2f8d0b4e7a93", "fullName": "Dev Super One" } }
    }
  ]
}
```
`draft` and `published` are `null` when the page has none.

### GET `/v1/staff/policies/:page`

One page, with both texts: `{ "page", "revision", "draft": { "body", "updatedAt", "updatedBy" } | null, "published": { "version", "body", "publishedAt", "publishedBy" } | null }`.

### PUT `/v1/staff/policies/:page/draft`

Saves the draft.

Request:
```json
{ "body": "We keep only what we need…", "revision": 4 }
```
Rules:
- `body`: line ends made Unix ones, spaces and blank lines trimmed from both ends. Then 1 to 30,000 characters, else `Write the page first` or `A page holds at most 30,000 characters`. No control characters other than tab and line end, else `The text has hidden control characters: paste it as plain text`.
- `revision`: the page's revision when the text was opened, a whole number from 0.

Response `200`: the page, as `GET /v1/staff/policies/:page`, with its new revision. Saving the same text again changes nothing, not even the revision.

### DELETE `/v1/staff/policies/:page/draft?revision=5`

Discards the draft. The text on the website stays. Response `200`: the page, with `draft: null`.

### POST `/v1/staff/policies/:page/publish`

Puts the saved draft on the website as the next version, numbered 1, 2, 3 … with no gaps, and clears the draft.

Request:
```json
{ "revision": 5 }
```
The revision the Super User previewed, so exactly that text goes live. Response `200`: the page, with the new version in `published` and `draft: null`.

- `409 There is no draft to publish.` without a draft.
- `409 Nothing to publish: the draft is the same as the text on the website.`
- The website keeps the API's answers for up to a minute (ADR 0039): customers see the new version within a minute.

### GET `/v1/staff/policies/:page/versions`

The versions customers were shown, **newest first, one page at a time** (since part 14B), without their texts.

Query parameters, both optional:

| Parameter | Rules | Meaning |
|---|---|---|
| `limit` | Whole number, 1 to 100, default 20 | Versions per page |
| `before` | Whole number from 1 | The `nextBefore` of the previous page: continue with the versions below it |

Response `200`:
```json
{
  "versions": [
    { "version": 3, "publishedAt": "2026-11-22T09:15:30.004Z", "publishedBy": { "id": "5d1e8c2a-7b3f-4e9a-a1c6-2f8d0b4e7a93", "fullName": "Dev Super One" } }
  ],
  "nextBefore": null
}
```
`nextBefore` is `null` on the last page. Any other parameter is ignored.

### GET `/v1/staff/policies/:page/versions/:version`

One version, with its text: `{ "page", "version", "body", "publishedAt", "publishedBy" }`. `404 Version not found` for one that doesn't exist; a version that isn't a whole number from 1 is `400`.

**The audit log** gets `policy.draft_saved`, `policy.draft_discarded` and `policy.published`, about the page (`targetType` `policy_page`, `targetId` the page's word), with the revision before and after, the version, and the number of characters, never the text. Reading is not audited. **The database holds the rules too:** only a Super User saves or publishes, a revision only goes forward, and a version is never changed or deleted.

Errors for all of them: `400 Validation failed` (a bad body or parameter, named in `errors`); `401`; `403 Only a Super User may do this.`; `404 Policy page not found`; `409` as above; `429` (the 600 per minute limit).

## Not yet implemented

Changing the email address, a verified phone number, deleting an account, a list of active sessions, and staff password changes. Of orders: GST invoices, emails about them and their payments, returns and their refunds, and a courier integration. Of stock: a list of batches near their expiry. Image files from object storage behind a CDN, before production. See `docs/requirements.md`, ADR 0007, ADR 0014 to ADR 0028 and `docs/security.md`.
