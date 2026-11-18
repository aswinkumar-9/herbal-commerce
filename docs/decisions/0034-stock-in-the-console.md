# 0034. Stock in the console

- Status: Accepted and implemented (part 12D)
- Date: 2026-11-19

## Context

Since part 5, stock is kept per batch, in one warehouse, and a batch sells only with at least 6 months left (ADR 0024). Staff could manage it only by hand, with PowerShell, one pack size at a time. Nothing showed which pack sizes were out of stock, running low, or about to stop selling. Orders take packs from batches and give them back (ADR 0026), but staff couldn't see how many packs orders held, so a count of a shelf was hard to check. Part 12D brings stock to the admin console.

The owner made these choices on 2026-11-18:
- **Where:** a Stock page listing every pack size, filtered to those out of stock, low, or expiring soon. A pack size opens its batches. Each product's page shows its pack sizes' stock too.
- **Counting:** staff type the number they **counted**, and the API works out the difference. If the stock changed while they counted, the count is refused.
- **Low stock:** each pack size has its own number, `lowStockAt`, 10 by default. It is kept by the API, so reports can use it later (`docs/requirements.md`, section 10).

These defaults were chosen during development and told to the owner, who could overrule them:
- "expiring soon" means a batch stops selling within 30 days;
- the Stock page lists drafts and pack sizes off sale too, each with a tag;
- a count is per batch, of the shelf: packs of packed orders are in their boxes, so they are not counted;
- a `lowStockAt` of 0 means never low, only out of stock.

## Decision

### The API

- **What orders hold of each batch** is summed from the orders' own stock movements, by the order's status (`holdsOf` in `src/inventory/stock-lines.ts`):
  - **awaiting packing:** orders waiting for payment, or paid and not yet packed. Their packs are still on the shelf;
  - **packed:** packed and not yet shipped. Their packs are in boxes.
  - Movements of a batch for one order add up to what it holds: taken, taken again after a late payment, less what it gave back.
- **Every batch answer** gains four fields:
  - `stopsSellingOn`: the first day the batch may no longer be sold. For a batch expiring on 30 September 2028, that is 1 April 2028;
  - `awaitingPacking` and `packed`, as above;
  - `onShelf`: what a count of the shelf should find, the free packs plus those awaiting packing.
- **A pack size's stock**, summed from its batches each time, so it is never out of date:
  - free and sellable packs, and what orders hold;
  - a level: `OUT` when no pack may be sold, `LOW` at the pack size's `lowStockAt` or fewer, otherwise `OK`;
  - the next day a batch that may be sold today, and still holds packs, stops selling, and whether that is within 30 days.
- **`GET /v1/staff/stock`** lists every pack size with its stock, drafts and packs off sale too, by product name, then in each product's own order.
  - Filters: `status` (`out`, `low` or `expiring`), `productId`, and `q`, words in the product's name or the SKU.
  - The words are found as typed: Prisma's `contains` is SQL's `LIKE`, so `%`, `_` and `\` are escaped first (`asTyped`). Without that, a search for "100%" found every name with "100" in it.
  - Pages of up to 100, continued after the last pack size's ID. If that pack size has gone from the list, the answer asks to start again from the first page.
  - The levels are worked out in the service, not in SQL, as they depend on the batches and the orders' holds. A shop's few thousand pack sizes are read in one go.
- **`GET /v1/staff/variants/:variantId/batches`** now also returns the pack size, its product and its stock. `quantity` and `sellableQuantity` stay, for the scripts that use them.
- **`POST /v1/staff/batches/:id/count`** with `{ counted, onShelf, note? }`. Staff send what they counted and what they were shown should be there, never a difference.
  - The batch is locked first, with the same lock as every stock movement.
  - If its `onShelf` is no longer what was sent, an order took or gave back packs meanwhile: `409`, and nothing is saved.
  - A count that matches saves nothing, and answers `change: 0`.
  - A count that differs needs a note. It writes one `CORRECTION` movement and a `stock.counted` audit entry: what should have been on the shelf, what was counted, the change and why.
  - A count below the packs that orders awaiting packing still need is refused (`409`): the count or those orders are wrong.
- **`lowStockAt`** on each pack size: a whole number from 0 to 1,000,000, 10 by default, set when it is added or changed. A database constraint keeps it in range. Customers never see it.

### The Stock page

- **Every pack size, grouped by product,** with the product's name, a Draft tag, and a link to the product. Each row shows:
  - the pack size, its SKU, and "Off sale" when it is;
  - what may be sold, what is for orders to pack, and what is packed for shipping;
  - packs too near expiry to sell, when there are any;
  - when its next batch stops selling, in the warning colour within 30 days;
  - "In stock", "Low" or "Out of stock", in words as well as colours.
- **"Show":** All, Out of stock, Low or out, and Expiring soon. **Search** finds a product's name or a SKU, as on the products list. Both stay in the address, so the way back from a pack size returns the list as it was.
- **"Show more"** reads the next page. A product whose pack sizes run across two pages stays one group.
- **Each row opens its pack size's page.** The whole row is the link, named for screen readers as "100 ml, Amla Shampoo".

### A pack size's page

- **The header:** the product and the pack size, its tags, its SKU, its stock in words, and when it counts as low, with a link to change that on the product's page.
- **Its batches, the first to expire first,** the order in which orders take them. Each batch shows:
  - its label dates, and when it stops selling;
  - a tag: "Stops selling soon", "No longer sold" or "Expired";
  - four numbers: free to sell, for orders to pack, on the shelf, and packed for shipping.
- **Empty batches are folded away** under "N empty batches", so years of old batches don't crowd the page.
- **Receive a delivery:** the batch number, the two label dates, how many packs came, and a note.
  - It is checked as the API checks it: the manufacturing date not in the future, the expiry after it, and not already expired.
  - A batch with less than 6 months left is said to be one that will never be sold, before it is received.
  - A number the pack size already has marks its field.
- **Change stock:** "Damaged or lost" or "Expired" write packs off, at most the batch's free packs. "More arrived" adds packs, and isn't offered for an expired batch.
- **Correct label:** the batch number or a date. Only what changed is sent, and the stock never changes here.
- **Count:** the dialog shows what should be on the shelf, its free packs and those for orders not yet packed, and asks to leave out packs already in boxes.
  - As staff type, it says whether the stock will go up, go down or stay the same.
  - A count that differs needs a reason.
  - A count below what unpacked orders need is refused before it is sent.
- **History:** each batch's movements, newest first, a page at a time, read only when opened. Orders' movements show as "Taken by an order" and "Given back by an order".
- **Every change puts the batch in its place at once,** then reads every stock answer again, as the pack size's sums and the Stock page's filters change with it (`stockChanged`).

### A count that went stale

A count takes minutes, and orders keep coming. The dialog remembers what staff were shown should be on the shelf when they started.
- When the API refuses the count (`409`), the batch is read again. The dialog then shows the new number everywhere, in its box, its breakdown and its hint, and an alert names the old one: "30 packs should now be on the shelf, not 32 packs".
- The next "Save the count" only acknowledges the change. It sends nothing, and puts the cursor back in the count. Staff check their count against the new number, then save again.
- So a count is never saved against numbers that changed, and staff always see why.

### The product's page

- **Each pack size gets one more line:** its level, how many packs may be sold, a warning when a batch stops selling within 30 days, and "Batches", which opens its page.
- **The stock is read apart from the pack sizes,** so the section works without it. If it fails, a short notice with "Try again" shows above the list. A product with no pack size asks for no stock.
- **The way back goes where staff came from.** A pack size's page opened from a product leads back to it, named after the product, and the product still knows the products list's filters. Opened from the Stock page, it leads back to the Stock page.

### Dates and numbers

- **A label's date is shown from its digits:** 2026-12-01 is "1 Dec 2026", whatever the computer's time zone. A formatter that goes through a `Date` depends on the computer's time zone, and could show a label a day off.
- **"Today" is India's date** in the console too (`todayInIndia`), as in the API. The page reads the time once, not on every render (`useNow`).
- **Times in the history are India's:** "18 Nov 2026, 09:05".
- **A change has a true minus sign:** "−2", not a hyphen.

### Security

- **The page's security policy is unchanged.** No new packages.
- **Batch numbers, notes and names are shown as text,** never as HTML.
- **A pack size's ID from the address** reaches the API only as a UUID (`idInPath`). Anything else is never sent.
- **Every answer is checked** with zod, an unknown stock level, reason or unit included.

## Alternatives considered

- **Staff type the difference,** such as "−3". Rejected by the owner: people count packs, not differences, and a difference typed while an order takes packs would be wrong without anyone knowing.
- **Counting all of a pack size's batches at once.** Rejected: batches expire and are written off one by one, and a shelf is sorted by batch.
- **Counting the packs of packed orders too.** Rejected: they are in boxes by the door, not on the shelf, and would be counted twice.
- **One low-stock number for the whole shop.** Rejected by the owner: a 500 ml bottle and a 10 g sachet sell at very different rates.
- **A stored running total per pack size.** Rejected: sums from the batches each time are never stale, and fast enough for a shop's few thousand pack sizes. A stored total could drift from the movements.
- **Filtering by level in SQL.** Rejected for now: the level depends on the batches, their dates and the orders' holds. Worked out in the service, the rules stay in one place, shared with each pack size's page.
- **The browser's date formatter for label dates.** Rejected: it moved dates by a day in other time zones, and its output differs between browsers.
- **A cached Stock page.** Rejected: staff act on these numbers, so they are read fresh. Each change reads them again.

## Consequences

- **Tests:**
  - **The API:** 971 unit tests in 99 suites, up from 920 in 97.
    - Breaking the new API code on purpose 74 ways, the tests caught all 74. Two were caught only after new tests covered them: a count that leaves exactly 0 free packs, and the overview using each pack size's own `lowStockAt`.
    - On a real PostgreSQL 17, in a container removed afterwards, 25 checks ran through the real services, each in a transaction rolled back. They covered what orders hold (shipped and cancelled orders hold nothing, a late payment's packs count once), the list's order, levels, filters, search and pages, counts with their `409`s and audit entries, an order's stock waiting for a count while the Stock page reads without waiting, and the low-stock number. They found that Prisma's `contains` doesn't escape `%` and `_`.
    - The smoke test still has 95 checks. Its checks that customers can't use the staff routes now cover the two new ones.
  - **The console:** 492 tests in 32 files, up from 374 in 26.
    - Breaking its new code on purpose, one way at a time:
      - 51 breaks to the data layer;
      - 35 to the Stock page;
      - 60 to a pack size's page and its dialogs;
      - 23 to the product page's stock line and the way back;
      - 3 to the count dialog's fix.
    - In the end the tests caught every one.
  - **In a real browser:** headless Chrome drove the built console under its full policy and headers, with a stand-in API that uses the API's own stock rules on the real date. 15 checks covered:
    - the Stock page's pages, filters by mouse and keys, search, and the way back;
    - receiving a delivery, with Chrome's date boxes typed digit by digit, in India's day-month-year order;
    - a write-off, a label correction, and Escape with the focus back on its button;
    - a count gone stale while it was typed;
    - a batch's history, a page at a time;
    - the product page's stock lines and a changed low-stock number;
    - no sideways scrolling at a phone's width.

    There was no policy violation and no error. An image from another address, added on purpose, was blocked and reported.
  - **By hand with the real API:** still to do before the merge. The checks are in the pull request.
- **The console's tests wait up to 3 seconds by default.** The first test of a file signs in and draws its page from cold while every other file runs too, and it sometimes needed more than the usual second.
- **Lessons:**
  - **`contains` is `LIKE`.** Prisma sends the words as a parameter, which stops SQL injection, but not `%` and `_` matching anything. A real database showed it.
  - **A stale number must change everywhere at once.** The alert named the new number while the box beside it still showed the old one. Only screenshots in a real browser showed it.
  - **A date box is laid out by the browser's language.** In Indian English, Chrome's box is day, month, year: typing month first gave the wrong date.
  - **A date shown through `Date` depends on the time zone.** Label dates are shown from their digits.
  - **A screen reader joins words around hidden text without a space** unless the space is outside it: "Countbatch AS2610".
- **Still open:**
  - glass and clay touches for the console, then a design system shared with the website and the apps, by the owner's choice on 2026-11-18;
  - orders and refunds, then Admins and the audit log;
  - the page for accepting an Admin invitation (ADR 0031).
