# 0004. Roles and account creation

- Status: Accepted (permission matrix still to be confirmed by the owner)
- Date: 2026-10-20
- Updated: 2026-10-27 (part 3B-1: Super User command, limit of 3 and audit log implemented, see ADR 0012)
- Updated: 2026-10-29 (part 3B-2: staff MFA setup implemented, see ADR 0013)
- Updated: 2026-10-30 (part 3B-3: staff login implemented, see ADR 0014)
- Updated: 2026-10-30 (part 3B-4: role checks and Admin invitations implemented, see ADR 0015)
- Updated: 2026-10-31 (part 3B-5: disabling, enabling and removing Admins implemented, see ADR 0016)

## Context

The original brief included main dealers and sub-dealers. The owner removed the dealer concept and defined three roles.

## Decision

Roles: **Customer**, **Admin**, **Super User**.

- Customers self-register from the application. This is the only public sign-up, and it can only produce a Customer.
- Admins are created, disabled and removed only by a Super User. Admins cannot create accounts.
- Super User accounts: maximum **3**, developers only. They are created by developers with a command-line script during development, never through the application. The limit is enforced in application code and in the database.
- Admin and Super User use a separate login path from customers and must use MFA.
- Admin manages products, prices, stock, orders, shipments and return approvals. Admin has no access to invoices, payments or refund execution.
- Super User has full access, including invoices, payments, admin accounts, audit log and system settings.
- Every Admin and Super User change is written to an append-only audit log.
- All authorization is enforced on the server, not only in the user interface.

The detailed permission matrix is in `docs/requirements.md`.

## Implementation status

| Rule | Status |
|---|---|
| Customers self-register, and registration only creates Customers | Done (ADR 0007) |
| Super Users: developers only, created with a command, at most 3 (in code and in the database) | Done in part 3B-1: `pnpm api:create-super-user` (ADR 0012) |
| Append-only audit log | Done in part 3B-1 (ADR 0012). Super User creation, MFA setups, and inviting, disabling, enabling and removing Admins are audited, with the actor, IP and request ID for changes made through the API (ADR 0015, ADR 0016). Other Admin and Super User changes follow with the features that make them. |
| Staff MFA (authenticator app, TOTP) | Setup done in part 3B-2: `pnpm api:setup-staff-mfa` (ADR 0013) |
| Separate staff login, with password and MFA code together | Done in part 3B-3: `POST /v1/staff/auth/login`, staff-only tokens and 12-hour sessions (ADR 0014) |
| Server-side role checks on staff routes | Done in part 3B-4: `@SuperUserOnly()` and a global roles guard; Admins get `403` (ADR 0015) |
| Admins created only by a Super User | Done in part 3B-4: `POST /v1/staff/admins` sends an invitation, and the Admin chooses their own password (ADR 0015) |
| Admins disabled and removed only by a Super User | Done in part 3B-5: `PATCH` and `DELETE /v1/staff/admins/:id`. Disabling ends the Admin's sessions, and only a disabled or pending Admin can be removed (ADR 0016) |

## Consequences

- Smaller scope than the dealer model: no dealer pricing, stock ownership or hierarchy.
- Super Users can see and change everything, so their actions must be fully audited, and a second approver for destructive actions should be considered.
- The database schema keeps roles as an enum on `users` (`CUSTOMER`, `ADMIN`, `SUPER_USER`); finer-grained permissions can be added later as data.
