# 0027. Payments with Razorpay

- Status: Accepted and implemented (part 8)
- Date: 2026-11-09
- Updated: 2026-11-10 (part 9: a paid order cancelled before it ships gets its payment back, and Super Users see payments and refunds, see ADR 0028; the owner chose Razorpay for every payment method, UPI included)
- Updated: 2026-11-11 (part 10: the customer is emailed when an order is paid and when a refund is complete, and the Super Users when a refund fails, see ADR 0029)

## Context

Part 7 placed orders that hold their stock for 15 minutes while they wait for payment (ADR 0026). Next on the MVP list (`docs/requirements.md`, section 6) come payments through a gateway: sandbox first, confirmed by the server, and idempotent. The shop takes online payments only at launch (ADR 0026).

Facts checked on 2026-11-08:
- Stripe takes new Indian businesses by invitation only.
- Razorpay and Cashfree both charge about 2% plus 18% GST on that fee.
- Both have free test modes, and Razorpay's test keys work before the business is verified (KYC).

The owner made three choices on 2026-11-08:
- **Razorpay** takes the payments.
- **A payment that comes after its order expired is kept if the stock is still free:** the order takes its stock again and is paid. Otherwise the payment goes back in full, on its own.
- **Rupees only, even for the payment page.** Razorpay's page wants the amount in paise next to its order. Our API still answers rupees only, and each app multiplies by 100 itself when it opens the page.

## Decision

### Razorpay, without its SDK

`RazorpayGateway` (`src/payments/razorpay.gateway.ts`) is the only code that talks to Razorpay:
- **plain `fetch`** to `https://api.razorpay.com/v1`, with Basic authentication (the key ID and the key secret) and a 10-second timeout;
- **every answer is checked** (zod) before it is used. A failure becomes a `RazorpayError` with Razorpay's HTTP status and error code, and only those two are ever logged;
- **six calls:** make an order, find an order by its receipt, read a payment, list a Razorpay order's payments, refund a payment in full, and list a payment's refunds;
- **paise exist only here.** `toPaise` multiplies by 100 on the way out. `toRupees` divides on the way back, and turns an amount with paise into `null`, which never matches an order. The database and our API keep whole rupees (ADR 0026);
- **constant-time comparisons** for both of Razorpay's signatures.

### The settings

| Variable | What it is |
|---|---|
| `RAZORPAY_KEY_ID` | The key ID from the Razorpay dashboard: `rzp_test_…` in test mode, `rzp_live_…` live. Not secret: the payment page shows it to every customer. |
| `RAZORPAY_KEY_SECRET` | Its secret, shown once in the dashboard. It signs our calls, and Razorpay signs the payment page's answer with it. |
| `RAZORPAY_WEBHOOK_SECRET` | Our own strong secret, set in the dashboard with the webhook. Razorpay signs each webhook with it. It must differ from `JWT_ACCESS_SECRET` and `MFA_ENCRYPTION_KEY`: one secret, one job (ADR 0008). |

- **The API refuses to start** without all three, or with the placeholders from `.env.example`.
- **Production refuses a test key** (`rzp_test_`). Test cards would otherwise pay for real orders, for free.

### Paying for an order

1. **The customer places an order** (ADR 0026).
2. **The app starts paying:** `POST /v1/me/orders/:id/payment`, for the customer's own order while it waits for payment and its hold hasn't ended. The answer is everything the payment page needs, in rupees:
   ```json
   { "reference": "7KQ2M9XDPA", "totalRupees": 498, "holdExpiresAt": "…", "razorpayKeyId": "rzp_test_…", "razorpayOrderId": "order_RB58MiP5SPFYyM" }
   ```
   - **The first time, the API makes a Razorpay order** for the order's total, with our order's reference as its **receipt** and the order's ID and reference in its notes, and saves it in `payments`.
   - **Asking again answers the same Razorpay order.** Two requests at the same moment still make one: Razorpay takes a receipt only once, so the second gets `400` and the API finds the first by its receipt. Saving skips a row that already exists.
3. **The app opens Razorpay's payment page** (`checkout.js`) with the key ID, the Razorpay order, and `totalRupees × 100`.
4. **The page answers** `razorpay_payment_id`, `razorpay_order_id` and `razorpay_signature`. **The app confirms:** `POST /v1/me/orders/:id/payment/confirm` with the payment ID and the signature.
   - The signature must be Razorpay's: an HMAC-SHA256, with the key secret, of **the Razorpay order the API saved for this order** and the payment ID. The page's `razorpay_order_id` is never used, so a payment for another order can't be passed off as this one's. A wrong signature answers `400 The payment could not be verified.` and is logged with the order's ID only.
   - Then the API **asks Razorpay** about the payment and settles it (below). The answer is the order as it is now: paid, still waiting, or with its money on the way back.
5. **Razorpay also sends a webhook** for the payment (below). It covers a customer who paid and closed the app before it confirmed.
6. **The expiry job asks Razorpay** about every order that started paying, before it expires it (below).

### Razorpay's word decides: settling a payment

The app's word, and a webhook's body, never pay an order. `OrderPaymentsService.settle(razorpayPaymentId)` reads the payment from Razorpay:
- **only a `captured` payment counts.** One that is only authorized, or failed, changes nothing;
- **it must be for one of our Razorpay orders,** and **for its amount, in INR.** A different amount never happens, because Razorpay takes only its order's amount. If it ever did, the API fails with an error and decides nothing without a person.

Then, in **one transaction, with the order locked** (a conditional update of its `updatedAt`), so a cancel or an expiry at the same moment waits:

| The order | The payment | Then |
|---|---|---|
| `PENDING_PAYMENT` | its first | **Paid.** The payment is marked paid first (`razorpayPaymentId`, `paidAt`), then the order, `PAID`. |
| `EXPIRED` | its first | **Paid late,** if its stock can be taken again from the sellable batches that expire first (`ORDERED` movements, ADR 0024). Otherwise the payment **goes back in full** (`ORDER_EXPIRED`). The owner's rule. |
| `CANCELLED` | any | The payment **goes back in full** (`ORDER_CANCELLED`). |
| paid | another one | The second payment **goes back in full** (`ALREADY_PAID`). |
| any | the same again, or one already going back | **Nothing changes.** |

- **A refund is saved in the transaction** as `REQUESTED`. Razorpay is asked for it **only after the transaction is saved,** with our refund's ID as its receipt. A second request with the same receipt can never refund twice.
- **Capture is automatic,** Razorpay's default for the account: a payment is captured within seconds. The orders don't ask for anything else.

### Refunds

- **Always the whole payment.** A refund moves `REQUESTED` → `PENDING` → `PROCESSED`, or `FAILED`, and never backwards.
- **Not taken yet:** if Razorpay can't be reached, the refund stays `REQUESTED`. The job asks again a minute after it was made, then every minute, the oldest first, at most 50 a run.
- **A lost answer:** if our request reached Razorpay but its answer didn't reach us, Razorpay refuses the same receipt again. The API then lists the payment's refunds, and finds ours by its receipt.
- **Refused outright** (`400`, and not among the payment's refunds): the refund becomes `FAILED`, and the API logs `Razorpay refused a refund: staff must give the money back`. Staff give it back by hand: there is no admin console yet. Since part 9, Super Users list them with `GET /v1/staff/refunds?status=FAILED` (ADR 0028). Since part 10, every active Super User is emailed when a refund fails (ADR 0029).
- **Razorpay's refund webhooks** move a refund forward. It is found by Razorpay's refund ID, or by its receipt when Razorpay's first answer never reached us.
- **The normal speed:** no refund fee. But Razorpay keeps the fee it took on the payment, checked in Razorpay's documentation on 2026-11-09. **So each automatic refund costs the shop Razorpay's fee and the GST on it,** about 2.36% of the order. Instant refunds would cost more.

### Webhooks

`POST /v1/payments/razorpay/webhook` is **public:** Razorpay has no token. Instead:
- **Razorpay signs each webhook** in `X-Razorpay-Signature`: a hex HMAC-SHA256 of the body, **exactly as it was sent,** with `RAZORPAY_WEBHOOK_SECRET`. The JSON parser keeps those bytes as `request.rawBody` (`rawBody: true` in `main.ts`). It is the same parser, with the same rules: JSON only, at most 100 kB, never compressed (ADR 0008). The same JSON with other spacing fails the check.
- **A wrong or missing signature** answers `400 The webhook could not be verified.`, and is logged as a warning.
- **`payment.authorized`, `payment.captured`, `payment.failed` and `order.paid`** name a payment. The API asks Razorpay about it and settles it, exactly as a confirmation does.
- **`refund.created`, `refund.processed` and `refund.failed`** move our refund forward.
- **Anything else, or a form we don't know,** answers `200` and changes nothing. A signed body we can't read is logged as an error: sending it again wouldn't help.
- **If Razorpay can't be asked,** the answer is `503 PAYMENTS_UNAVAILABLE` with `Retry-After: 30`. Razorpay sends a webhook again until it gets a `2xx`, for 24 hours.
- **No table of webhook events.** Handling a webhook is safe to repeat: settling looks at what it already did, and a refund only moves forward. So a webhook sent twice, or replayed, changes nothing. Razorpay's signature carries no time, and a replayed old webhook only makes the API ask Razorpay again.

**Razorpay must reach the webhook URL:** a public HTTPS address, on port 443 or 80. It can't reach a laptop. On a laptop, the smoke test and `pnpm api:pay-test` send webhooks signed with the secret from `.env` instead. For Razorpay's own webhooks during development, Razorpay's documentation suggests a tunnel such as zrok, and refuses ngrok addresses. In the dashboard, under Webhooks:
- the URL `https://<the API's host>/v1/payments/razorpay/webhook`;
- the secret `RAZORPAY_WEBHOOK_SECRET`;
- the events `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `refund.created`, `refund.processed` and `refund.failed`.

### The expiry job asks Razorpay first

`OrderExpiryScheduler` (ADR 0026) now runs three parts every minute, in this order:
1. **Payments that came in time.** For the orders whose hold has ended but that started paying, at most 100 a run, the oldest hold first, it asks Razorpay for each Razorpay order's captured payments, and settles them. A payment whose webhook is late, or whose customer closed the app, still pays its order instead of letting it expire. If Razorpay can't be asked about an order, it expires anyway: a payment found later is settled by the owner's rule for late payments.
2. **Expiring unpaid orders,** as before.
3. **Asking again for refunds** Razorpay hasn't taken.

Each part has its own error handling, so one failing part never stops the others. Each logs counts only, and only when it did something: `Payments found before their orders expired`, `Unpaid orders expired`, `Refunds taken when asked again`, or a warning when some failed.

### What a payment keeps

- **`payments`:** one per order.
  - `orderId`: unique, with a foreign key `ON DELETE RESTRICT`;
  - `razorpayOrderId`: unique;
  - `amountRupees`: the order's total;
  - `razorpayPaymentId`: unique, and `paidAt`, once a payment has paid the order.
- **`refunds`:** a payment given back.
  - `paymentId`: with a foreign key `ON DELETE RESTRICT`;
  - `razorpayPaymentId`: unique, so a Razorpay payment is given back at most once;
  - `amountRupees`: the whole payment;
  - `reason`, the enum `RefundReason`: `ORDER_EXPIRED`, `ORDER_CANCELLED` or `ALREADY_PAID`, and since part 9 `CANCELLED_BY_CUSTOMER` or `CANCELLED_BY_STAFF`, for a paid order cancelled before it ships (ADR 0028);
  - `status`, the enum `RefundStatus`: `REQUESTED`, `PENDING`, `PROCESSED` or `FAILED`;
  - `razorpayRefundId`: unique, once Razorpay has taken it;
  - an index on `(status, createdAt)` for the job.
- **No card or bank details,** ever: the customer types them into Razorpay's page, and our server sees only Razorpay's IDs.

**The database guards them,** as the last line of defence:
- `payments_details_chk`: an amount above 0, Razorpay's IDs in Razorpay's form, and paid exactly when a payment names the Razorpay payment that paid it;
- `refunds_details_chk`: the same for a refund, which names Razorpay's refund once Razorpay has taken it;
- `payments_match_their_order`: a payment is made only for an order waiting for payment, and for its total;
- `payments_keep_what_was_agreed`: a payment is never deleted, what it is for never changes, and once paid it stays paid by the same Razorpay payment;
- `refunds_match_their_payment`: a refund gives back the whole payment. Since part 9, a `CANCELLED_BY_*` refund is made only for the payment that paid an order that is paid or packed (ADR 0028);
- `refunds_move_forward`: a refund is never deleted, its amount never changes, it keeps its Razorpay refund, and its status only moves forward;
- `orders_status_moves_forward`: an order moves only from `PENDING_PAYMENT` to `PAID`, `CANCELLED` or `EXPIRED`, or from `EXPIRED` to `PAID`. It is `PAID` only once its payment is. Since part 9, a paid order moves on to `PACKED`, `SHIPPED` and `DELIVERED`, and a paid or packed one becomes `CANCELLED` only with its payment going back in full (ADR 0028).

Payments and refunds are never deleted, like orders (ADR 0011).

### What the customer sees

An order now shows `payment`: `null` before paying starts, then `paidAt` (or `null`) and its `refunds`, each with `amountRupees`, `reason`, `status` and `createdAt`. Razorpay's IDs stay inside.

### The endpoints

| Endpoint | What it does |
|---|---|
| `POST /v1/me/orders/:id/payment` | Starts paying for an order waiting for payment: what the app needs to open Razorpay's payment page |
| `POST /v1/me/orders/:id/payment/confirm` | Confirms a payment with what the payment page gave the app, and answers the order |
| `POST /v1/payments/razorpay/webhook` | Razorpay's webhooks. **Public,** and signed. |

- **The order is the customer's own,** as for every order route: anyone else's answers `404`, and a staff token `401`.
- **Rate limits,** per client IP: 60 payments started and 60 confirmations an hour. The webhook has only the baseline.
- **If Razorpay can't be reached,** starting or confirming answers `503 PAYMENTS_UNAVAILABLE` with `Retry-After: 30`.

### Modules ask each other

The `payments` module (`src/payments`) owns its two tables and Razorpay. The orders ask it, and never read its tables (ADR 0001):
- `OrderPaymentsService` (`src/orders`) starts, confirms and settles payments, with the order locked, and asks the inventory to take stock again for a late payment;
- `RazorpayWebhooksService` (`src/orders`) checks a webhook, then settles its payment or moves its refund forward;
- `OrdersService` shows an order's payment (`PaymentsService.summaryFor`).

### One migration

`20261108112843_payments`: the two tables, the enums `RefundReason` and `RefundStatus`, and the checks and triggers above. It was tested in 32 cases, 40 of them refused, on temporary tables inside a transaction that was rolled back, before it was applied.

## Alternatives considered

- **Stripe.** New Indian businesses get it by invitation only.
- **Cashfree.** About the same price. The owner chose Razorpay.
- **Razorpay's Node SDK.** Rejected: more dependencies for six HTTP calls. `fetch` with checked answers is short, and tested.
- **Trusting the payment page's answer, or a webhook's body.** Rejected: Razorpay itself is asked every time, and only a captured payment for the right amount counts.
- **Amounts in paise in our API, for the payment page.** Rejected by the owner: rupees only, and the apps multiply by 100 (ADR 0026: ask the owner before adding a unit).
- **Refunding every late payment.** Rejected by the owner: a late payment is kept while its stock is free.
- **Authorizing first and capturing later,** once the stock is sure. Not now: the stock is held while the customer pays, and a late payment's stock is checked when it is settled. Automatic capture is simpler.
- **A table of webhook events,** to handle each event once. Not needed: handling is safe to repeat. Revisit if an event ever has to act exactly once with nothing else to guard it.
- **A queue for refunds.** Not now: the minute job asks again, like the expiry of orders.
- **UPI without a gateway,** to save Razorpay's fee on UPI payments. On 2026-11-10 the owner asked about YouPI-PG, an open-source project. It shows a UPI link or QR code for the shop's own UPI ID. It then decides that a payment came by reading the bank's SMS, app notifications or emails, matching only the amount and the time. Rejected, and the owner chose Razorpay for every payment method:
  - such a payment can't be proven: a message can be late or faked, or be about someone else's payment. This ADR pays an order only on the gateway's word;
  - it gives no refunds, which cancelling a paid order needs (ADR 0028);
  - only one customer at a time can pay to one UPI ID;
  - it uses person-to-person payments, which would need the company's current account anyway;
  - its own documents call it experimental, and not approved for real money.

  Razorpay's page already opens the customer's UPI app on a phone, and shows a QR code on a computer. Once the company is registered, UPI could cost less: compare or negotiate gateway prices, or use a bank's UPI collection service with signed callbacks and refunds.

## Consequences

- **Tests:**
  - 744 unit tests in 84 suites, with Razorpay faked. The gateway is tested against fixed signature examples.
  - Each step's tests were checked by breaking the code on purpose, one way at a time: of 235 breaks, the tests caught 233, and the type check refused the other 2. Where a break first went unnoticed, the tests were made stronger.
  - The smoke test has 86 checks. The new ones:
    - starting to pay answers `200` in rupees only, with a Razorpay test key, and the same Razorpay order every time;
    - only the order's owner can pay for it (`404`), and a wrong or missing confirmation is refused (`400`);
    - an order shows its payment, unpaid and with no refunds or Razorpay IDs, and once cancelled it can no longer be paid (`409`);
    - a webhook without a signature, with a wrong one, or re-spaced after signing is refused (`400`);
    - a webhook signed with the webhook secret is taken (`200`), even an event the API has no use for, or about a refund it doesn't know.

    It needs the internet now: with a pack in stock, each run starts paying in Razorpay's test mode, and leaves a test order in the dashboard.
  - **`pnpm api:pay-test`** pays for a real order in Razorpay's test mode, in a browser, which only a person can do. It makes a throwaway customer and order, serves a small payment page on `localhost`, confirms the payment as an app would, and sends a signed copy of Razorpay's webhook, which must change nothing. `--cancel` cancels the order first, so the money must go back.
  - **By hand, on 2026-11-08 and 2026-11-09,** in Razorpay's test mode:
    - a Super User made a live product with a pack in stock (the shop was empty since part 7);
    - three orders were paid in Razorpay's test mode, each within 3 minutes of being placed, and the copy of the webhook changed nothing;
    - a cancelled order was paid 20 minutes later. ₹498 went back in full (`ORDER_CANCELLED`), and Razorpay took the refund;
    - the smoke test ran with the pack in stock.

    Paying late for an expired order needs more than 16 minutes, and was left to the unit tests.
- **Locally, a refund stays `PENDING`:** Razorpay's `refund.processed` webhook can't reach a laptop. Deployed, the webhook moves it on. The dashboard shows the refund's real state.
- **Each automatic refund costs Razorpay's fee,** about 2.36% of the order (see "Refunds").
- **Lessons:**
  - **Ask the owner about units first.** This time the question came before the code: Razorpay's page wants paise, and the owner chose rupees only in our API.
  - **`.env.example` holds placeholders only.** Real test keys once went into it while setting up. The test that refuses `.env.example`'s values as a real configuration caught it before any commit.
  - **A signature over a body needs the body's exact bytes.** Parsed and printed again, the same JSON fails the check.
  - **A test that never fails proves nothing:** breaking the code on purpose found tests to strengthen in every step.
- **Still open:**
  - **going live:** Razorpay's KYC with the business's PAN, live keys, and the webhook on the deployed API's HTTPS address;
  - **for the chartered accountant:** booking Razorpay's fee and the GST on it, the fee lost on each automatic refund, and what a refunded payment for an order never delivered needs on paper. GST invoices for paid orders are still to come (ADR 0026);
  - **staff seeing payments and refunds:** done in part 9, for Super Users (ADR 0028). Recording that staff gave a `FAILED` refund back by hand is still to come, with the admin console;
  - **a job that asks Razorpay about old `PENDING` refunds,** if their webhooks were lost for longer than Razorpay's 24 hours of retries;
  - emails confirming a payment and a refund: done in part 10 (ADR 0029). By the owner's choice, a late or second payment that goes back is told only once its refund is complete;
  - returns, and refunds a customer asks for;
  - matching Razorpay's settlements against our payments.
