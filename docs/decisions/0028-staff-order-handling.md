# 0028. Staff order handling

- Status: Accepted and implemented (part 9)
- Date: 2026-11-10

## Context

Part 8 let customers pay (ADR 0027), but a paid order then had nowhere to go: staff couldn't see orders, and only an order waiting for payment could be cancelled (ADR 0026). The owner chose this part on 2026-11-09, ahead of GST invoices, which wait until the company is registered.

The permission matrix (`docs/requirements.md`, section 4) proposes that Admins view, pack and ship orders, and that only Super Users move money.

The owner made four choices on 2026-11-09:
- **After payment, staff mark an order packed, then shipped, then delivered.** Shipping names the courier and its tracking number. The customer sees each step.
- **Only Super Users cancel a paid order** among staff, and its payment goes back in full through Razorpay. Admins never move money.
- **A customer may cancel their own paid order until it ships,** while it is paid or packed, and the payment goes back in full. Each such refund costs the shop Razorpay's fee, about 2.36% of the order (ADR 0027), and the owner accepted that.
- **Shipping is typed in by staff:** they book the courier themselves, then type its name and the tracking number. Staff also mark an order delivered by hand. There is no courier integration.

These defaults were chosen during development and told to the owner, who could overrule them:
- Super Users too cancel only until an order ships. After that, it is a return, which comes later.
- Admins see orders without their payments.
- Staff see the delivery name, phone and address, never the customer's email or account.
- The courier and tracking number may be corrected while the order is on its way.
- Every step is written to the audit log.

On 2026-11-10 the owner also chose Razorpay for every payment method, UPI included (see ADR 0027, "Alternatives considered").

## Decision

### An order's steps

| Status | Means | Next |
|---|---|---|
| `PAID` | Paid, and waiting to be packed (ADR 0027) | Packed, or cancelled |
| `PACKED` | Packed, and waiting for the courier | Shipped, or cancelled |
| `SHIPPED` | Handed to the courier, with its tracking number | Delivered |
| `DELIVERED` | Delivered, as staff marked it | Nothing. A return comes later. |
| `CANCELLED` | Cancelled before it shipped: while it waited for payment, or since part 9 also once paid. A paid order's payment went back in full. | Nothing |

- An order keeps when each step happened, in `packedAt`, `shippedAt` and `deliveredAt`, and the courier's name and tracking number in `courierName` and `trackingNumber`. Each is `null` until its step.
- **A packed order that is cancelled keeps its `packedAt`.** Its packs go back into stock at once (`RELEASED`), so staff unpack it and put the packs back on the shelf.

### Staff take the steps

- **One route per step:** `POST /v1/staff/orders/:id/packed`, `/shipped` and `/delivered`. Each answers the order as it is now.
- **A status guard moves an order one step, once.** Each step changes the order only while it is in the step before: `updateMany` with `where: { id, status }`, as in ADR 0026. A double click, or two staff at once, move it once. The one that comes second answers `409` with why:

  | Step | The order is already there | The order is not ready |
  |---|---|---|
  | Packed | `This order is packed already.` | `Only a paid order can be packed.` |
  | Shipped | `This order has shipped already.` | `Only a packed order can be shipped.` |
  | Delivered | `This order is delivered already.` | `Only a shipped order can be marked delivered.` |

- **Each step and its audit entry are one transaction:** `order.packed`, `order.shipped` with the courier and tracking number, and `order.delivered`, each with the status before and after. The API logs `Order moved to its next step`, with the order, the staff member and the new status.

### The courier and the tracking number

- **`courierName`:** 2 to 60 characters. Spaces at the ends are dropped, and each run of spaces becomes one.
- **`trackingNumber`:** 4 to 40 letters, digits or hyphens, starting with a letter or digit. Spaces are dropped and letters made capitals, so `ee 1490 8112 3456` is stored as `EE149081123456`.
- **A typing mistake can be corrected while the order is on its way:** `PATCH /v1/staff/orders/:id/shipment`, with the courier, the tracking number or both.
  - Any other order answers `409 Only an order on its way can have its courier or tracking number corrected.`
  - An empty body answers `400 Nothing to change`.
  - The order is locked while it is corrected, so two corrections take turns.
  - The audit entry `order.shipment_corrected` keeps only the fields that changed, before and after. A correction that changes nothing writes no entry.

### Cancelling until the order ships

The customer (`POST /v1/me/orders/:id/cancel`) and a Super User (`POST /v1/staff/orders/:id/cancel`) cancel the same way, in `OrdersService.cancelLocked`, in one transaction:
1. **The order is locked,** with an ordinary update of its `updatedAt`, but only while it may be cancelled: waiting for payment, paid or packed. So a payment, an expiry or a staff step at the same moment waits, or finds nothing to change.
2. **A paid or packed order's payment goes back in full** (`PaymentsService.refundInFull`). The refund is saved as `REQUESTED`, with the reason `CANCELLED_BY_CUSTOMER` or `CANCELLED_BY_STAFF`.
3. **The order becomes `CANCELLED`,** and its stock comes back (`RELEASED`).
4. **A Super User's cancel is audited** in the same transaction: `order.cancelled`, with the status before, and the refund's ID for a paid order. The API logs `Order cancelled by staff`.

**Razorpay is asked for the refund after the transaction,** as in ADR 0027, with our refund's ID as its receipt. If Razorpay can't be reached, the refund stays `REQUESTED`, and the job asks again every minute. The answer shows the refund either way.

- **An order that has shipped,** been delivered, cancelled or expired answers `409 This order can no longer be cancelled.` This message replaces part 7's `Only an order waiting for payment can be cancelled.`
- **Another customer's order answers `404`,** like an unknown one, as before.
- **An order waiting for payment is cancelled as before:** its stock comes back, and there is nothing to refund.

### What staff see

- **`GET /v1/staff/orders`:** every order, one page at a time.
  - Filters: `?status=` one status, such as `PAID`, or `?reference=` the order a customer quoted, in small letters too.
  - Sorting: `?sort=newest` (the default) or `oldest`. `?status=PAID&sort=oldest` is the work to pack, in turn.
  - Paging: up to 100 a page, default 50, continued with `?after=` the `nextAfter` of the page before.
  - Each order shows its ID, reference, status, total, the delivery name, city and state, and when it was placed.
  - A new index on `(status, createdAt)` serves the list.
- **`GET /v1/staff/orders/:id`:** one order, to pack and ship it.
  - It shows the lines with their HSN codes, the steps, the totals and the delivery address.
  - **Super Users also see its `payment`:** Razorpay's order and payment IDs, the amount, when it was paid, and every refund, with Razorpay's refund ID, its reason and status. Admins get no `payment` field at all.
- **`GET /v1/staff/refunds`, for Super Users only:** every refund, the newest first, paged the same way, each naming its order.
  - `?status=FAILED` lists those Razorpay refused, which staff give back by hand in the Razorpay dashboard.
- **Reading is not audited,** as for the audit log (ADR 0017).

### What the customer sees

An order now shows `packedAt`, `shippedAt`, `courierName`, `trackingNumber` and `deliveredAt`, each `null` until its step. A cancelled paid order shows its refund in `payment.refunds`, with the reason `CANCELLED_BY_CUSTOMER` or `CANCELLED_BY_STAFF`.

### The endpoints

| Endpoint | Who | What it does |
|---|---|---|
| `GET /v1/staff/orders` | Staff | Every order, one page at a time, filtered by status or reference |
| `GET /v1/staff/orders/:id` | Staff | One order, with its payment for a Super User |
| `POST /v1/staff/orders/:id/packed` | Staff | Marks a paid order packed |
| `POST /v1/staff/orders/:id/shipped` | Staff | Marks a packed order shipped, with `courierName` and `trackingNumber` |
| `PATCH /v1/staff/orders/:id/shipment` | Staff | Corrects the courier or tracking number of an order on its way |
| `POST /v1/staff/orders/:id/delivered` | Staff | Marks a shipped order delivered |
| `POST /v1/staff/orders/:id/cancel` | Super Users | Cancels an order until it ships, with a paid one's payment back in full |
| `GET /v1/staff/refunds` | Super Users | Every refund, one page at a time, filtered by status |

- **IDs must be UUIDs** (`400`). An unknown order answers `404 Order not found`.
- **A customer token, or none, gets `401`** on these routes. An Admin gets `403 Only a Super User may do this.` on the last two.
- **Rate limits:** the 600 per minute baseline per IP is enough. Each step is one click.

### Who may do what

| | Customer | Admin | Super User |
|---|---|---|---|
| See orders | Their own | Every order, without payments | Every order, with payments and refunds |
| Mark packed, shipped and delivered, and correct the courier | No | Yes | Yes |
| Cancel an order until it ships | Their own | No | Any |
| See refunds | Their own orders' | No | Every refund |

`staff/staff-routes.spec.ts` names the cancel handler as the only Super User handler on the staff order routes, so changing that is always deliberate.

### Modules ask each other

The orders read only their own tables (ADR 0001):
- `StaffOrdersService` (`src/orders`) lists orders and takes their steps. It asks the payments for an order's payment (`PaymentsService.staffPaymentFor`), and the customers' orders to cancel (`OrdersService.cancelLocked`).
- `OrdersService.cancelLocked` asks the payments to give a paid order's payment back (`refundInFull`), and the inventory to give its stock back (`StockService.release`).
- `StaffRefundsController` (`src/payments`) lists refunds (`PaymentsService.listRefunds`).

### The database guards it

The last line of defence, as in ADR 0027:
- **`orders_steps_chk`:**
  - each step after payment has its time, in order;
  - a shipped order names its courier, in 2 to 60 characters without spaces at the ends, and its tracking number, in 4 to 40 letters, digits or hyphens;
  - a delivered order has its delivery time;
  - a cancelled order may keep its `packedAt`, and nothing later.
- **`orders_keep_what_was_agreed`,** now that staff record steps:
  - what the customer agreed to still never changes, and an order is never deleted;
  - each step's time is set once, in the update that takes its step;
  - the courier and tracking number come with shipping, and change only while the order is on its way.
- **`orders_status_moves_forward`:**
  - an order moves `PAID` → `PACKED` → `SHIPPED` → `DELIVERED`;
  - a paid or packed order may become `CANCELLED` only with a `CANCELLED_BY_CUSTOMER` or `CANCELLED_BY_STAFF` refund of the payment that paid it;
  - nothing moves back, and part 8's moves still hold.
- **`refunds_match_their_payment`:**
  - a refund still gives back the whole payment;
  - a `CANCELLED_BY_*` refund is made only for the payment that paid an order that is paid or packed.

### Two migrations

- **`20261109051328_order_steps`,** Prisma's own: the statuses `PACKED`, `SHIPPED` and `DELIVERED`, the refund reasons `CANCELLED_BY_CUSTOMER` and `CANCELLED_BY_STAFF`, the five columns, and the index.
- **`20261109051436_order_steps_rules`,** written by hand: the check and the three trigger functions above. It comes second because PostgreSQL uses a new enum value only once the transaction that added it has ended (ADR 0003).

Before they were applied:
- The rules were tested in 40 cases, with 54 changes refused, on temporary tables inside a transaction that was rolled back.
- Then each rule was broken on purpose, one way at a time. The cases caught all 21 breaks, 2 of them only after a case was added.

## Alternatives considered

- **Admins cancel paid orders too.** Rejected by the owner: Admins never move money.
- **Customers cancel only before paying,** as in part 7. Rejected by the owner: a customer may cancel until the order ships, at the cost of Razorpay's fee on the refund.
- **Cancelling after shipping.** No: the parcel is on its way, so that becomes a return, which comes later.
- **A courier integration,** which would book the courier and follow its tracking through the courier's API. Not now, by the owner's choice: staff type the courier and tracking number in, and mark delivery by hand. Revisit when orders grow.
- **Showing staff the customer's email or account.** Not needed to pack and ship: the delivery name, phone and address are enough, as the matrix's "limited view" for fulfilment proposes.
- **A row lock in raw SQL** (`SELECT … FOR UPDATE`). Not needed: an ordinary update of `updatedAt`, with the status in its filter, locks the order and checks its status at once (ADR 0027).
- **Cancelling part of an order.** Not now: the whole order and the whole payment, as every refund (ADR 0027).
- **Emails at each step.** Not yet: orders send no emails so far (ADR 0026, "Still open").

## Consequences

- **Tests:**
  - 788 unit tests in 88 suites.
  - Each step's tests were checked by breaking the code on purpose, one way at a time. Of 121 breaks, the tests caught 115, and the type check refused the other 6. The tests catch 5 of those 6 too. Where a break first went unnoticed, the tests were made stronger.
  - The smoke test has 88 checks. The new ones:
    - an order shows its customer how far it has come: not packed, shipped or delivered yet, so no courier or tracking number;
    - without a token, or with a customer access token, the staff order and refund routes answer `401`.

    Cancelling twice now also checks the new message.
  - **By hand, on 2026-11-09 and 2026-11-10:**
    - staff marked a paid ₹498 order packed, shipped and delivered. The courier was Delhivery, and the tracking number, typed `ee 1490 8112 3456`, was stored as `EE149081123456`. Each step wrote one audit entry;
    - a Super User cancelled another paid ₹498 order before it was packed. The order became `CANCELLED`, ₹498 went back in full (`CANCELLED_BY_STAFF`), and Razorpay took the refund. Its pack came back into stock, and `order.cancelled` names the refund;
    - the delivered order's customer saw its steps, courier and tracking number.

    A customer cancelling their own paid order was left to the unit tests.
- **Each paid order cancelled costs Razorpay's fee,** about 2.36% of the order, as the owner accepted.
- **A packed order that is cancelled needs hands:** its packs are back in stock at once, so staff must put them back on the shelf.
- **Locally, a refund stays `PENDING`,** as in ADR 0027: Razorpay's webhook can't reach a laptop.
- **Lessons:**
  - **A new enum value needs its own migration** (ADR 0003): the new statuses came one migration before the rules that use them.
  - **Break the database rules too:** 2 of 21 breaks of the rules went unnoticed until a case was added for each.
  - **`toEqual` treats a missing property like one that is `undefined`.** Where that difference matters, as for a correction that changes only some fields, use `toStrictEqual`.
- **Still open:**
  - returns, after delivery, and their refunds;
  - recording in the API that staff gave a `FAILED` refund back by hand;
  - emails to the customer when an order ships, with its tracking number, when it is delivered, and when it is cancelled;
  - a courier integration;
  - the admin console that uses these routes;
  - a note from staff on why they cancelled an order;
  - GST invoices, and going live with Razorpay, once the company is registered (owner, 2026-11-09).
