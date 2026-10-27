# 0010. Customer password recovery

- Status: Accepted and implemented (part 3A-4)
- Date: 2026-10-26

## Context

Customers who forget their password need a way back in, before there are any real users. ADR 0007 also listed two open items that password recovery has to settle:

- A reset must end every session of the account.
- Someone can register an email address that is not theirs and wait for the owner to verify it (pre-account takeover). A reset, which proves control of the inbox, should take such an account back for the real owner.

A reset link is as powerful as the password itself, so it gets the same care as the verification link, and more.

## Decision

### Reset links

- **Token:** 32 random bytes (base64url). Only the SHA-256 hash is stored, in its own table, `password_reset_tokens`. A verification token can therefore never be used as a reset link.
- **Valid for 30 minutes and only once.** Using a link is an atomic conditional update inside a transaction, so two requests with the same link cannot both succeed.
- **One link at a time:** a new request deletes the older unused links of the account, and a completed reset deletes the rest.
- The link points to the website: `WEB_BASE_URL/reset-password?token=...`.

### `POST /v1/auth/forgot-password`

- **Always `202` with the same message**, whether or not the email has an account.
- A link is sent only to an existing **active customer**, verified or not. Staff accounts reset through their own path (later), and a disabled account cannot sign in anyway, so both get nothing.
- **No timing leak.** The answer is sent right after the rate-limit check. The account lookup, the new token and the email happen in the background, after the response, so a real account answers no slower than an unknown one. The background task catches every error and logs only the error name.
- **Limits:** `forgotPassword` (20 per hour per IP), and the shared `emailsToAddress` (5 emails per hour per address, together with register and resend). Both are counted for every address, known or not (ADR 0009).

### `POST /v1/auth/reset-password`

- **Input:** `{ token, newPassword }`. The new password follows the registration rules (10 to 128 characters).
- **The link is checked before any hashing.** An unknown, used or expired link, or a link for an account that is no longer an active customer, gets **one** answer: `400 Invalid or expired reset link`. A made-up token costs no argon2 work.
- **In one transaction:**
  - claim the link;
  - set the new password hash;
  - **mark the email verified** if it was not;
  - **revoke every session** of the account;
  - delete the account's other unused links.
- **After the transaction:**
  - **Lift the login blocks** for this email, and for this email from this IP. The owner just proved who they are, so failed guesses by someone else must not keep them out.
  - **Send a "your password was changed" notice** in the background. It has no link on purpose, and a mail failure cannot undo the reset.
- **No automatic sign-in.** The customer signs in with the new password, which starts a fresh session.
- **Limit:** `resetPassword` (20 per hour per IP).

## Alternatives considered

- **Reusing the verification token table with a "purpose" column.** Rejected. One mistake in a query could let a verification link reset a password.
- **Sending the email before answering.** Rejected, because the response time would reveal which emails have an account.
- **A job queue for the emails.** Not yet. A background promise is enough for one API process. A queue can replace it when there is more than one process, or when lost emails become a problem.
- **Signing the customer in right after the reset.** Rejected. A fresh login is simpler to reason about, and the access token from a reset link would carry the link's risks.
- **Security questions or SMS codes.** Rejected. Security questions are weak, and SMS needs a paid provider and DLT registration (ADR 0007).
- **Keeping the old sessions.** Rejected. Ending them is what makes a reset useful after a stolen password.

## Consequences

- **Pre-account takeover is closed:** a reset by the real owner sets their own password, marks the address verified and signs everyone else out. The other half, deleting unverified accounts after 7 days, followed in part 3A-5 (ADR 0011).
- **A reset signs the customer out on every device.** That is intended, and the notice email says so.
- If the API stops between the response and the background email, the email is lost, and the customer has to ask again.
- The website (later) must post the token from the URL to the API straight away, and keep it out of its own logs and analytics.
- The 30-minute validity is fixed in two places, `password-reset.service.ts` and the email text, and both must change together.
