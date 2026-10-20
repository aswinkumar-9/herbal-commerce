# 0004. Roles and account creation

- Status: Accepted (permission matrix still to be confirmed by the owner)
- Date: 2026-10-20

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

## Consequences

- Smaller scope than the dealer model: no dealer pricing, stock ownership or hierarchy.
- Super Users can see and change everything, so their actions must be fully audited, and a second approver for destructive actions should be considered.
- The database schema keeps roles as an enum on `users` (`CUSTOMER`, `ADMIN`, `SUPER_USER`); finer-grained permissions can be added later as data.
