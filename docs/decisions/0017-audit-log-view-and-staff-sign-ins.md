# 0017. The audit log view and staff sign-ins

- Status: Accepted and implemented (part 3B-6)
- Date: 2026-11-01

## Context

Since part 3B-1 (ADR 0012), every staff change has been written to the append-only `audit_log`. Parts 3B-4 and 3B-5 (ADR 0015, ADR 0016) added the Admin changes, each with the actor, the client IP and the request ID. Two things were still missing:

- **Nobody could read the log through the API.** `docs/requirements.md` gives Super Users access to the audit log, but the only way in was a database query.
- **Staff sign-ins were in the application log only.** ADR 0014 left open whether they belong in the audit log, and ADR 0015 and ADR 0016 moved that question here, to be decided together with the view.

## Decision

### Reading the log: `GET /v1/staff/audit-log`

- **For Super Users only** (`@SuperUserOnly()` on the whole controller). An Admin gets `403`, and a customer token `401`.
- **Newest first, one page at a time.** The order is by `createdAt`, then by `id`, so two entries with the same timestamp keep their order on every page.
- **Paging with a cursor, not page numbers.**
  - Each page ends with `nextBefore`, the ID of its last entry, or `null` on the last page. Sending it back as `?before=` returns the next, older page.
  - New entries keep arriving at the top. With `?page=2`, every new entry would shift the pages, so a reader would see an entry twice or miss one. A cursor always continues right after the last entry seen.
  - The query asks for one entry more than the page holds. If it comes back, an older page exists, so no count is needed.
  - It uses Prisma's own cursor (`cursor` and `skip: 1`). An unknown cursor gives an empty page, not an error.
- **Filters, all optional, combined:** `action` (for example `admin.removed`), `actorId` (who acted) and `targetId` (whom or what it was about).
- **The query is checked first** (`auditLogQuerySchema`):
  - `limit` is a whole number from 1 to 100, and 50 by default;
  - `before` and `actorId` must be UUIDs, and `action` must look like `thing.verb`;
  - unknown parameters are dropped, so nothing else can reach the database query.
- **Each entry names the people in it.** `actor` and, for user targets, `target` give the account's ID, email, name and role.
  - All of them come from **one** extra query for the whole page.
  - A removed account shows `null`. Its ID stays in the entry, and its `admin.removed` entry says who it was (ADR 0016).
- **Reading is not audited,** the same as the Admin list. The audit log records changes.
- **The code lives in two places:** `AuditReaderService` sits in the audit module, which owns the table, next to the writer `AuditService`. The route, `StaffAuditLogController`, is a staff route like the others.

### Staff sign-ins in the audit log

- **Every successful staff sign-in writes `staff.signed_in`.** The actor is the staff member, the target is the new session (`targetType: "session"`), and the entry has the exact client IP and the request ID.
- **The entry and the session are saved in one transaction.** If writing the entry fails, there is no session and no tokens either.
  - `SessionService.start` takes an optional `alsoSave` function, which runs inside the transaction that creates the session.
  - The session service knows nothing about the audit log: the staff sign-in passes the function.
  - Without `alsoSave`, as for customers, no transaction is opened, and nothing changes.
- **Failed sign-ins are not in the audit log.**
  - Anyone on the internet can cause them, and the audit log can never be cleaned. Recording failures would let an attacker fill it.
  - They stay in the application log, with a reason and the user ID (ADR 0014), and they count against the failed-login limits (ADR 0009).
- **Customers' sign-ins are not in the audit log either.** It is for staff actions (ADR 0004).
- **Signing out is not audited.** The session itself records when it ended, and sessions are kept for 30 days after that (ADR 0011).
- **The login handler now takes two addresses:** the rate-limit key, where an IPv6 address is cut to its /64 block (ADR 0009), and the exact address for the audit entry.

## Alternatives considered

- **Page numbers (`?page=2`, or `skip`).** Rejected for the shifting described above, and because skipping gets slower as the log grows.
- **A cursor made of the timestamp and the ID** (encoded by the server). Not needed. Prisma's cursor on the unique ID does the same, and the answer stays a plain ID.
- **Recording failed sign-ins too.** Rejected: the log could be flooded and never cleaned. Their reasons are in the application log, which has a retention period (planned, `docs/security.md`).
- **Writing the sign-in entry after the session, outside the transaction.** Rejected. A crash between the two would leave a session without its entry, against the rule of ADR 0012.
- **Letting `SessionService` call `AuditService` itself.** Rejected. Sessions would then depend on the audit log, also for customers. A function passed in keeps the two apart.
- **Auditing reads of the log.** Not now. Only Super Users can read it, and they can already see everything. Reconsider with the admin console.
- **An index on `audit_log.createdAt`.** Not now. The table is small, and adding an index later needs no change in the code. Add it, together with indexes for the filters, when measurements show slow pages.

## Consequences

- A Super User can read the whole history through the API: who did what, to whom, when and from where. For example, `?targetId=` with an Admin's ID shows that Admin's whole story, from invitation to removal.
- **Every staff sign-in adds one entry.** With a handful of staff signing in a few times a day, that is a few thousand entries a year, which the table handles easily.
- **The audit log shows client IPs to Super Users,** and IPs are personal data. They are needed to investigate an incident, and only Super Users can see them. A retention period for audit entries is still open (`docs/security.md`, DPDP Act).
- A sign-in fails if its audit entry cannot be written. The audit log is in the same database as the sessions, so in practice both work or neither does.
- **The test walked the whole log, 5 entries at a time:** 22 entries came back, every one exactly once. The two sign-ins of the test were in it, and the failed one was not.
- The smoke test checks on every run that a customer token cannot read the log. Reading it needs a signed-in Super User with a phone, so it is tested by hand (README, "Read the audit log").
- **This completes the staff series (parts 3B-1 to 3B-6):**
  - Super Users created by a command;
  - staff MFA and sign-in;
  - two staff roles;
  - Admins invited and managed by Super Users;
  - every staff change and sign-in in an append-only audit log that Super Users can read.
- Still open for staff (`docs/security.md`): recovery codes or passkeys instead of the developer MFA command, a staff password change, a second approver for destructive actions, and a database role for the app that can only add and read audit entries.
