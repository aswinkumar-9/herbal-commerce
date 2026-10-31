# 0016. Managing Admins

- Status: Accepted and implemented (part 3B-5)
- Date: 2026-10-31

## Context

ADR 0004 and `docs/requirements.md` (section 5, rule 4) say that only a Super User creates, disables and removes Admins, and that every change is audited. Part 3B-4 (ADR 0015) built the creation part, the Admin invitation. A Super User still could not:

- see which Admins exist, and which have not accepted their invitation yet;
- disable an Admin, for example someone leaving the company;
- remove an Admin;
- send a new invitation when the first one expired or got lost.

Part 3B-5 adds these four, and nothing else. The Super Users' view of the audit log, and the open question of staff sign-ins in the audit log, move to part 3B-6.

## Decision

### Four routes, for Super Users only

They all live in `StaffAdminsController`, which is `@SuperUserOnly()` as a whole (ADR 0015), so an Admin gets `403` on every one of them.

| Endpoint | Purpose | Answer |
|---|---|---|
| `GET /v1/staff/admins` | All Admins, oldest first | `200 { "admins": [...] }` |
| `PATCH /v1/staff/admins/:id` | Disable or enable: `{ "status": "DISABLED" }` or `"ACTIVE"` | `200` with the Admin |
| `DELETE /v1/staff/admins/:id` | Remove a disabled or pending Admin | `204` |
| `POST /v1/staff/admins/:id/invitation` | Send a pending Admin a new invitation | `201`, as for the first invitation |

### The rules every one of them shares

- **Only Admins.** A Super User's ID is answered like an unknown one: `404 Admin not found`. Super Users are managed only with the developer command (ADR 0012).
- **IDs are checked before any database query.** A path ID that is not a UUID gets `400` from `ParseUUIDPipe`. PostgreSQL would refuse it anyway, and that would surface as a `500`.
- **The condition is part of the write.** Each change is an `updateMany` or `deleteMany` whose `WHERE` holds the rule ("not already disabled", "disabled or pending", "still pending and active"). The database then decides atomically, so two clicks at the same moment cannot both change something, or write two audit entries.
- **Each change and its audit entry share one transaction,** with the Super User as the actor, the client IP and the request ID (`@CurrentAuditContext()`, ADR 0015).

### The list

- **Fields:** `id`, `email`, `fullName`, `status`, `invitationAcceptedAt`, `invitationExpiresAt`, `mfaEnabledAt` and `createdAt`.
  - `invitationAcceptedAt` is the account's `emailVerifiedAt`: for an Admin, the email is verified when the invitation is accepted. It is `null` while the Admin is pending.
  - `invitationExpiresAt` is when the newest unused invitation ends, or `null` if there is none.
- **Never** the password hash or the MFA secret. The query's `select` is an allow-list, and a test checks its exact keys.
- **One query** fetches the Admins together with their newest unused invitation, rather than one query per Admin.
- **No paging,** because there are only a few Admins. The answer is an object (`{ "admins": [...] }`), so paging can be added later without breaking clients.
- **Not audited.** The audit log records changes, not reads.

### Disabling and enabling

- **Asking for the status the Admin already has changes nothing:** `200` with the Admin, no audit entry and no log line. A client can therefore safely send the same request twice.
- **Disabling also ends every session of the Admin,** in the same transaction. The guard would refuse a disabled Admin at once anyway, because it checks the status on every request (ADR 0015). But the sessions would still exist, and enabling the Admin later would bring them back to life.
- **Audit:** `admin.disabled` or `admin.enabled`, with the status before and after.
- **A disabled pending Admin cannot accept their invitation** (ADR 0015, `not_allowed`). Enabling them makes the link work again, as long as it has not expired.

### Removing

- **Only a disabled Admin, or a pending one** (who never accepted the invitation). An active Admin who can sign in gets `409 Disable this Admin before removing them.`
  - So one wrong click cannot remove someone who is still working, and removal always follows the two clear steps: disable (sessions end), then remove.
  - A pending Admin never could sign in, so they can go straight away.
- **It deletes the account.** Its sessions, refresh tokens and invitations go with it, through the foreign keys (`ON DELETE CASCADE`). Its access tokens stop working at once, because the guard finds no session.
- **The audit entry `admin.removed` keeps who it was:** email, name, status, `invitationAcceptedAt` and `mfaEnabledAt`, read just before the delete. The entry has no foreign key (ADR 0012), so it outlives the account, and it is the only record left of it.
- **Deleted nothing** means the Admin is still active, or someone removed them at the same moment. A quick count tells the two apart, so the answer is honestly `409` or `404`.

### Inviting again

- **Only for an active, pending Admin.** One who has accepted gets `409 This Admin has already accepted the invitation.`, and a disabled one gets `409 Enable this Admin before inviting them again.`
- **Every older link stops working.** Their rows are deleted, so they fail like made-up links (`unknown_token` in the log). Only the newest link works, just as only the newest MFA key does (ADR 0013).
- **The new link** works for 72 hours, once, and only its hash is stored, as in ADR 0015. The email goes out after the commit, and `invitationSent: false` reports a failure.
- **Limits:** the per-IP `staffInvites` limit, shared with the first invitation, and `emailsToAddress`, the 5 emails per hour to one address that the customer emails use (ADR 0009). The first invitation does not count against the second limit, because each address can be invited only once.
- **Audit:** `admin.invitation_resent`, with when the new link ends.
- **An Admin may accept an old link at the same moment.** The transaction is written for that:
  - **The same lock order as accepting:** the invitation rows first, then the Admin's row. Opposite orders could make the two transactions wait for each other (a deadlock), and PostgreSQL would abort one with a `500`.
  - **The conditional update** (`emailVerifiedAt: null`) checks the Admin is still pending, and holds their row until the end. An acceptance either finishes first, and this request gets `409`, or finds its link gone.
  - **Refusals are thrown inside the transaction, never returned.** Returning would commit the deleted old links. A `429` from the address limit rolls back the same way.

### Logs

`Admin status changed` (user ID, actor ID, new status), `Admin removed` (user ID, actor ID) and `Admin invitation sent again` (user ID, actor ID, whether the email went out). The email address and the token are never logged.

## Alternatives considered

- **Removing an active Admin in one step.** Rejected. One wrong click would remove someone who is working, and "disable first" is cheap.
- **Soft delete** (a `REMOVED` status, or a `deletedAt` column). Not now. Nothing refers to an Admin yet except their sessions and invitations, and the audit entry keeps who they were. Once orders or shipments record which Admin handled them, removing may have to become "disable for good" instead.
- **`409` for "already disabled".** Rejected. An idempotent `200` is easier for clients and changes nothing.
- **Separate `POST .../disable` and `POST .../enable` routes.** Rejected. One `PATCH` with the wanted status is idempotent, and leaves room for later fields such as the name.
- **Keeping old invitation links valid after inviting again.** Rejected. Two working links double the chance of one being misused, and confuse the Admin.
- **Letting the database refuse a malformed ID.** Rejected. That surfaces as a `500`, not a `400`.
- **Paging the list now.** Not now: there are only a few Admins.

## Consequences

- **A Super User can now manage the whole life of an Admin through the API:** invite, invite again, disable, enable and remove. The development-only database delete from ADR 0015 is no longer needed.
- **A removed Admin's history stays in the audit log, under an ID that no longer exists.** Its last entry, `admin.removed`, says who it was.
- **Disabling does not delete anything.** A disabled Admin keeps their password and MFA. When enabled again, they sign in as before, with a new code.
- **The same email can be invited again after a removal.** The new account has a new ID, and the audit log shows both.
- In this part's test, an empty PowerShell variable turned `DELETE /v1/staff/admins/<id>` into `DELETE /v1/staff/admins/`, a route that does not exist, and the API answered `404`. The README's troubleshooting tells the two kinds of `404` apart.
- The smoke test checks on every run that a customer token gets `401` on all four routes. The routes themselves need a signed-in Super User with a phone, so they are tested by hand (README, "Manage Admins").
- Next: part 3B-6, a Super Users' view of the audit log, and the decision on staff sign-ins in the audit log.
