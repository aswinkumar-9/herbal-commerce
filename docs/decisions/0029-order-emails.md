# 0029. Order emails

- Status: Accepted and implemented (part 10)
- Date: 2026-11-11

## Context

Until part 10, orders sent no emails (ADR 0026, ADR 0027 and ADR 0028, "Still open"). A customer saw what happened to their order only by asking the API: that it was paid, packed, shipped with its tracking number, delivered or cancelled, and that their money came back. The owner chose this part on 2026-11-11, ahead of returns, search and the admin console.

The owner made four choices on 2026-11-11:
- **The customer gets an email when their order is paid, packed, shipped and delivered.** The shipped email names the courier and the tracking number, and is sent again with the new ones if staff correct them.
- **The customer gets an email when their order is cancelled,** by them or by a Super User. For a paid order, it says that the payment is going back in full. **Another email follows when the refund is complete.**
- **The paid email is a full summary:** each product with its pack size, the number of packs and the price, the delivery charge, and the total with GST included, and the delivery address.
- **Super Users get an email when a refund fails,** because a person must then give the money back. Admins get no emails.

The owner did not choose two other emails: one when a late or second payment is given back, and one when an unpaid order expires. So a customer who paid late hears nothing until the refund is complete.

These defaults were chosen during development and told to the owner, who could overrule them:
- **An email is saved in the same transaction as the change it tells of** (a "transactional outbox"), with what it is about and no text. The text is written when it is sent.
- **It is sent right after the change,** and a job tries again every minute. Each failed try waits longer: 1, 2, 4 and so on up to 60 minutes. After 10 tries the email is given up on, and the API logs an error.
- **An email is sent at least once:** rarely, twice.
- **No email has a link.** Amounts are written like `Rs 1,299`.
- **A failed refund is told in one email to every active Super User.**

## Decision

### The emails

| What happens | Who gets it | Subject | What it says |
|---|---|---|---|
| The order is paid, on time or late (ADR 0027) | The customer | `Your order 7KQ2M9XDPA is confirmed` | Each line, such as `Ashwagandha Capsules: 2 packs of 60 capsules, Rs 898`; the items with the GST they include; the delivery charge, or `free`; the total paid; the delivery name and address, without the phone number |
| Staff mark it packed (ADR 0028) | The customer | `Your order 7KQ2M9XDPA is packed` | It will be handed to the courier soon |
| Staff mark it shipped | The customer | `Your order 7KQ2M9XDPA is on its way` | The courier and the tracking number, to follow on the courier's own website or app |
| Staff correct the courier or the tracking number | The customer | `New tracking details for your order 7KQ2M9XDPA` | The new courier and tracking number, to use instead of the ones sent before |
| Staff mark it delivered | The customer | `Your order 7KQ2M9XDPA is delivered` | Thank you |
| The customer or a Super User cancels it | The customer | `Your order 7KQ2M9XDPA is cancelled` | For a paid order: the payment is going back in full, to the account or card it came from, and another email will say when it is back |
| A refund is complete (`PROCESSED`) | The customer | `Your refund for order 7KQ2M9XDPA is complete` | The amount, why it went back, and that the bank may take a few working days to show it |
| A refund fails (`FAILED`) | Every active Super User, in one email | `Action needed: a refund for order 7KQ2M9XDPA failed` | The amount, the refund's ID and reason, and where the failed refunds are listed (`GET /v1/staff/refunds?status=FAILED`). Nothing about the customer. |

- **Every completed refund is told, whatever its reason.** For a payment that came late or twice (`ORDER_EXPIRED`, `ORDER_CANCELLED`, `ALREADY_PAID`), it is the only email the customer gets about it, and it says why the money went back.
- **An expired order sends nothing,** and nor does a refund that is still on its way (`REQUESTED` or `PENDING`).
- **Each email is a few short paragraphs,** in plain text and in HTML. The HTML escapes every value, as the account emails do (`escapeHtml` in `mail/mail.service.ts`), and keeps the line breaks.
- **No links.** An email that never has a link teaches customers not to click links in emails that claim to be from the shop, which is what phishing uses. The customer opens the app or the website themselves. Nor does any email ask the customer to do anything.
- **Money is in whole rupees,** as everywhere, grouped the Indian way: `Rs 1,29,999`.
- **Personal data is kept to what each email needs.** The paid email is the customer's record, so it has the delivery address, but never the phone number. The Super Users' email names the order and the refund, never the customer.

The words are in `src/notifications/order-emails.ts`.

### An email is saved with the change it tells of

A new table, `notifications`, holds the emails to send. One row holds:
- `kind`, the enum `NotificationKind`: `ORDER_PAID`, `ORDER_PACKED`, `ORDER_SHIPPED`, `SHIPMENT_CORRECTED`, `ORDER_DELIVERED`, `ORDER_CANCELLED`, `REFUND_PROCESSED` or `REFUND_FAILED`;
- `orderId`, and `refundId` for the two refund kinds;
- `status`, the enum `NotificationStatus`: `WAITING`, `SENT` or `FAILED`;
- `attempts`, `nextAttemptAt`, `sentAt`, `createdAt` and `updatedAt`.

**No text, and no address.** The email is written when it is sent, from the order as it is then. So the table holds no copy of anyone's name, email or address.

`NotificationsService.queue(tx, entry)` saves the email inside the transaction of the change:

| Where | Saves |
|---|---|
| `OrderPaymentsService.markOrderPaid` | `ORDER_PAID`, once the order is paid |
| `StaffOrdersService`, each step | `ORDER_PACKED`, `ORDER_SHIPPED` or `ORDER_DELIVERED`, with the step and its audit entry |
| `StaffOrdersService.correctShipment` | `SHIPMENT_CORRECTED`, only when something changed |
| `OrdersService.cancelLocked` | `ORDER_CANCELLED`, for the customer's cancel and a Super User's alike |
| `PaymentsService.moveRefund` | `REFUND_PROCESSED` or `REFUND_FAILED`, when a refund moves to that status: from Razorpay's answer to our request, its refusal (`400`), or a webhook |

So **an email is never lost once its change is saved, and never tells of a change that was undone.** If the database refuses the email, the change is undone with it: a webhook then fails, and Razorpay sends it again.

### Sending

- **Right after the change.** Once the transaction is saved, the service calls `NotificationsService.wake()`. Sending runs in the background, never throws, and never slows the answer. A cancel sends its email before it asks Razorpay for the refund, so a slow Razorpay never holds the email up.
- **Never from inside the transaction:** the sender would not see the new row yet, and the email would wait for the next minute.
- **One run at a time.** A run sends up to 50 emails that are due, the longest waiting first. If `wake()` is called during a run, one more run follows it, so an email saved meanwhile isn't left waiting.
- **Each email is claimed first.** One update adds a try and moves `nextAttemptAt` 5 minutes on, but only while the email is `WAITING` and due. So two senders never send the same email, even with two copies of the API later. If the API stops halfway, the email is tried again once those 5 minutes are over.
- **Then it is written, sent** through `MailService.send`, over SMTP like every other email (Mailpit in development), **and marked `SENT`,** with `sentAt`.
- **An email that can't be sent waits, then is tried again:** 1, 2, 4, 8, 16 and 32 minutes, then every 60 minutes. Each such try logs the warning `An email could not be sent: it is tried again later`.
- **After the 10th try,** about 4 hours later, it becomes `FAILED`, and the API logs the error `An email could not be sent, and is not tried again`. Nobody sends it again.
- **The logs never name an address.** They give the email's ID, its kind, how many tries it has had, and the error's name and code. A run logs `Emails sent` with counts, `Some emails could not be sent` as a warning, or `Sending the waiting emails failed` when, for example, the database can't be reached.
- **A failed refund with no active Super User** counts as an email that could not be sent, so it is tried again. A Super User made meanwhile gets it.

**Every minute, a job** (`NotificationsScheduler`) wakes the sender too, the first time a minute after the API starts. It tries again the emails whose wait is over, and sends any that the API stopped before sending. When the API shuts down, it waits for the run in progress to end. Its timer never keeps the process alive on its own.

**At least once:** if the API stops between sending an email and marking it `SENT`, the email is sent again when its claim runs out. That is rare, and a status email sent twice does less harm than one lost.

### Each step is told once

- **`notifications_once_per_order`:** a unique index on the order and the kind, for every kind about an order except corrections. So each step is told once, even if a bug saved it twice. A shipment may be corrected, and told, more than once.
- **Each refund is told once per outcome:** unique on the refund and the kind.

Prisma keeps the partial index in the schema itself, with its preview feature `partialIndexes`. Prisma's own check found no difference between the schema and the database.

### The database guards it

The last line of defence, as in ADR 0027:
- **`notifications_details_chk`:**
  - an email about a refund names the refund, and any other names none;
  - `sentAt` is set exactly when the email is `SENT`;
  - an email that is sent or failed was tried at least once.
- **`notifications_tell_the_truth`,** on every new row:
  - a new email waits, and has not been tried;
  - an email about an order is saved only while the order is in the status it tells of: `PAID`, `PACKED`, `SHIPPED` (also for a correction), `DELIVERED` or `CANCELLED`;
  - an email about a refund is saved only for one of that order's refunds, in the status it tells of: `PROCESSED` or `FAILED`.
- **`notifications_move_forward`:**
  - an email is never deleted;
  - what it is about never changes: its ID, kind, order, refund and creation time;
  - once `SENT` or `FAILED`, it stays as it is;
  - its tries only add up.
- **Its foreign keys refuse to delete** an order or a refund that has emails. Neither is ever deleted anyway.

### One migration

**`20261111070745_notifications`:** Prisma's table, enums and indexes, with the rules above written by hand after them.

Before it was applied, it was tested in a throwaway PostgreSQL 17 container, which was removed afterwards:
- every migration applied, and Prisma found no drift;
- the rules held in 18 cases, inside a transaction that was rolled back;
- each rule was broken on purpose, one way at a time, and the cases caught all 29 breaks.

### Modules

A new module, `notifications` (`src/notifications`):
- `NotificationsService`: `queue`, `wake` and `settled`, which waits for the run in progress;
- `NotificationSender`: claims, writes, sends and marks each email;
- `NotificationsScheduler`: the job that runs every minute;
- `order-emails.ts`: the words.

The orders and the payments ask it to save and send emails. `MailService` gained `send`, for an email written elsewhere.

**One exception to "modules ask each other, not each other's tables"** (ADR 0001): the sender reads, in one query through the email's relations, the order with its lines and its refunds, and the customer's name and email. It never changes them. Asking the orders, the payments and the accounts each for their part would take four queries for every email, for no safety gained. If a module ever becomes a service of its own, the sender asks it instead.

## Alternatives considered

- **Sending the email in the request, right after the change, with no table.** Rejected: an email is lost if the mail server is down or the API stops. And an email sent before the transaction is saved may tell of a change that is then undone.
- **Sending from inside the transaction.** Rejected: a slow mail server would hold the order's lock, and an email would go out for a change that might still be undone.
- **A queue in Valkey,** such as BullMQ. Rejected for now: Valkey can't save with PostgreSQL's transaction, so an email could be queued for a change that was undone, or lost after one that was saved. A table in the same database gives that guarantee for free. Revisit when the volume needs it.
- **Saving each email's text in the table.** Rejected: it would copy names, emails and addresses into another table, kept as long as the orders. The text is written when the email is sent.
- **Links in the emails,** such as "see your order". Not now: there is no app or website yet, and emails without links help against phishing. Revisit with the website.
- **An email when a late or second payment is given back, or when an unpaid order expires.** Not chosen by the owner. The customer is told once the refund is complete.
- **Emails to Admins.** Not chosen by the owner: Admins don't move money.
- **One refund-failed email per Super User.** Not needed: the Super Users are the developers, who know each other's addresses. Revisit if Super Users ever shouldn't see each other's emails.
- **Exactly once.** Not possible with an outside mail server: it can't tell the API whether it already took an email. At least once is accepted.
- **A mail provider's own API,** instead of SMTP. Not now: `MailService` hides the transport, and the provider is chosen when the API is deployed.

## Consequences

- **Tests:**
  - 826 unit tests in 92 suites.
  - Each step's tests were checked by breaking the code on purpose, one way at a time. Of 94 breaks, the tests caught 93, and the type check refused the other one. One break first went unnoticed: `settled()` ending before the run in progress. A test now catches it.
  - **The sender against a real PostgreSQL,** in a throwaway container:
    - emails of six kinds were written and sent, the longest waiting first, each marked `SENT` after 1 try;
    - an email that couldn't be sent waited 1 minute, then longer, and failed after its 10th try;
    - no address appeared in the log.
  - **The smoke test has 89 checks.** The new one: the customer is emailed at once that the order is cancelled, within 5 seconds rather than at the next minute.
  - **By hand, on 2026-11-11:**
    - `pnpm api:pay-test`: the confirmation email reached Mailpit 0.02 seconds after the order was paid;
    - the smoke test's cancel emails were sent within 0.01 to 0.02 seconds;
    - an email saved before sending existed waited until the job sent it.

    The refund emails were left to the tests: locally, a refund stays `PENDING` (ADR 0027).
- **A customer may, rarely, get the same email twice.**
- **An email that failed for good** is only in the table and the log. Nobody sends it again.
- **The `notifications` table grows with the orders.** Its rows hold IDs only, no personal data, and are kept like the orders.
- **Before production,** the sending domain needs SPF, DKIM and DMARC (`docs/security.md`), or the emails may land in spam.
- **Lessons:**
  - **Send after the transaction is saved, never inside it.** The tests mark the moment a transaction is saved, so they can check what came after it.
  - **A promise that says "the run has ended" needs a test with a run still going.** Without one, ending at once passes every other test.
  - **Prisma's partial indexes** (`where:` on `@@unique`) are kept without drift, so a hand-written index isn't needed for them.
- **Still open:**
  - seeing failed emails and sending them again, with the admin console;
  - an email when a late or second payment is given back, if the owner wants one later;
  - notifications in the app, and SMS or WhatsApp;
  - links in the emails, once the website exists;
  - a mail provider, with SPF, DKIM and DMARC, before production;
  - returns and their refunds, GST invoices, and going live with Razorpay once the company is registered (owner, 2026-11-09).
