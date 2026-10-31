# 0015. Staff roles and Admin invitations

- Status: Accepted and implemented (part 3B-4)
- Date: 2026-10-30
- Updated: 2026-10-31 (part 3B-5: listing, disabling, removing and inviting again, see ADR 0016)

## Context

ADR 0004 and `docs/requirements.md` (section 5) say that only a Super User creates, disables and removes Admins, through an API where every call is audited. After part 3B-3 (ADR 0014) three things were missing:

- **No role check on staff routes.** A staff token opened every staff route, so an Admin could do everything a Super User can.
- **No way to create an Admin.** Super Users came from a developer command (ADR 0012), but nothing created Admins.
- **No request details in the audit log.** Entries from the developer commands have no actor, IP or request ID, and no entry had come from an HTTP request yet.

Admin management was too big for one part, so it was split:
- **Part 3B-4 (this ADR):** the role check, the request details for the audit log, and inviting Admins.
- **Part 3B-5 (ADR 0016):** listing, disabling, enabling and removing Admins, and sending an invitation again.

## Decision

### The role on every request

- **The role is read from the database, never taken from the token.** The access-token guard already looks up the session on every request. The same query now also returns the user's role (`SessionService.liveSessionRole`), so this costs no extra query. The checked user on the request is `{ id, sessionId, role }`.
- **A role change or a disabled account takes effect at the next request,** not when the access token expires up to 15 minutes later.

### Two levels of staff routes

| Marker | Who gets in | Everyone else |
|---|---|---|
| `@StaffOnly()` (ADR 0014) | Admins and Super Users | `401`, like a forged token |
| `@SuperUserOnly()` | Super Users only | Admins: `403 Only a Super User may do this.` |

- **`@SuperUserOnly()` includes `@StaffOnly()`,** so a Super-User-only route takes staff tokens only. Like `@StaffOnly()`, it may mark a whole controller, because it only ever narrows who gets in.
- **A global `RolesGuard` runs after `AccessTokenGuard`.** That guard has already checked the caller and attached the role. An Admin gets `403`, not `401`: the caller is known, so the answer reveals nothing, and a client knows that signing in again would not help.
- **The guard fails closed.** A Super-User-only route without a checked caller is refused too, whether through a `@Public()` handler or a guard registered in the wrong order.
- **Only two levels, on purpose.** The permission matrix in `docs/requirements.md` is still a proposal. Finer permissions (products, orders, returns) come with the admin console features that need them.

### Who did it, from where: the audit context

- **`@CurrentAuditContext()`** gives a handler the part of an audit entry that the request knows:
  - `actorId`: the caller the guard checked, never an ID from the body;
  - `ip`: the client address, worked out the same way as for the rate limits (`TRUST_PROXY`, ADR 0009);
  - `requestId`: the ID in the request logs, so an entry can be matched to its log lines. A client may choose its own request ID, so it is never trusted for anything else.
- **The service that makes the change adds the rest** (action, target, before and after), and writes the entry in the same transaction as the change (ADR 0012).

### Inviting an Admin

- **`POST /v1/staff/admins`** takes `{ email, fullName }` and is Super User only. Unknown fields, such as a role or a password, are dropped.
- **An email that already has an account gets `409`.** A customer is never turned into staff (as in ADR 0012); an Admin needs a new address. The `409` shows a Super User that the address is taken, which is acceptable: only Super Users can ask, at most 20 times an hour.
- **The Super User never chooses, sees or sends the Admin's password.** One transaction saves three rows:
  - **the Admin's account,** with a random password that nobody knows (the hash of 32 random bytes, which are thrown away) and an unverified email;
  - **an invitation in `staff_invitations`:** only the SHA-256 hash of a 32-byte random token, valid for **72 hours** and once;
  - **the audit entry `admin.invited`,** with the Super User as the actor, the IP, the request ID and the new account's email, name and role.
- **The email goes out after the commit.** It links to `WEB_BASE_URL/staff/accept-invite?token=...`, the future admin console page. If sending fails, the Admin still exists and the answer says `invitationSent: false`. Since part 3B-5, a Super User can send a new invitation (ADR 0016).
- **The answer never holds the token or the link,** so they cannot leak through the Super User's screen or logs.
- **A pending Admin** is an Admin whose email is still unverified. They cannot sign in: nobody knows their password, and their MFA is not set up.

### Accepting the invitation

- **`POST /v1/staff/auth/accept-invite`** takes `{ token, password }` and is **public**: the Admin has no password yet. The token itself proves that they control the invited inbox. The password follows the staff rules: 16 to 128 characters.
- **One answer for every refused link: `400 Invalid or expired invitation link`.** It covers an unknown, used or expired link, and an account that is no longer an active Admin. An unknown token is refused before any password hashing, so made-up tokens cost almost nothing.
- **The invitation is claimed atomically,** with a conditional update on "not used and not expired". When two requests send the same link at once, exactly one wins.
- **The same transaction:**
  - sets the password hash;
  - marks the email as verified;
  - ends any sessions of the account, as a password reset does (ADR 0010);
  - deletes the Admin's other unused invitations;
  - writes the audit entry **`admin.invite_accepted`**, with the Admin as the actor, because nobody is signed in.
- **The Admin is not signed in.** Staff never get a password-only session (ADR 0012). The answer says that a developer will set up the authenticator app next (`pnpm api:setup-staff-mfa`, ADR 0013). After that, the Admin signs in like any staff member (ADR 0014).

### Limits, logs and cleanup

- **Per-IP rate limits:** `staffInvites` (20 per hour) and `acceptInvite` (20 per hour). The token has 256 bits, so guessing is hopeless anyway; the limit keeps the cost of trying low.
- **Logs:**
  - `Admin invited` (user ID, actor ID, whether the email went out);
  - `Admin invitation accepted: password set` (user ID);
  - `Admin invitation refused`, with the user ID where known and a reason: `unknown_token`, `already_used`, `expired`, `not_allowed` or `lost_race`.

  The token, the link, the password and the email address are never logged.
- **Cleanup:** the hourly retention job deletes invitations once they have expired, used or not (ADR 0011). **It never deletes the Admin.** A pending Admin stays until a Super User removes them or invites them again (part 3B-5, ADR 0016).

### Endpoints

| Endpoint | Access | Purpose |
|---|---|---|
| `POST /v1/staff/admins` | Super User, `staffInvites` limit | Creates a pending Admin and emails the invitation |
| `POST /v1/staff/auth/accept-invite` | Public, `acceptInvite` limit | The invited Admin chooses a password with the link |

## Alternatives considered

- **The Super User chooses the Admin's first password and passes it on.** Rejected. Someone else would know the password, and it would travel through chat or email.
- **The role inside the access token.** Rejected. A demoted or disabled staff member would keep their power for up to 15 minutes, and the database is read on every request anyway.
- **A general `@Roles(...)` decorator or a permission table now.** Not now. Only two levels are needed today, and the permission matrix is still to be confirmed by the owner.
- **`404` instead of `403` for Admins on Super User routes,** to hide that the routes exist. Rejected. The caller is a known staff member, the admin console will show them which actions exist anyway, and `403` tells a client what happened.
- **Invitations in the password reset table.** Rejected. Resets are for customers only (ADR 0010), with another lifetime and other rules. Separate tables mean a bug in one flow can never set a password through the other.
- **Turning an existing customer into an Admin.** Rejected, as in ADR 0012. One account with both roles would mix token audiences, sessions and data.
- **Rolling the invitation back when the email fails.** Rejected. An SMTP error can come even after the email was delivered, and the Super User would retry blindly. The invitation is kept, and `invitationSent: false` says what happened.
- **Signing the Admin in after accepting.** Rejected. Their MFA is not set up yet, and staff never get a password-only session.
- **Staff sign-ins in the audit log** (left open in ADR 0014). Moved to part 3B-5, and from there to part 3B-6, together with the Super Users' view of the audit log, where it will be clear what is useful to see there.

## Consequences

- **Becoming an Admin takes four steps:**
  1. a Super User invites them;
  2. the Admin chooses a password with the link;
  3. a developer sets up their authenticator app;
  4. the Admin signs in.

  Until the admin console exists, the link is not clicked: the README reads the token from Mailpit ("Invite an Admin").
- **A lost or expired invitation could not be replaced through the API in this part.** While testing, the pending Admin was deleted in the database and invited again. The audit entries stayed, because they have no foreign keys (ADR 0012), and point to an account that no longer exists. Since part 3B-5, a Super User invites again or removes the pending Admin through the API (ADR 0016).
- **Every staff account has its own password and its own authenticator entry.** Two mix-ups cost time in this part's test:
  - the new Admin's sign-in failed several times, most likely with another account's password;
  - deleting every entry from the phone locked a Super User out until their MFA setup ran again.

  The README's troubleshooting covers both.
- **Admins can sign in, but have nothing to do yet.** Their features come with the catalog, orders and the admin console.
- **The invitation link carries the token in its URL,** like the customer links. The admin console must post it to the API at once and keep it out of its logs and analytics (`docs/security.md`).
- The smoke test checks on every run that a customer token cannot invite Admins and that a made-up invitation link gets `400`. The full invitation needs a signed-in Super User with a phone, so it is tested by hand (README).
- Part 3B-5 added managing Admins: list, disable and enable with their sessions ended, remove, invite again (ADR 0016). Next: part 3B-6, a Super Users' view of the audit log, and the decision on staff sign-ins in the audit log.
