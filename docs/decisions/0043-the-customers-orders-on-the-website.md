# 0043. The customer's orders on the website: the list, each order's history, and cancelling

- Status: Accepted and implemented (part 14D)
- Date: 2026-11-23

## Context

Since part 7 the API lists a customer's orders, the newest first, a page at a time (`GET /v1/me/orders`), and shows each one (ADR 0026). Since part 9 staff mark an order packed, shipped (with the courier and the tracking number they type in) and delivered, and customers cancel their own order until it ships, a paid one's payment going back in full (ADR 0028). Since part 10 each of these steps emails the customer (ADR 0029). Part 14C gave the website an order's own page, reached only from checkout (ADR 0042): customers could not find an order again, follow it, or cancel it.

The owner made these choices on 2026-11-23:
- **The list shows what is in each order:** its first product and how many more. This needs a small change to the API, and no migration.
- **A cancelled order shows no date for its cancelling:** the API keeps none. A paid order's refund has its own date.
- **Tracking:** the courier's name and the tracking number, with a "Copy" button. No links to couriers' sites.

## Decision

### The API: each order at a glance

- **`GET /v1/me/orders` names each order's first product, and how many more** (`apps/api/src/orders/orders.service.ts`):
  - `firstProductName` is the product of its first line;
  - `moreProducts` is how many other products it has. Two pack sizes of one product count once.

  Both are read in the same query from the product names the order's lines keep from when it was placed. Nothing new is stored (`docs/api-specification.md`, v0.31).

### The list: `/orders`

- **Reached from:**
  - "Orders" in the menu, for a signed-in customer, before "Account";
  - "Your orders", the first section of the account page;
  - "All your orders" on each order's page;
  - checkout, when 3 orders already wait for payment: "Pay for one or cancel it first", with "See your orders".
- **Twenty at a time, the newest first** (`routes/orders.tsx`). Each order is a card with:
  - what is in it: "Tulsi Tea and 1 more", or "Order 7KQ2M9XDPA" for an order without lines;
  - "Placed on 7 Nov 2026", in India's time, made on the server, and its reference;
  - where it stands, as a chip:
    - gold while it waits for payment, with "Pay by 8:27 pm";
    - saffron once paid, packed, on its way or delivered;
    - muted once it ended;
    - "Time to pay is over" once its time to pay has passed, even before the API ends it;
  - its total.

  The whole card is the link to the order's page. Each link is read out with ", order 7KQ2M9XDPA" after it, so links to two orders of the same product can be told apart.
- **"Show more orders"** adds the next twenty in place, as a category's "Show more" does (ADR 0039):
  - each order is shown once;
  - "20 more orders shown." is read out;
  - the keyboard moves to the first new card.

  Without the page's script, it is a link to `/orders?before=<the last order's ID>`, a page of its own with "Back to your newest orders". `?before=` is used only when it is a UUID; anything else starts the list from the newest.
- **No orders yet:** "You have not placed an order yet.", with "Go to the shop".
- **Like every page of a signed-in customer's,** it is read afresh every time, `private, no-store`, and never listed by search engines.

### An order's history and tracking

- **"History",** on each order's page (`historyOf` in `app/orders.server.ts`):
  - the steps Placed, Paid, Packed, Shipped and Delivered, each with its date and time in India ("7 Nov 2026, 8:12 pm"), or "Not yet";
  - a step is done once it has a time, or once the order is past it.
- **An order that ended** shows the steps it took, then how it ended:
  - "Cancelled", with no date (the owner's choice);
  - "Not paid in time", at the end of its time to pay.
- **Once shipped,** the courier and the tracking number, as staff typed them, with "Use it on the courier's website to follow your parcel.":
  - the number is selected with one click;
  - "Copy" copies it and says "Copied" for 3 seconds, read out as "Tracking number copied.";
  - "Copy" shows only where the browser can copy (`navigator.clipboard`), so it is never a button that does nothing.

  There are no links to couriers (the owner's choice): staff type the courier's name in, so the website can't know its site.

### Cancelling, asked once more first

- **"Cancel this order"** sits at the foot of an order's page while the API allows cancelling: while it waits for payment, once paid, and once packed (ADR 0028). Once its time to pay is over, it isn't offered: the order ends by itself. It says what follows:
  - waiting: "Changed your mind? Cancel it, and its packs go back on sale.";
  - paid: "You can cancel it until it ships. Your ₹348 then comes back to you in full."
- **"Cancel order" doesn't cancel; it asks,** at the top of the page, with the keyboard there:
  - "Cancel order 7KQ2M9XDPA?";
  - what cancelling does ("It will not be sent, and your ₹348 goes back to you in full.");
  - "Yes, cancel it", or "Keep the order".

  While it asks, "Pay" is hidden, so the page never offers both. Without the page's script, the question comes as the page made again, the same. Removing an address asks the same way (ADR 0041).
- **"Yes, cancel it"** asks the API (`POST /v1/me/orders/:id/cancel`). The button says "Cancelling", and a second press waits. Then the order's page, with `?done=cancelled`:
  - "Your order is cancelled.", with the keyboard on it;
  - the history ends with "Cancelled";
  - for a paid order, "Money going back": "You cancelled the order. ₹348 is on its way back to you."

  The note shows only when the order really is cancelled. The API puts the packs back on sale, asks Razorpay for the refund, and emails the customer (ADR 0028, ADR 0029). The website only asks, and shows what the API answers.
- **When cancelling is refused,** the page says why, with the keyboard on the message:
  - shipped meanwhile: "This order can no longer be cancelled. It may have shipped a moment ago.", and the page shows the order on its way;
  - too many tries, with how long to wait;
  - the API resting: "We could not cancel your order just now. Please try again in a minute."

  An ID that isn't a UUID, or an order that isn't the customer's own, is "not found", and a made-up ID never reaches the API.
- **The page reads the order again after every action, even a refused one** (`shouldRevalidate`). React Router keeps a page's data after an action that answers `4xx` or `5xx`, so the page would still have offered to cancel an order that had shipped. Checkout does the same (ADR 0042).
- **Cancelling is a form like every other on the website:** its server takes it only from the website itself (`Origin`, ADR 0041).

### The checks

- **Website:** 541 tests (46 new), with Vitest and Testing Library, against a stand-in for the API. Deliberate breaks: 58 of 58 caught across the list, the history and cancelling. Three were caught only once a test was added: a paid order the API gives no time for, a packed order's words, and an order shipped while the customer is asked.
- **API:** 1073 tests. The smoke test checks the list's first product and how many more.
- **The build check** (`scripts/check-build.ts`):
  - opens `/orders` signed in (`no-store`, no token in it) and as a visitor (sent to sign in);
  - checks the list's words, the menu's link, and the history on an order's page;
  - checks that "Cancel order" asks without reaching the API, and that "Yes, cancel it" asks the API once, then goes to `?done=cancelled`.

  Skipping the question on purpose made it fail.
- **Headless Chrome,** against a stand-in for the API that also takes an order through staff's steps:
  - 8 checks for the list;
  - 8 for the history and tracking, copying with the browser's real clipboard;
  - 9 for cancelling:
    - asking first;
    - keeping the order;
    - cancelling a waiting order;
    - cancelling a paid one;
    - an order shipped while the customer is asked;
    - no script;
    - 3 orders waiting at checkout;
    - phones and dark;
    - no policy violation anywhere.

  The earlier checks for the cart, checkout and paying still pass.
- **By hand, by the owner, against the real API in Razorpay's Test Mode:**
  - an order paid, then packed, shipped with a courier and a tracking number, and delivered from the console, followed on the website, with "Copy";
  - a paid order cancelled, with its refund;
  - a waiting order cancelled.

  The owner reported it done.

## Consequences

- Customers find every order again, follow it to their door, and cancel it themselves until it ships.
- A cancelled order shows no date for its cancelling. Showing one would need the API to keep the time, with a migration.
- To follow a parcel, customers open the courier's site themselves. Links would need the couriers, with their tracking addresses, chosen from a list in the console rather than typed in.
- "Time to pay is over" in the list is worked out from the website server's clock. The API ends the order within a minute (ADR 0026).
- A refund Razorpay can't give back shows "could not be given back by itself", for a Super User to give it back by hand (ADR 0038).
- With part 14D, the website sells from the shop to a delivered or cancelled order. Still to come: GST invoices, once the company is registered; UPI on Razorpay's page, checked when going live (ADR 0042); and the customer app.

## Alternatives considered

- **The list without what is in each order:** the reference, the date, where it stands and the total, with no change to the API. But customers don't know their orders by reference. The owner chose the first product and how many more.
- **A date for cancelling:** the API would have to keep the time, with a migration. The owner chose no date.
- **Links to couriers' tracking pages:** the owner chose not to, as staff type the courier in.
- **Cancelling at once, without asking:** one press fewer, but it can't be undone, and a paid order's money goes back. Asking takes one more page step, and works without a script.
- **Asking in a dialog over the page:** it needs the page's script. The question as part of the page works without one, and the keyboard goes to it.
- **The whole list at once:** fine with a few orders, but the API sends at most 50 a page, and a customer's orders only grow.
