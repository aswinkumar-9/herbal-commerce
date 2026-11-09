# 0026. Checkout and orders

- Status: Accepted and implemented (part 7)
- Date: 2026-11-08
- Updated: 2026-11-09 (part 8: orders are paid through Razorpay, and an expired order may still be paid late, see ADR 0027)

## Context

Part 6 added the cart, which keeps no prices and holds no stock (ADR 0025). Next on the MVP list (`docs/requirements.md`, section 6) come checkout, delivery charges and tax, and order confirmation. Part 7 builds checkout and orders. Paying for them comes with the payment gateway, in part 8.

The permission matrix (section 4) gives a customer their own orders only. Staff will view, pack and ship them from the admin console, later.

The owner made five choices on 2026-11-07:
- **Delivery is free from ₹499.** Below that it costs ₹49.
- **Online payment only at launch:** no cash on delivery. This answers open decision 4.
- **An unpaid order holds its stock for 15 minutes,** then expires, and the stock comes back.
- **Delivery to all of India.** This answers open decision 1.
- **All money in whole rupees, the GST too,** rounded to the nearest rupee. ADR 0022 had planned whole paise for orders, and orders were first built that way. The owner saw a total in paise during the manual test, and chose rupees everywhere.

A sixth choice, on 2026-11-08, is about deleting a product that has been ordered (see the section on it below).

## Decision

### An order, from the whole cart

`POST /v1/me/orders` places an order from **every line of the cart,** to one of the customer's addresses:
- **every line must be `AVAILABLE`** (ADR 0025). Otherwise the answer is `409`, naming each such pack size: `These packs can't be ordered now: ASH-CAP-60. Change or remove them first.` There are no partial orders, so the customer buys exactly what they saw;
- **the prices are today's,** and the order keeps them;
- **the total must be the one the customer saw.** The request carries `totalRupees` from the checkout. If a price changed in between, the answer is `409 The total has changed. Check the cart and try again.` Nobody pays a price they didn't see;
- **the stock is taken at once,** from the sellable batches that expire first;
- **the cart is emptied.**

All of this is one transaction, after a lock on the cart. A refused order takes nothing, and leaves the cart as it was.

`GET /v1/me/checkout` shows what the cart would cost as an order now, by the same rules. A cart that can't be ordered answers the same `409` there.

### Money in whole rupees

| Amount | Rule |
|---|---|
| A line | `packs` times the price: 3 × ₹449 = ₹1,347 |
| The items | The lines added up |
| Delivery | ₹49 while the items come to less than ₹499. Free from ₹499. |
| The total | The items plus delivery |
| GST | **Inside the prices, never added.** Prices include GST (ADR 0022), so a line's GST is the part of it that goes to the government: `line × rate ÷ (100 + rate)`, rounded to the nearest rupee. 5% inside ₹1,347 is ₹64.14, so ₹64. The order's GST is its lines' GST added up, as an invoice shows it line by line. |

So 3 packs at ₹449 come to ₹1,347, and the customer pays ₹1,347: ₹1,283 for the shop, and ₹64 of GST inside it. One pack at ₹449 costs ₹498 with delivery.

- **Every amount but the GST is exact:** prices are whole rupees, and so is the delivery charge.
- **Why the GST is not added on top:** the price a shopper sees includes all taxes, and the MRP is the most anyone may charge, taxes included. A pack may sell at its MRP, so GST on top would charge more than the MRP.
- The rules are in `orders/order-rules.ts`: `FREE_DELIVERY_FROM_RUPEES`, `DELIVERY_CHARGE_RUPEES`, `gstInsideRupees` and `orderTotals`.
- **The payment gateway takes paise** (part 8, ADR 0027). Our code multiplies by 100 only in its calls to Razorpay. Razorpay's payment page wants paise too, and the app multiplies the order's rupees itself, by the owner's choice: our API answers rupees only.
- **A chartered accountant confirms, before the first invoice:** rounding each line's GST to the rupee, the GST inside the delivery charge (₹49 at 5% holds about ₹2), and the split into CGST and SGST, or IGST.

### What an order keeps

- **`orders`:**
  - `reference`: 10 characters, such as `7KQ2M9XDPA`, for the customer and for support. It is random, from 32 letters and digits that can't be mistaken for each other (no `I`, `O`, `0` or `1`), so it says nothing about how many orders the shop gets. A unique index guards it: a clash is about one chance in 10^15 for two orders;
  - `userId`, with a foreign key `ON DELETE RESTRICT`: an account with orders can't be deleted (ADR 0011);
  - `idempotencyKey`, unique for each customer;
  - `status`, the enum `OrderStatus`: `PENDING_PAYMENT`, `PAID`, `CANCELLED` or `EXPIRED`;
  - a copy of the delivery address: the name, phone, lines, city, state and PIN code;
  - `itemsTotalRupees`, `itemsGstRupees`, `deliveryChargeRupees` and `totalRupees`;
  - `holdExpiresAt`, `createdAt` and `updatedAt`.
- **`order_items`:** one pack size in an order, with a copy of what the customer agreed to: the product's name, the SKU, the size, the HSN code and GST rate, the MRP and the price, `packs`, `lineTotalRupees`, `gstRupees`, and its position in the order.
  - `variantId` keeps the pack size's ID **without a foreign key.** The order keeps its copy even after the pack size is deleted. And no new foreign key answers `P2003` when a pack size or product is deleted, so the mappings of ADR 0024 stay right.

**The database guards what was agreed,** as the last line of defence:
- `orders_amounts_chk`: the items come to more than 0, the GST lies between 0 and the items' total, and the total is the items plus delivery;
- `order_items_amounts_chk`: 1 to 4 packs, a price within the MRP, a line total of packs times price, and GST within it;
- `orders_keep_what_was_agreed`: of an order, only its status may change, and an order is never deleted;
- `order_items_are_final`: an order's lines never change, and are never deleted.

### Holding stock

- **An order takes its packs when it is placed,** as `ORDERED` movements (ADR 0024), from the sellable batches that expire first. A batch's `quantity` therefore counts the packs free to sell. The packs an unpaid order holds show in the batch's history as `ORDERED`.
- **The batches are locked in the order of their IDs,** then read again. Two orders at the same moment take turns, and never wait for each other forever.
- **A pack size that runs short refuses the whole order:** `409 ASH-CAP-60 is out of stock, or not enough of it is left. Change it in the cart and try again.`
- **A cancelled or expired order gives back** what it still holds of each batch, as `RELEASED` movements, in the same transaction as its new status.
- **The database checks both:**
  - `stock_movements_change_chk`: an `ORDERED` movement only removes, and a `RELEASED` one only adds. Both name their order, and no other movement names one;
  - the trigger `stock_movements_release_what_was_ordered` refuses to give a batch back more than the order took from it.
- **Only orders make these movements.** Staff can't, and a batch's history shows them without an actor.

### An order's life

| Status | Means | Next |
|---|---|---|
| `PENDING_PAYMENT` | Placed. It holds its stock until `holdExpiresAt`, 15 minutes later. | Paid, cancelled or expired |
| `CANCELLED` | The customer cancelled it while it waited for payment. Its stock came back at once. | Nothing. A payment that still comes goes back in full (ADR 0027). |
| `EXPIRED` | It wasn't paid within 15 minutes. Its stock came back. | Paid late, if its stock is still free; otherwise the payment goes back in full (ADR 0027) |
| `PAID` | Paid through Razorpay (part 8, ADR 0027) | Packing and shipping, later |

- **The expiry job** (`OrderExpiryScheduler`) runs inside the API every minute, the first time a minute after startup, and never twice at once.
  - It takes at most 100 orders a run, the oldest hold first, each in its own transaction, so one failure keeps no other waiting.
  - It logs counts only: `Unpaid orders expired`.
  - So an unpaid order's stock comes back within about a minute of its hold ending.
- **A cancel and an expiry at the same moment never both happen.** Each changes the status only while it is still `PENDING_PAYMENT` (a conditional `updateMany`), so the one that comes second finds nothing to change. Several API instances can run the job safely too, and paying uses the same guard (ADR 0027).
- **At most 3 orders wait for payment per customer.** A 4th answers `409 You have 3 orders waiting for payment. Pay for one or cancel it first.` Nobody can hold the shop's stock with many unpaid orders. Placing orders also has its own rate limit: 30 per hour per IP.
- **Orders are paid since part 8** (ADR 0027). Before the job expires an order that started paying, it asks Razorpay whether the payment came.

### A double tap places one order

`POST /v1/me/orders` needs an `Idempotency-Key` header: a new UUID for each order the customer means to place.
- The app makes one when the customer taps "Place order", and sends the same one again only to retry that tap.
- **The same key again answers the order it placed the first time** (`201`), and places nothing, whatever the body says.
- **A double tap takes turns** behind the cart's lock, so the second request finds the first order.
- A refused request places nothing, so its key may be used again.

### The endpoints

| Endpoint | What it does |
|---|---|
| `GET /v1/me/checkout` | What the cart would cost as an order now: its lines at today's prices, the GST inside them, delivery and the total |
| `POST /v1/me/orders` | Places an order from the cart, with the `Idempotency-Key` header and a body of `addressId` and `totalRupees` |
| `GET /v1/me/orders` | The customer's orders, the newest first, one page at a time |
| `GET /v1/me/orders/:id` | One of the customer's orders, with its lines and delivery address |
| `POST /v1/me/orders/:id/cancel` | Cancels an order waiting for payment. Its stock comes back at once. |

- **An order has an ID,** like an address (ADR 0019): it is the customer's own record. Its lines name their pack size by SKU, and show no IDs, as in the shop.
- **The address must be one of the customer's own.** Anyone else's answers `404 Address not found`. The order keeps a copy, so changing or deleting the address later doesn't change the order.

### Modules ask each other

The orders read only their own tables (ADR 0001):
- **the addresses** give the delivery address (`AddressesService.deliveryAddress`), or `404`;
- **the cart** gives its lines (`CartService.lines`), locks them for an order (`lockedLines`) and empties itself (`clear`), in the order's transaction;
- **the catalog** describes the pack sizes (`ShopPacksService.findByIds`), now with their product's HSN code and GST rate;
- **the inventory** says what is in stock (`StockService.inStock`), takes it (`take`) and gives it back (`release`).

### Who may do what

| | Visitor | Customer | Admin | Super User |
|---|---|---|---|---|
| Check out, place and cancel an order | No | Their own only | No | No |
| See orders | No | Their own only | Later, in the admin console | Later, in the admin console |

- **Every lookup names the customer from the token:** `where: { id, userId }`. Someone else's order answers `404`, like an unknown one (BOLA). The smoke test proves it on every run with a second customer.
- **A staff token gets `401`** on these routes, as on every customer route.
- **Orders are not in the audit log:** it records staff actions. An order is a record itself, never changed and never deleted.

### Deleting a product that was ordered

The owner chose on 2026-11-08:
- **a pack size out of stock stays in the shop,** shown as out of stock, and can't be bought (ADR 0024, ADR 0025);
- **new stock brings it back:** staff receive a new batch;
- **a product the owner never wants back can still be deleted,** once its stock is written off to 0 (ADR 0024).

The cost: deleting a pack size deletes its batches with their movements. The record of which batch went into which order goes with them. The orders themselves keep their copy of the names, SKUs and prices. An unpaid order whose batches were deleted gets nothing back when it expires.

### Three migrations

1. `20261107111645_orders`: the two tables, the enum `OrderStatus`, the new stock reasons `ORDERED` and `RELEASED`, `stock_movements.orderId`, and the order checks and triggers above.
2. `20261107111813_stock_for_orders`: the stock check and trigger that use the new reasons. PostgreSQL lets a new enum value be used only once the transaction that added it has ended, so they need a migration of their own (ADR 0003).
3. `20261107141238_orders_in_rupees`: the owner's switch to rupees.
   - It renames the eight money columns (ADR 0003), and replaces the trigger function that names them.
   - It converts the orders placed so far, with their guards turned off inside its own transaction only.
   - It refuses to run if an amount other than the GST isn't whole rupees.

The first two were tested in 28 cases, and the third in 8 more, after converting two sample orders. A separate test showed it refusing an order of ₹449.50. Every test ran on temporary tables inside a transaction that was rolled back, before the migration was applied.

## Alternatives considered

- **Whole paise for order amounts,** the plan of ADR 0022, and built first. Rejected by the owner on 2026-11-07: the shop thinks in rupees. Only the GST had paise, and it is rounded to the rupee instead.
- **GST added on top of the price.** Rejected: prices include GST, as an MRP must (ADR 0022), and a pack sold at its MRP would cost more than the MRP.
- **Cash on delivery.** Rejected by the owner for the launch.
- **Taking the stock only when paid.** Rejected: two customers could pay for the last pack. A 15-minute hold is enough to pay.
- **Ordering only the available lines.** Rejected: the customer would buy something other than what they saw.
- **A running order number** (1001, 1002, …). Rejected: it tells anyone how many orders the shop gets. GST invoices will get their own running number per financial year, as the law asks.
- **Trusting a total sent by the client.** Rejected: the server prices every order. The client's total is only compared, so a changed price is never charged unseen.
- **A foreign key from an order's line to its pack size.** Rejected: the order must outlive the pack size, and the key would change what `P2003` means when a pack size or product is deleted (ADR 0024).
- **Expiring orders with a database job or a queue.** Not now: a timer inside the API is enough, like the hourly cleanup (ADR 0011), and the conditional update keeps it safe with several instances.
- **Never deleting a product once it was ordered,** so that every order's batches stay known, for recalls. Not chosen by the owner, who wants to delete a product for good. Revisit if recalls by batch need it.

## Consequences

- **Tests:**
  - 632 unit tests in 79 suites.
  - The smoke test has 81 checks. The new ones:
    - checkout needs a customer token, and an empty cart can be neither checked out nor ordered;
    - placing an order needs an `Idempotency-Key` and a valid body (`400`);
    - an order is placed at the checkout's total: `201`, waiting for payment for 15 minutes, its lines without IDs, and the cart emptied;
    - the same `Idempotency-Key` answers the same order, which only its owner can list and see;
    - cancelling gives the stock back: `200` and `CANCELLED`, then `409`, and the pack is in stock again.

    With a pack in stock, each run leaves one cancelled order behind, since orders are never deleted. Without one, the checks that need it have nothing to try and pass, so the count stays 81 on an empty shop.
  - **By hand, on 2026-11-07,** twice, after the switch to rupees:
    - an Admin made a live product with two pack sizes in stock. One had two batches, and the one that expires first held 2 packs;
    - a new customer added an address and ordered 3 packs: ₹1,347, with ₹64 of GST inside and free delivery. The order took the 2 packs of the batch that expires first, and 1 from the next. The same key answered the same order, and the cart was empty;
    - the customer cancelled it, and the stock came back. Cancelling again answered `409`;
    - an order of 1 pack cost ₹498: ₹449 with ₹21 of GST inside, and ₹49 delivery. It was left alone, expired after 15 minutes, and gave its pack back;
    - refused: an empty cart (`409`), no `Idempotency-Key` (`400`), a total the customer never saw, also the right total in paise (`409`), and another customer's address (`404`);
    - with 3 orders waiting for payment, a 4th was refused (`409`);
    - the smoke test ran while stock was in the shop;
    - a Super User wrote the stock off, and deleted the product and the category.

    One order had been placed in paise before the switch. The migration converted it, and the database checks passed.
- **Lessons** (ADR 0003):
  - **Ask the owner before choosing a unit.** Orders were built in paise, as ADR 0022 had planned, without asking plainly. The change cost a migration and a second manual test.
  - **A new enum value needs its own migration** before anything can use it.
  - **A migration that converts guarded rows** turns their triggers off inside its own transaction only, and first checks that every value converts exactly.
  - **Lock many rows in one fixed order,** by ID, so two transactions never wait for each other forever.
  - **A status guard instead of a lock:** an update that names the status it expects lets a cancel and an expiry race safely.
- **Still open:**
  - paying for an order: done in part 8, through Razorpay (ADR 0027);
  - GST invoices, numbered per financial year, with the chartered accountant's answers on rounding, the delivery charge and the CGST, SGST or IGST split;
  - staff seeing, packing and shipping orders (the admin console);
  - an email confirming an order;
  - returns, and refunds a customer asks for. Payments that can't be kept go back on their own since part 8 (ADR 0027);
  - how long orders are kept for the tax records, and what deleting an account keeps (ADR 0011).
