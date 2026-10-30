# 0012. Super Users and the audit log

- Status: Accepted and implemented (part 3B-1)
- Date: 2026-10-27

## Context

ADR 0004 and `docs/requirements.md` (section 5) set the rules for staff accounts:

- At most 3 Super Users. Developers create them with a command, never through the application, and the limit is enforced both in application code and in the database.
- Every Admin and Super User change goes into an append-only audit log: who, what, before, after, when, and from which IP.

Part 3B-1 lays these foundations before any staff login exists. Staff login with MFA follows in part 3B-2, and the roles guard and Admin management in part 3B-3.

## Decision

### The audit log

- **Table `audit_log`:**
  - `actorId`: the staff user, or empty for a developer command or the system;
  - `action`, written as "thing.verb", for example `super_user.created`;
  - `targetType` and `targetId`;
  - `before` and `after` as JSON;
  - `ip`, `requestId` and `createdAt`.
- **Append-only, enforced by the database.** Triggers refuse `UPDATE` and `DELETE` (per row) and `TRUNCATE`. Prisma's schema cannot express triggers, so they were added by hand to the migration: create it with `--create-only`, add the SQL, then apply it.
- **No foreign keys.** An entry keeps plain IDs and a snapshot of the relevant fields, so it outlives the user or row it describes. A cascade would delete history, and the trigger would also block deleting the row it points to.
- **Written in the same transaction as the change.** `AuditService.record(tx, entry)` takes the open transaction, so a change and its entry are saved together or not at all.
- **No secrets, ever.** Before writing, `before` and `after` become plain JSON (dates as strings). Every field whose name contains "password", "secret" or "token" is replaced with `[REDACTED]`, at any depth. A secret written by mistake into an append-only table could never be removed again.

### Super Users

- **One way in: `pnpm api:create-super-user`.**
  - It builds the API, then runs a standalone Nest application context (`CliModule`): configuration, database, audit log and password hashing, with no HTTP server, no Valkey and no timers.
  - `SuperUserService` is provided in `CliModule` only, so no API endpoint can reach it.
- **Credentials** come from `SUPER_USER_EMAIL`, `SUPER_USER_NAME` and `SUPER_USER_PASSWORD`, set for one command and removed straight afterwards. The password is typed hidden (PowerShell `Read-Host -AsSecureString`), so it never appears on the command line or in the shell history.
- **Rules:**
  - the password has at least 16 characters, because a staff password protects far more than one customer account;
  - an email that already has an account is refused, so a customer is never turned into staff;
  - the account is marked verified at creation, because a developer creates it with a known address.
- **The limit of 3 is enforced twice:**
  - the service counts first and refuses with a clear message;
  - a database trigger on `users` (on `INSERT`, or an `UPDATE` of `role`) refuses a fourth Super User, whatever the code path. It first takes an advisory lock, so two parallel inserts cannot both see room. Disabled Super Users still count.
- **The user and its `super_user.created` entry are written in one transaction.** The entry holds the email, name and role, never the password or its hash.

### No staff login yet

Staff never get a password-only login, not even for a while. Their login arrives together with MFA in part 3B-2. Until then the customer login treats staff emails like unknown ones (ADR 0007), and logs a warning.

## Alternatives considered

- **A Super User sign-up endpoint protected by a secret.** Rejected. ADR 0004 says never through the application, and every endpoint is attack surface.
- **Enforcing the limit only in code.** Rejected: a bug, a script or a manual `UPDATE` could get around it. **Only in the database:** rejected for the unclear error message.
- **A table of three "slots" instead of a trigger.** Rejected. It is race-free without a lock, but the `role` column could still be changed without taking a slot, so a trigger would be needed anyway.
- **Audit entries as log lines only.** Rejected. Logs rotate, are hard to query per user and can be edited; a database table can be protected.
- **Foreign keys from audit entries to users.** Rejected, because history must survive deletions.
- **Asking for the password inside the Node script.** Not now. Environment variables are what the requirements ask for, and `Read-Host` already keeps the password hidden.

## Consequences

- An audit entry can never be corrected. A mistake is fixed by writing a new entry. Development test entries also stay until the local database is reset (`docker compose down -v`).
- **The protection is only as strong as the database role.** Today the API connects as the database superuser, who could drop the triggers. Before production, the running app needs its own role that may only insert and read `audit_log` (`docs/security.md`, section 6).
- Creating a Super User needs shell access to a machine with the production configuration, deliberately.
- Adding a fourth Super User means removing one of the three first, which is a deliberate developer step.
- Next: part 3B-2 (staff MFA setup, ADR 0013) and part 3B-3 (staff login, ADR 0014), both done, then part 3B-4 (a roles guard and Admin management, every change audit-logged).
