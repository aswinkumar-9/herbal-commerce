# 0024. Inventory: stock in batches

- Status: Accepted and implemented (part 5)
- Date: 2026-11-06
- Updated: 2026-11-06 (part 6: the cart asks the inventory which pack sizes are in stock, and holds no stock, see ADR 0025)
- Updated: 2026-11-08 (part 7: orders take stock from the batch that expires first and give it back, and deleting a written-off product stays allowed, by the owner's choice, see ADR 0026)

## Context

Parts 4A to 4D built the catalog (ADR 0020 to ADR 0023). Part 5 adds stock: how many packs of each size are on the shelf, and which of them may be sold.

The MVP scope (`docs/requirements.md`, section 6) lists inventory, and a product's batch and expiry. The permission matrix (section 4) says Admins adjust stock and see its movements, and Super Users may do everything. A pack's label carries its batch number, its manufacturing date and its expiry date. Which of these the shop must show is part of the legal review (section 8).

The owner made four choices on 2026-11-06:
- **One warehouse.** This answers the first half of open decision 3.
- **Stock per batch,** each with its batch number, manufacturing date and expiry date.
- **A batch is sold only while it has at least 6 months left** before it expires.
- **Customers see only "in stock" or "out of stock",** never a count.

Holding stock for a customer's cart and order (reservations) comes with orders.

## Decision

### A ledger and its balance

Two tables:
- **`stock_batches`:** one batch of a pack size, with what its label says:
  - `batchNumber`, unique within its pack size;
  - `manufacturedOn` and `expiresOn`, stored as dates;
  - `quantity`: the packs on hand now.
- **`stock_movements`:** every change to a batch's stock:
  - `change`: more (positive) or less (negative);
  - `reason`, one of:
    - `RECEIVED`: a delivery;
    - `DAMAGED`: broken, spoiled or lost;
    - `EXPIRED`: written off near or past its expiry;
    - `CORRECTION`: a count found a difference;
    - since part 7, `ORDERED`: taken by an order, and `RELEASED`: given back by a cancelled or expired order. Only orders make them, and each names its order in `orderId` (ADR 0026);
  - `note`;
  - `actorId`, without a foreign key, like the audit log, so the history outlives the account;
  - `createdAt`.

**The database keeps the two in step.** The migration's triggers and checks are the last line of defence:
- **every movement is applied to its batch at once,** in the same transaction (`stock_movements_apply`);
- **a batch's quantity changes only that way.** A new batch starts at 0, and a direct update of the quantity is refused (`stock_batches_quantity_from_movements`). `pg_trigger_depth()` tells the two apart: the movement trigger's update runs one level deeper than a statement does;
- **the quantity never goes below 0** (`stock_batches_details_chk`). The update locks the batch's row, so two movements at the same moment take turns, and the second is refused if there isn't enough left;
- **a movement is final:** it is never changed, and never deleted on its own (`stock_movements_are_final`). A mistake is put right by another movement;
- **a batch that still holds stock is never deleted,** not even with its pack size or its product (`stock_batches_keep_stock`);
- **a movement's sign fits its reason:** a delivery only adds, a write-off only removes, and a correction may go either way (`stock_movements_change_chk`). A batch expires after it was made, and has a batch number.

All of this was tested in 15 cases, on temporary tables inside a transaction that was rolled back, before the migration was applied.

### Dates

- **Dates are written as on the label,** such as `2028-09-30`, in requests and answers. Impossible dates, such as 29 February 2026, are refused.
- **"Today" is India's date,** even on a server in UTC: India's midnight comes five and a half hours before UTC's.
- **A batch received** may not be made in the future, and may not have expired already.
- **A correction of a batch's dates** is checked on the batch as it will be: it must still expire after it was made.

### Sellable: at least 6 months left

- **A batch may be sold while it expires on or after today plus 6 months.** On 6 November 2026, that means from 6 May 2027. A month without that day uses its last day: 31 August plus 6 months is the end of February. The rule is `MIN_SHELF_LIFE_MONTHS` in `inventory/stock-rules.ts`.
- **A batch that's too short-dated** may still be received and kept. Staff see it as not sellable, and can write it off.
- **Orders take the sellable batch that expires first** (since part 7, ADR 0026). The batch list comes in that order.

### Changing stock

| Endpoint | What it does |
|---|---|
| `GET /v1/staff/variants/:variantId/batches` | A pack size's batches, the first to expire first. Each shows its dates and whether it sells today. Also the pack size's packs on hand, and how many may be sold. |
| `POST /v1/staff/variants/:variantId/batches` | Receives a delivery. One transaction creates the batch, its `RECEIVED` movement and its audit entry. |
| `PATCH /v1/staff/batches/:id` | Corrects a batch's label details: its number or its dates. Its stock never changes here. |
| `POST /v1/staff/batches/:id/movements` | Changes a batch's stock: more received, a write-off, or a correction |
| `GET /v1/staff/batches/:id/movements` | A batch's history, newest first, one page at a time |

- **A movement locks its batch first,** so the API sees the real quantity. Taking more than a batch holds answers `409 Not enough stock: this batch holds 118.` The database would refuse it anyway, but the API's check gives the clear answer.
- **More of an expired batch cannot be received** (`400`). An expired batch can still be written off.
- **A correction needs a note** saying why the count differs. That is the change most worth explaining later.
- **Nothing in stock is deleted through the API.** A mistake is put right with a correction.

### Deleting what still holds stock

A pack size, or a product, that still holds stock is never deleted: the goods are on the shelf. The database's trigger refuses, and Prisma reports that refusal as `P2003`, the same code as a foreign key. The API turns it into `409`:
- `This pack size still has stock. Write it off first, then delete it.`
- `This product still has stock. Write it off first, then delete it.`

As for a category with products (ADR 0021), the API doesn't count first, so nothing can slip in between a count and the deletion. **Orders will add foreign keys that also answer `P2003`,** and these two mappings must be revisited then. Written off to 0, a pack size or product can be deleted, and its batches and movements go with it. The audit log keeps their story.

**Revisited in part 7:** orders added no foreign key that a deleted pack size or product could hit. An order's line keeps the pack size's ID without one, and an order's movements point to the order, so the two mappings stay right. Deleting also deletes the movements that say which batch went into which order. The owner chose to keep deleting allowed; the orders keep their own copy of the names and prices (ADR 0026).

### The shop

- **A product's page shows `inStock` for each pack size:** `true` while a sellable batch holds stock. It never shows a count.
- **The catalog asks the inventory** through `StockService.inStock()` (`src/inventory`), instead of reading its tables (ADR 0001). Since part 6, the cart asks it the same way (ADR 0025).
- **The category page is unchanged:** its from-price still covers every pack on sale.

### Who may do what

| | Visitor or customer | Admin | Super User |
|---|---|---|---|
| See whether a pack is in stock | Yes | Yes | Yes |
| See batches, counts and movements | No | Yes | Yes |
| Receive a batch, correct it, change its stock | No | Yes | Yes |
| Delete a batch or a movement | No | No | No |

The staff controller is `@StaffOnly()` as a whole, and `staff/staff-routes.spec.ts` lists it.

### Audit

Every change is in the audit log, in the same transaction:
- `batch.received`, with the pack size, the label details, the quantity and the note;
- `batch.updated`, with only the label details that changed, before and after;
- `stock.changed`, with the quantity before and after, the change, the reason and the note.

The target is the batch, so `?targetId=<a batch's ID>` gives a batch's whole story. A refused change writes nothing.

## Alternatives considered

- **One count per pack size.** Rejected by the owner: expired stock and recalls need batches.
- **Several warehouses.** Not now, by the owner's choice. A warehouse can become a column of the batch later.
- **At least 3 months of shelf life,** as recommended. The owner chose 6: customers always get fresh stock, and more stock goes unsold near the end.
- **Showing counts, or "only a few left".** Rejected by the owner: a count lets anyone watch the shop's sales.
- **Working out the quantity as a sum of the movements on every read.** Rejected: every shop page would add up the history, and "never below 0" would need a lock around every check. A balance with a check constraint settles a race in one statement.
- **Checking the stock rules in the API only.** Rejected, as in ADR 0021: a bug or a manual SQL change could break them.
- **Deleting a batch, or editing a movement.** Rejected: the ledger must stay complete. A correction puts a mistake right and says why.
- **Dates with times, or UTC dates.** Rejected: labels carry dates, and a shop in India counts days in India.
- **The catalog reading the stock tables itself.** Rejected (ADR 0001): modules ask each other, so stock could move to its own service later.

## Consequences

- **Tests:**
  - 539 unit tests in 69 suites.
  - The smoke test has 72 checks. The new ones:
    - each pack on a product page shows whether it is in stock;
    - a customer's token cannot see or change stock.
  - **By hand, on 2026-11-06:**
    - an Admin made a live product with two pack sizes, both out of stock;
    - a delivery of 120 put one pack size in stock;
    - a delivery of 30 that expires in March 2027 left the other out of stock (`30 on hand, 0 sellable`);
    - the Admin was refused:
      - a batch made in the future;
      - an expired batch;
      - a batch number already used;
      - a date written as `01-10-2026`;
      - a correction without a note;
      - a write-off of 500 from a batch that held 118;
    - the Admin corrected a batch's expiry, and saw its history;
    - the smoke test ran while stock was in the shop;
    - a Super User was refused deleting the pack size and the product, wrote both batches off, then deleted them.

    The audit log held every step, in order.
- **Lessons:**
  - **Read the library before trusting a guess.** Prisma's own code shows that a trigger's `restrict_violation` becomes `P2003`.
  - **Part 4D's lesson held.** The migration's SQL test was written as a file that stops unless its transaction has begun, and it ran cleanly the first time.
- **Still open:**
  - returns, as a new reason. Orders take stock from the batch that expires first and give it back since part 7 (ADR 0026), and a cart holds none, by the owner's choice (ADR 0025);
  - a list of batches near their expiry, and low-stock alerts;
  - recalls by batch number;
  - who packs (the second half of open decision 3);
  - whether the product page must show a batch's expiry (legal review).
