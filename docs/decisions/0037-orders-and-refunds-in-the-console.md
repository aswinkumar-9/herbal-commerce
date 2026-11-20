# 0037. Orders and refunds in the console

- Status: Accepted and implemented (part 12F)
- Date: 2026-11-19
- Updated: 2026-11-20 (part 12G: a failed refund is marked as given back by hand, closing open decision 7, see ADR 0038)

## Context

Since part 9 (ADR 0028), staff take an order through its steps with the API alone, in PowerShell: packed, shipped with the courier and tracking number, the tracking corrected, delivered, and, for Super Users, cancelled with the payment back in full. Super Users list the refunds there too, and give back by hand those Razorpay refused. Since part 10, the customer is emailed at each step (ADR 0029). Part 12F brings orders and refunds to the admin console.

The owner made these choices on 2026-11-19:
- **The first view:** the paid orders waiting to be packed, the oldest first. Chips show the other steps: Packed, On its way, Delivered, Cancelled, Waiting for payment, Expired and All. A reference a customer quotes finds their order.
- **All four extras:** a packing slip to print, the number of orders to pack beside Orders in the menu, the list showing new orders by itself, and packing several orders at once.
- **Refunds:** a tab inside Orders, for Super Users only. The failed ones first, saying to give the money back by hand in the Razorpay dashboard. Each leads to its order.
- **No new API for packing several:** the console sends one request for each order, one at a time.
- **Each refund names its order by its reference** (chosen while building the Refunds tab): a small addition to the API, so the link reads "Order 7KQ2M9XDPA", as the customer quotes it.

These defaults were chosen during development and told to the owner, who could overrule them:
- the packing slip has no prices, and says "Not a tax invoice": invoices wait until the company is registered;
- the lists and the count look again every minute, pause while the tab is hidden, and never count as activity, so they never keep a session from its idle sign-out;
- the count in the menu shows "99+" beyond 99.

## Decision

### The API

- **`GET /v1/staff/refunds`** gives each refund its order's reference, `orderReference`, beside `orderId`. It is read in the same query, through the refund's payment and its order. No migration, and nothing else changes.

### The Orders page

- **It opens on the work:** the paid orders to pack, the oldest first. The chips show the other steps. To pack, Packed and On its way list the oldest first, as queues of work. The others list the newest first. The chip chosen stays in the address (`?show=packed`), and the first chip has none.
- **A reference finds its order, whatever its step,** once all 10 letters and digits are typed. Small letters, spaces and hyphens are fine (`orderReference`). It goes into the address as `?reference=`, and the chips step aside while it is there. A reference in the address that cannot be one is ignored.
- **Each row:** the reference, who it goes to and where, when it was placed in India's time, and the total in whole rupees. On All and in a search, a tag says its step in words. The whole row opens the order, which keeps the list's filters for the way back.
- **"Show more"** reads the next page.
- **The list looks for new orders every minute,** while the console is in view (`REFRESH_MS`).
- **Beside Orders in the menu, the number of paid orders to pack,** read every minute too. Up to 100 are counted, and beyond 99 it says "99+". Nothing shows when none wait, or when the number can't be read. A screen reader hears "Orders: 2 to pack".

### An order's page

- **The header:** "Order 7KQ2M9XDPA", its step, and when it was placed.
- **The next step, one button at a time:**
  - **paid:** "Print packing slip" and "Mark packed", in one click;
  - **packed:** the slip again, and "Mark shipped", which asks for the courier and the tracking number;
  - **on its way:** "Correct the tracking", and "Mark delivered", which asks first;
  - **waiting for payment:** until when it holds its stock. Delivered, cancelled and expired orders say so.
- **The courier and the tracking number are checked as the API checks them** (ADR 0028), before anything is sent:
  - the courier in 2 to 60 characters;
  - the tracking number in 4 to 40 letters, digits or hyphens, saved in capitals without spaces.
  - A correction sends only what changed, compared as the API keeps them, and nothing at all when nothing did.
- **Cancel the order,** for Super Users only, until it ships. The dialog says what follows:
  - its packs go back into stock, and a packed order's box needs unpacking;
  - a paid order's total goes back in full through Razorpay, which keeps its fee of about 2.36%;
  - the customer is emailed;
  - it can't be undone.
- **A step refused because the order moved on** (`409`), perhaps by someone else, reads the order again and says why.
- **Items:** packs × price, each line's total, the SKU, the HSN code and the GST rate. Then the items, the GST inside them, the delivery charge ("Free" when it is) and the total.
- **Deliver to:** the address, and the phone number as a link that calls it.
- **Steps:** placed, paid (for Super Users), packed, shipped with the courier and the tracking number, delivered, each with its time.
- **Payment, for Super Users only:**
  - the amount, when it was paid, and Razorpay's payment and order IDs;
  - every refund, with its reason and its status in words;
  - a failed one says to give it back by hand.
- **After a step,** the order as the API answered is put on its page at once. Then the lists, the count, the refunds and the stock are read again, but no other order's page (`orderChanged`).

### The packing slip

- **"Print packing slip"** on paid and packed orders opens the browser's own print, on A4 with 16 mm margins.
- **Only the slip is printed.** The menu, the buttons and the notes are left out, and the slip is black on white, whatever the computer's theme. On screen it is hidden.
- **What it shows:**
  - the shop's name, the order's reference and when it was placed;
  - "Deliver to": the name, the address and the phone number;
  - each item's product, pack, SKU and packs, with a box to tick by hand;
  - the packs in all, and lines for "Packed by" and "Checked by".
- **No prices,** and "Packing slip. Not a tax invoice." at the top.
- **No PDF is made,** so no new package and nothing new under the page's policy: Chrome prints it as one A4 page, and can save it as a PDF.

### Packing several at once

- **Only on the To pack list:** not in a reference search, and not while another step's list still stands in as it loads.
  - Each row gets a tick box above its link, named "Choose 7KQ2M9XDPA", 44 pixels square.
  - "Choose all shown" ticks every order the list shows, or none. It is half ticked while some are.
  - Choosing another chip forgets the ticks.
- **A bar at the bottom of the window** while any are ticked: "2 chosen", "Clear the choice" and "Mark 2 packed". It stays in view however long the list.
- **It asks first,** naming each order, as each customer is emailed and a packed order can't go back to paid. Nothing is sent until staff say yes.
- **One request at a time, in the order shown** (`packEach`). The dialog ticks each one off, with a bar that fills.
  - **An order that moved on** (`409`, packed or cancelled by someone else) or is gone (`404`) is refused, and the rest go on.
  - **Anything else stops the run:** an ended session, or a server that can't be reached or is busy, would refuse the rest the same way. Those are marked "Not sent".
- **When all are packed,** the dialog closes: "3 orders packed".
- **Otherwise it stays open:** "1 of 2 packed", with the reason under each order not packed. Those stopped or not sent stay chosen, to try again. Those refused leave the list as it reads again.
- **The dialog packs the orders chosen when it opened,** while the list behind it may refresh. Each opening starts afresh.
- **The lists are read again once at the end,** not once for each order (`ordersChanged`).

### The Refunds tab

- **Tabs "Orders" and "Refunds"** at the top of Orders, for Super Users. Admins see no tabs. At `/orders/refunds` they read that the page is for Super Users, and the console never asks for refunds for them.
- **The failed refunds first,** in a red card titled "Failed: give these back by hand". It asks staff to give each back by hand in the Razorpay dashboard, from the payment named on it, and to let the customer know. The card shows only when some have failed.
- **Then every refund, the newest first.** Each row shows:
  - how much, its status in words, and when that last changed;
  - why it was made, and when it started;
  - Razorpay's payment and refund IDs, which can be selected and copied, as the row is not one big link;
  - a link to its order, "Order 7KQ2M9XDPA".
- **An order opened from here leads back to Refunds,** its "no such order" page too.
- **Both lists look again every minute,** and "Show more" reads more of each.
- **Still open:** a failed refund given back by hand stays `FAILED`. Nothing marks it done, so it stays in the card (open decision 7 in `docs/requirements.md`).

### Found in a real browser

Headless Chrome drove the built console under its full security policy, against a stand-in API that follows the API's steps and refusals: the lists, the steps, the slip as printed, packing several with one order packed elsewhere meanwhile and one answer that never came, the Refunds tab, an Admin's view and phone width. It found no policy violation and no page error, and four things to change:
- **A dialog's first focus.** With a list long enough to scroll, Chrome put the first focus on the list, not on "Not yet". Every dialog now gives it to its first field or button.
- **Notes over buttons.** For a few seconds after a step, a note such as "R7WX4N2KTB packed" lay over the bar's "Mark 2 packed" and took the click. A product's save bar had the same problem. A bar at the bottom now says how much room it takes (`useBottomBar`), and the notes rise above it.
- **The menu count's contrast.** It was 4.48:1 in light, at the darkest pixel behind it, and is now 4.53:1. Every other new text measured 5:1 or more, in light, dark and at phone width.
- **A dialog whose opener is gone,** such as the bar once every order is packed, gives the focus to the page's main area, not to nothing.

Chrome also sent a step again by itself, up to 7 times, when a connection closed without an answer. The console never sends a step twice, and the API refuses a repeated step (`409 This order is packed already.`), so no order is packed or shipped twice.

### Security

- **The page's security policy is unchanged.** No new packages: printing is the browser's own.
- **Names, addresses, couriers, tracking numbers and Razorpay's IDs are shown as text,** never as HTML.
- **An order's ID from the address reaches the API only as a UUID** (`idInPath`), and a reference only if it matches the pattern.
- **Every answer is checked with zod,** an unknown step, unit, reason or refund status included.
- **Payments and refunds are shown to Super Users only,** and the API refuses them to Admins either way.
- **The minute's reads never keep a session alive:** they are not activity, and they pause while the tab is hidden.

## Alternatives considered

- **An API endpoint that packs several orders at once.** Rejected by the owner. One request for each order keeps each customer's email, each audit entry and each order's stock exactly as when packed one by one. It is slower for many orders, which is fine for a shop's tens a day.
- **Sending them all at the same time.** Rejected: competing requests would lock batches in different orders and wait on each other. A failure in the middle would also be harder to explain. One at a time stops cleanly where it went wrong.
- **A PDF packing slip,** made with a library or by the API. Rejected: a new package for what the browser prints well. The invoice will be a part of its own.
- **Prices on the slip.** Rejected: whoever opens the box doesn't need them, and a tax invoice waits until the company is registered.
- **Live updates through server-sent events or WebSockets.** Rejected for now: a minute is quick enough for packing, and needs no new server code. Notifications in the apps are a later requirement (`docs/requirements.md`, section 10).
- **Refunds as an area of their own in the menu.** Rejected by the owner: they belong with the orders.
- **Fetching each refund's order for its reference.** Rejected: one more request for every refund. The API names it in the query it already runs.
- **The whole refund row as a link,** as on the orders list. Rejected: Razorpay's IDs must be selectable, to find the payment in the dashboard.
