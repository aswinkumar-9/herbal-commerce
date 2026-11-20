# 0038. Admins and the audit log in the console

- Status: Accepted and implemented (part 12G)
- Date: 2026-11-20

## Context

Since part 3B, Super Users invite, list, disable, enable and remove Admins and read the audit log with the API alone, in PowerShell (ADR 0015 to ADR 0017). A developer sets up every staff member's authenticator app with `pnpm api:setup-staff-mfa` (ADR 0013), so a new Admin waits for a developer, and so does an Admin who lost their phone. Since part 12F, a refund Razorpay refused stays `FAILED` and stays in the console's failed card, even after a Super User gave the money back another way (open decision 7, ADR 0037). Part 12G brings Admins and the audit log to the console, and closes that decision.

The owner made these choices on 2026-11-19:
- **A new Admin sets up the authenticator app in the console,** right after choosing the password: a QR code and the key, confirmed with a code from the app. The developer command stays, for Super Users and as a way out.
- **A lost phone:** a Super User resets the Admin's app from the Admins page. That ends the Admin's sessions, emails them a new link, and is audited.
- **The audit log in sentences,** with what changed on request, filters by person and by kind of change, and links: "What they did" from an Admin's row, and "History" from an order's page.
- **A failed refund given back by hand:** a Super User marks it so, with a note saying how. The customer is not emailed: whoever gave the money back tells them.
- **The QR code's package:** `uqr` 0.1.3, chosen by the owner while building the setup pages.

These defaults were chosen during development and told to the owner, who could overrule them:
- a reset's link works like an invitation's: 72 hours, once;
- the key a link shows is made the first time the link is opened, and stays the same each time after, until a code confirms it;
- the note on a refund given back by hand has 3 to 500 characters;
- the audit log groups its entries by India's date, as the rest of the console does.

## Decision

### The API: setup links

- **One table for both links** (migration `20261119120000_staff_setup_links`). `staff_invitations` gains a `purpose`, `INVITE` or `AUTHENTICATOR_RESET`, and `pendingMfaSecret`, the key shown for the link, sealed like every MFA secret and bound to the link. Both kinds work as invitations always did: 32 random bytes, only their hash stored, 72 hours, once, claimed atomically.
- **Each link leads to its own console page:** `ADMIN_ORIGIN` + `/accept-invite?token=…` or `/reset-authenticator?token=…`.
- **`POST /v1/staff/auth/setup-link`** (public, `no-store`): for a link that still works, who it is for, until when, and the key to put into the app, as text and as an `otpauth://` address for a QR code. The key is made the first time the link is opened. Of two pages opened at the same moment, one key wins, and every later opening shows it again. Nothing else changes until a code confirms it.
- **`POST /v1/staff/auth/accept-invite`** now takes the code too: `{ token, password, code }`. The code proves the app holds the key the link showed. In one transaction, the link is claimed, the password and the key are saved, the email counts as verified, any session ends, and any other link of the Admin stops working. Two audit entries, both by the Admin: `admin.invite_accepted` and `staff.mfa_set_up`. The code just typed can't be used again to sign in. A link whose key was never shown, or a wrong code, is refused at the `code` field.
- **`POST /v1/staff/admins/:id/authenticator-reset`** (Super Users): only for an active Admin who accepted the invitation (`409` otherwise, saying to enable them first, or to send the invitation again). In one transaction, the key is cleared, so the lost phone's codes stop working at once, every session ends, older links stop working, a new link is made, and `admin.authenticator_reset` is written. The email goes after the commit. If it can't be sent, the answer says `emailSent: false`, and a second reset sends a new one. It counts towards the invitations' limit, and towards the 5 emails an hour to one address.
- **`POST /v1/staff/auth/reset-authenticator`** (public): `{ token, password, code }`, with the Admin's own password and a code from the new key. A wrong password or a wrong code gets the same `401 Invalid password or code`, and counts against the sign-in failure limits, as at the staff login. Then the new key is saved, every session ends, and `staff.mfa_set_up` is written.
- **Every refused link gets one answer,** whatever the reason: `400 Invalid or expired invitation link`, or `Invalid or expired link` for a reset. The reason is only in the API's log (`Staff link refused`).
- **`GET /v1/staff/admins`** gains `authenticatorLinkExpiresAt`, the newest reset link's end. `invitationExpiresAt` now counts invitations only.
- **The emails:** the invitation now says to have an authenticator app ready, and a reset sends "Set up your authenticator app again for Herbal Commerce".

### The API: a failed refund given back by hand

- **Three columns on `refunds`** (migration `20261119130000_refunds_given_back`): `givenBackAt`, `givenBackNote` and `givenBackById`, who did it.
- **The database keeps the rules,** whatever writes to it:
  - all three or none, only on a `FAILED` refund, and a note of 1 to 500 characters once trimmed (`refunds_given_back_chk`);
  - only a Super User can be the one who gave it back (`refunds_given_back_by_super_users`, a trigger);
  - once given back by hand, it stays so (`refunds_move_forward`, extended).
- **`POST /v1/staff/refunds/:id/given-back`** (Super Users), with `{ note }`: trimmed, Windows line breaks made plain, 3 to 500 characters. One atomic write, only while the refund is `FAILED` and not given back yet, so of two Super Users at the same moment, one wins. `404 Refund not found`, or `409` for a refund that didn't fail or is given back already. `order.refund_given_back` is written on the order, with the refund's ID, the amount, the time and the note, so the order's history shows it. No email. It answers the refund as the list shows it.
- **`GET /v1/staff/refunds?givenBack=false`** lists only those not given back yet, and `true` only those that were. Every refund staff see, in the list and on an order, gains `givenBackAt`, `givenBackNote` and `givenBackBy` (`id` and `fullName`). The customer's own order gains `givenBackAt` on each refund.
- **The status stays `FAILED`.** `PROCESSED` is Razorpay's word that it gave the money back: the record keeps how the money really went.

### The API: the audit log

- **`?kind=`** narrows it to one kind of change: `accounts` (Admins, Super Users and setting up an app), `sign_ins`, `orders`, `catalog` (categories, products, pack sizes and images) or `stock` (batches and stock). It combines with the other filters.
- **Each entry gains `subject`:** what its target is called now, and what that belongs to. A category or a product by its name, a pack size by its SKU with its product, an image by its description with its product, a batch by its number with its pack size, an order by its reference. One query for each kind of target on the page. `null` when the thing is gone, or isn't one of these.

### The Admins page

At `/admins`, for Super Users only; Admins don't see it in the menu, and the console never asks for it for them.
- **Each Admin:** the name, a tag saying where they stand, the email, a sentence on what comes next, and the steps for that state:

| State | The tag | The steps |
|---|---|---|
| Accepted, with the app | Active | Reset authenticator app, Disable |
| Accepted, without the app | No authenticator app | Send a new link, Disable |
| Invited, the link still works | Invited | Send the invitation again, Remove |
| Invited, the link ended | Invitation ended | Send the invitation again, Remove |
| Disabled | Disabled | Enable, Remove |

- **"What they did"** opens the audit log for that Admin.
- **"Invite an Admin"** asks for the name and the email. A taken email is refused at its box.
- **Each step asks first,** in a dialog that says what follows. A reset is in red: only for a lost phone, the app stops at once, they are signed out everywhere, and a new link goes to their email.
- **An email that couldn't be sent** stays on the page until it is sent again or put away, as it asks for something to be done.
- **The row changes at once** from the step's answer, then the list is read again.

### The setup pages

`/accept-invite` and `/reset-authenticator`, outside the signed-in part of the console: nobody is signed in there.
- **The token leaves the address bar at once,** so it stays out of the history, and lives only in the page. A token that can't be one is never sent.
- **Three steps:**
  1. the password: chosen and typed twice for an invitation, the Admin's own for a reset;
  2. the QR code, and beside it the key by hand, in groups of four, with "Copy the key";
  3. the 6-digit code from the app.
- **The QR code** comes from `uqr`, as one SVG path, black on white with its quiet border, in light and dark alike. No image file and no `data:` address, so the page's policy is unchanged.
- **The key isn't kept:** the page asks for it without a cache to keep, and forgets it once done.
- **Refusals:** a field's problem at its box. A `400` without a field means the link no longer works, and the page says so. A `401` says "The password or the code is not right.", never which, and empties both boxes.
- **Once done,** "Go to sign in".

### The audit log page

At `/audit-log`, for Super Users only.
- **Each entry in a sentence:** "Asha Verma packed order 7KQ2M9XDPA", what it is about linked to its page: an order, a product, the categories, a pack size's or an image's product, a batch's pack size, the Admins. Something deleted is named from what the entry kept, without a link. A developer command is "A developer command".
- **"What changed"** opens a table of each field before and after, as staff read them: rupees, Yes and No, dates and times in India, statuses and reasons in words. "Details" when nothing changed. Both say where it came from: the IP and the request ID.
- **By India's day, the newest first,** and "Show older entries" a page at a time.
- **Filters, kept in the address:** "Show", chips for Everything, Admins and accounts, Sign-ins, Orders and refunds, Catalog and Stock; and "Done by": everyone, the Super User reading it, or an Admin. A filter in the address that can't be one is ignored.
- **An order's "History"** opens the log for that order only, named "Only order 7KQ2M9XDPA", for Super Users.

### Given back by hand, in the console

- **The failed card lists only those not given back yet.**
- **"Mark as given back by hand"** on each, and on the order's payment card, opens a dialog: how the money went back, 3 to 500 characters, such as the new Razorpay refund ID or a transfer's UTR. It says the customer gets no email, and that it can't be undone.
- **One dialog for the page:** when the lists are read again, every minute or after a refusal, and the refund leaves them, the dialog stays open with what was typed and why it was refused.
- **Once marked:** it leaves the failed card at once, and everywhere it shows "Given back by hand", who did it, when, and the note.

### Found in a real browser

Headless Chrome drove the built console under its full security policy, against a stand-in API that follows the API's answers and refusals, with real authenticator keys and real codes. 15 checks: the Admins page and its dialogs, by mouse and by keys; both setup pages, where the QR code drawn was compared with one made from the key the page shows, and codes made from that key worked; the audit log's filters, pages and changes; an order's history; giving a refund back by hand, with a note holding a line break and markup; an Admin's view; and phone width. No policy violation, no page error, and every text at 4.5:1 or more in light and dark. Two things changed:
- **The focus after removing an Admin.** The removed row fades away, so the focus went back to its button, which then went too, leaving the focus on nothing. jsdom hid it, as it removes the row at once. The dialog now watches the button it gave the focus back to, and if it goes while it has the focus, the page's main area takes it.
- **The key wrapped in the middle of a group** of four, easy to mistype. It now wraps between groups.

Chrome names a button whose hidden words start with a colon or a comma with a space before it ("What they did : Asha Verma"), here and on older pages. A screen reader speaks no space, so it was left.

The owner scanned a setup link's QR code with a real phone and signed in with its codes on 2026-11-20.

### Security

- **One new package,** `uqr` 0.1.3, pinned exactly: QR codes, in plain JavaScript, with no dependencies. The page's policy is unchanged.
- **The token is never in the address bar after the page opens,** the page sends no referrer anyway (`Referrer-Policy: no-referrer`), and the key is never stored in the browser.
- **One answer for every refused link, and one `401` for a wrong password or code.** Wrong passwords at a reset count against the sign-in limits.
- **A reset ends every session and clears the key in one transaction,** so the lost phone is useless at once.
- **Names, notes and every value in the audit log are shown as text,** never as HTML. Markup in a note stays text, checked in Chrome.
- **The rules for a refund given back by hand hold in the database,** whoever writes.
- **Every answer is checked with zod,** IDs from the address reach the API only as UUIDs, and the audit log's filters are checked before they are sent.

## Alternatives considered

- **Only the developer command, as before.** Rejected by the owner: every new Admin and every lost phone waited for a developer.
- **A QR code made by the API as an image.** Rejected: the policy would need `data:` images or a new endpoint. The console draws it as SVG from the `otpauth://` address.
- **A larger QR package, such as `qrcode`.** Rejected by the owner for `uqr`: small, with no dependencies.
- **The key only, without a QR code.** Rejected: 32 characters to type by hand on a phone.
- **Recovery codes for a lost phone.** Not now: a Super User resets the app, and the audit log keeps who did.
- **Emailing the customer when a refund is given back by hand.** Rejected by the owner: whoever gave the money back already told them.
- **Marking a refund given back by hand as `PROCESSED`.** Rejected: that is Razorpay's word, and the record must say how the money really went back.
- **Filtering the audit log by action name in the console,** as the API allows. Rejected: staff think in kinds of change, not in `order.shipment_corrected`.
- **A dialog in each refund row.** Rejected once found: the row could leave the list while its dialog was open, taking the dialog and the reason it gave with it.
