# 0019. Delivery addresses

- Status: Accepted and implemented (part 3C-2)
- Date: 2026-11-01

## Context

Checkout will need to know where to deliver. `docs/requirements.md` puts "profile, addresses" in the MVP scope, and part 3C-1 (ADR 0018) covered the rest of the customer's own account.

These are the first objects that a customer owns and reaches **by ID**. That makes broken object level authorization (BOLA), reading or changing someone else's object by changing an ID, a real risk for the first time on the customer side. `docs/security.md` has the rule for it: every query names the owner, and another customer's object answers `404`.

## Decision

### The table

`addresses` holds, per customer:
- `fullName`: who receives the parcel;
- `phone`: a mobile number for the courier;
- `line1` and, optionally, `line2`;
- `city`, `state` and `pincode`;
- `isDefault`, with `createdAt` and `updatedAt`.

The addresses go with the account when it is deleted (`ON DELETE CASCADE`), for example an unverified sign-up after 7 days (ADR 0011).

### Indian addresses only, checked and cleaned

The launch market is India (`docs/requirements.md`), so there is no country field yet.

| Field | Rule | Stored as |
|---|---|---|
| `phone` | A 10-digit Indian mobile number, starting with 6 to 9. Spaces, hyphens and a leading `+91`, `91` or `0` are allowed. | `9845012345` |
| `pincode` | 6 digits, not starting with 0. A space is allowed. | `560038` |
| `state` | One of the 28 states and 8 union territories, spelled exactly | as listed |
| `fullName`, `line1`, `city` | 1 to 100, 200 and 100 characters | trimmed |
| `line2` | optional, up to 200 characters | an empty value is `null` |

- **Clean first, then check** (zod `transform` then `pipe`). Customers type naturally, and the database holds one form. The courier always gets a usable number.
- **The state comes from a fixed list,** never free text. GST will depend on the state of delivery (tax within one state differs from tax between two), so a typo must not get in.
- **Phone numbers and PIN codes are text,** not numbers: nobody does arithmetic on them, and nothing may drop a leading digit.

### Exactly one default address

- **The first address always becomes the default,** even when the request says otherwise.
- **A later address becomes the default only when asked.** The old default stops being it first.
- **Removing the default makes the newest remaining address the default.** It is looked up after the delete, so the removed one is never picked.
- **`isDefault` can be set to `true` in a change, never to `false`:** an address stops being the default only when another one becomes it.
- **The database guarantees it too,** with a *partial unique index*: `UNIQUE ("userId") WHERE "isDefault" = true`. At most one row per customer may have `isDefault` true. Prisma 7.10 describes such an index with the preview feature `partialIndexes` (`@@unique([userId], where: { isDefault: true })`). Prisma therefore writes the SQL itself, and never removes the index at a later migration.

### Ownership: BOLA prevented in the query

- **The customer always comes from the access token.** A `userId` in a body is dropped, and the answers never contain one.
- **Every query names the owner:** `where: { id, userId }` to find, change or delete, and `where: { userId }` to list or count.
- **Someone else's address answers `404 Address not found`,** exactly like one that does not exist. `403` would confirm that the ID belongs to somebody.
- **Path IDs must be UUIDs** (`400` otherwise, ADR 0016).

### One change at a time per customer

- Every add, change or removal starts by **locking the customer's own row** in `users`: `SELECT id FROM users WHERE id = $1 FOR UPDATE`, inside the transaction.
- **A double tap** (two requests at the same moment) then takes turns:
  - two first addresses are both saved, with exactly one default;
  - two adds at 9 addresses cannot reach 11.

  Without the lock, the partial index would refuse the second default with a `500`.
- **Other customers never wait:** the lock covers one row.
- **The statement is a tagged template** (`` $queryRaw`... ${userId}::uuid ...` ``). The ID travels as a parameter, never as SQL text. It is the second raw SQL statement in the API, after the health check's `SELECT 1`.

### Limits

- **At most 10 addresses per customer:** `409 You can save at most 10 addresses. Remove one first.`
- **Only the per-IP baseline rate limit,** since the count is capped and each change is a small write.
- **Not in the audit log:** these are customers' own changes (ADR 0018).

### Endpoints

| Endpoint | Purpose | Answer |
|---|---|---|
| `GET /v1/me/addresses` | The customer's addresses, the default first, then the newest | `200 { "addresses": [...] }` |
| `POST /v1/me/addresses` | Add an address | `201` with the address |
| `PATCH /v1/me/addresses/:id` | Change it, or make it the default | `200` with the address |
| `DELETE /v1/me/addresses/:id` | Remove it | `204` |

## Alternatives considered

- **A free-text state.** Rejected: GST needs a reliable state, and the list is short and stable.
- **Storing the phone in international form (`+919845012345`).** Not now. India only for the MVP, and adding the prefix later is a simple migration.
- **Enforcing "one default" in code only.** Rejected. A double tap or a bug could leave two defaults. The partial unique index makes it impossible.
- **Adding the partial index by hand to the migration SQL,** as for the audit-log triggers (ADR 0012). Rejected: Prisma manages indexes, and would drop one it does not know at the next migration. The preview feature lets the schema describe it.
- **Retrying on a unique violation, instead of locking.** Rejected. It handles the default, but not the limit of 10, and it is harder to reason about.
- **`403` for someone else's address.** Rejected for the reason above.
- **Soft delete** (keeping removed addresses). Not now. Orders (later) should copy the address they ship to, so an order never depends on an address that can change or go away.

## Consequences

- Checkout (later) can offer the default address, and copy the chosen address into the order.
- **The smoke test proves both guarantees on every run, against the real database:**
  - two first addresses sent at the same moment are both saved, with exactly one default;
  - a second customer sees none of the first one's addresses, and gets `404` when changing or removing one.

  It has 54 checks in total.
- **Addresses and phone numbers are personal data** (DPDP Act). They are only ever shown to their owner, go with the account, and belong on the list of personal data that is still to be written (`docs/security.md`).
- **The phone is not verified.** A customer could enter someone else's number. Verifying it with an OTP is still an open decision (`docs/requirements.md`).
- This completes part 3C, the customer's account. Still open for customers: changing the email address, a verified phone, deleting the account, and a list of active sessions.
