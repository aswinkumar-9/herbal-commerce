# 0046. The data the reports are made from: each sale's groupings, how it was paid, and daily summaries

- Status: Accepted and implemented (part 15C)
- Date: 2026-11-25

## Context

Part 15 brings analytics and reports for Super Users (`docs/requirements.md`, section 10.1). The owner's rules, from 2026-11-23:
- sales are what was paid, less refunds;
- a payment counts on the day in India it was paid, and a refund comes off on the day it was made;
- GST and delivery are shown on their own lines, and orders never paid don't count;
- sales are grouped by category and subcategory, brand, and place, first the whole country, then the state;
- a product shown in more than one category counts once, under its main one (ADR 0044).

Part 15A gave the catalog its groupings, but a sale didn't keep them:
- an order line kept the product's name and SKU, not the product, its category or its brand;
- a payment didn't keep how it was paid;
- every report would have read the live order tables and applied the rules again.

The owner's choices, on 2026-11-24:
- **all three migrations:** what each order line is reported under, the payment method, and daily summaries in India's time;
- **the orders placed before:** they take their groupings from the catalog as it is now. Payments made before keep no method, shown as "Not recorded";
- **Razorpay's fee:** later, with profit and loss;
- **how fresh:** within 5 minutes. A job rebuilds today's and yesterday's summaries every 5 minutes, the payment code stays as it is, and the dashboard will say when the numbers were last updated.

## Decision

### Each order line keeps what its sale is reported under

- **Seven new columns on `order_items`:**
  - the product, by ID;
  - the top category and the subcategory of its main category, each by ID and by name;
  - the brand, by ID and by name.
- **They are taken when the order is placed,** from the same read of the catalog as the prices (`ShopPacksService`'s `reportGroups`):
  - a product whose main category is a subcategory is reported under its top category and that subcategory;
  - one whose main category is a top category has no subcategory;
  - one without a brand has none, which reports will call "No brand".
- **IDs without foreign keys,** like the pack size's ID already: the order outlives the catalog. The names are kept as they were, so a sale stays under the category it had when it was made, even if the product moves later.
- **The database checks** that each ID comes with its name, a subcategory only with a top category, and every new line with its product and top category. The last check is `NOT VALID`, so it holds for new lines only: an old line whose pack size was deleted has none.
- **Lines placed before part 15C** took their groupings from the catalog on 2026-11-24, inside the migration, with the guard that keeps lines final switched off for that statement only. A line whose pack size had been deleted stays without them.
- **Customers never see them.** The quote and the order's answers are unchanged.

### Each payment keeps how it was paid

- **`payments.method`,** the enum `PaymentMethod`: `UPI`, `CARD`, `NETBANKING`, `WALLET`, `EMI` (card EMI and cardless EMI), `PAY_LATER` and `OTHER` (any other way Razorpay takes, such as a bank transfer).
- **It comes from Razorpay's own record of the payment,** which settling a payment already fetches, never from the customer's browser (`paymentMethodOf` in `src/payments/payment-method.ts`).
- **It is saved with the payment,** in the same update as the Razorpay payment's ID and the time it was paid (`markPaid`).
- **The database checks** that:
  - only a paid payment has a method;
  - a payment paid from now on has one;
  - a paid payment's method never changes, and none is added later to one paid before.

  These rules go into the trigger that already kept a paid payment paid.
- **Payments made before part 15C have none:** "Not recorded".
- **Razorpay's fee is not kept yet.** It comes with profit and loss, and Razorpay gives it for each payment by its ID.

### Daily sales summaries

- **`daily_line_sales`:** each day's order lines, grouped by:
  - the state the order went to;
  - how it was paid, or no method recorded;
  - the product and its name, and the top category, subcategory and brand, each with its name, as the line keeps them.

  For each group, the packs, the rupees (the lines' totals, GST included, as the orders show them) and the GST inside, sold and refunded.
- **`daily_order_sales`:** each day's orders, by state and payment method, because the delivery charge belongs to an order, not to its lines. For each, the orders, the items' rupees, their GST and the delivery charge, sold and refunded.
- **`sales_summary_refreshes`:** one row, saying when the summaries were last rebuilt, for the dashboard.
- **The rules are in one database function,** `rebuild_sales_summaries(first_day, last_day)`, which rebuilds the days from the first to the last, both included. With no first day, it rebuilds every day up to the last.
  - **A payment counts on the day in India it was paid.** An unpaid one has no such day.
  - **A refund comes off on the day in India it was made,** and only when it gives back the payment that paid the order: refunds are matched to payments by Razorpay's payment ID. The others give back payments that never counted: a second payment, or one for an order cancelled or expired before it was paid.
  - **Refunds are always in full** (ADR 0028), so a refunded order takes off all its lines, its GST and its delivery charge.
  - **A refund Razorpay refused still counts,** as staff give the money back by hand (ADR 0038).
  - **India is always UTC+5:30, and the database keeps UTC.** The function adds 5 hours 30 minutes itself, so the session's time zone changes nothing.
  - **Both tables are rebuilt in one statement,** so they are made from the same moment.
  - **One rebuild runs at a time,** across every API instance, behind a lock in the database (`pg_advisory_xact_lock`). A second waits, then replaces the first's rows.
- **The job** (`SalesSummariesScheduler`, `src/reports`):
  - it runs a minute after the API starts, then every 5 minutes;
  - it rebuilds from the day before the last rebuild's day through today: yesterday and today, as a rule. Just after midnight, or after the API was down for days, that goes back far enough that a payment saved while a rebuild was starting is never missed;
  - the first time, with no rebuild yet, it fills every day;
  - it logs only that first fill and failures. A failed run is simply tried again five minutes later.
- **A past day never changes once it is over:** payments, refunds, orders and their lines keep what was agreed. That is why rebuilding the last days keeps every day right.
- **New indexes** on `payments.paidAt` and `refunds.createdAt`, for finding a few days' payments and refunds.
- **No personal data in the summaries:** no customer, no address but the state, and no Razorpay IDs.
- **No endpoint yet.** The dashboard (part 15D) reads the summaries and says when they were rebuilt.

### Unchanged

- **Paying, refunds, and the customers' and staff's screens.**
- **The API specification and the smoke test:** no endpoint changed.
- **The security policies** of the console and the website.

## The checks

- **API:**
  - 1180 tests in 113 suites, 14 of them new;
  - the type check and the lint pass.
- **On a throwaway PostgreSQL,** after each step, the schema matched the migrations exactly.
  - **Each line's groupings:**
    - the old lines were filled: one in a subcategory with a brand, one in a top category without, and one whose pack size was gone;
    - a new line without its product and category was refused, and so was a name without its ID;
    - a complete line was taken, and lines still can't be changed.
  - **The payment method:**
    - a payment paid before kept none;
    - paying without a method was refused, and so was a method on an unpaid payment;
    - paying with one was taken;
    - changing it, taking it away, or adding one to the payment paid before were refused;
    - the old rules still held.
  - **The summaries, 12 checks,** run in a session set to India's time:
    - payments at 23:59:59.999 and at midnight in India landed on their own days;
    - a refund at 00:30 in India, still the day before in UTC, came off on India's day;
    - a second payment's refund and an expired order's refund changed nothing, and a refused refund came off;
    - a payment without a method, and a line without its groupings, were kept as such;
    - rebuilding twice counted nothing twice, and a rebuild touched only the days asked;
    - the lines added up to their orders.
  - **Two rebuilds at once:** the second waited 2.3 seconds and replaced the first's rows. With the lock taken out, the same test doubled every row.
  - **The job's service, compiled and run through Prisma** against that database, filled every day the first time, rebuilt only the recent days the second, and read the rows back through the Prisma models.
- **Deliberate breaks: 62 of 62 caught,** one change at a time:
  - each line's groupings, 12;
  - the payment method, 12;
  - the job, 16;
  - the summaries' SQL, 22, each applied to the live function.
- **By hand, by the owner:**
  - **after step 2,** with a payment in Razorpay's test mode. The first try failed, because the running API kept the old Prisma model after `prisma generate`. A restart fixed it (README, "Troubleshooting");
  - **on 2026-11-25, the test of part 15C:**
    - a payment by UPI, whose order lines named their category, subcategory and brand, and whose payment said UPI;
    - the day's summary showed it within 5 minutes;
    - a Super User cancelled the order in the console, and the refund came off the same day, with the sale left on its day;
    - an order cancelled before it was paid, whose payment went back, changed nothing;
    - no rebuild failed.

## Consequences

- **Every sale can be reported** by category, subcategory, brand, state and payment method, as it was when it was made. The orders placed before part 15C, all test orders, are reported under the catalog of 2026-11-24.
- **The reports are at most about 5 minutes behind,** and say when they were rebuilt. Paying is never slowed or put at risk by them.
- **Changing a rule** means a migration that replaces the function and rebuilds every day: deleting the row in `sales_summary_refreshes` makes the next run fill every day again.
- **A product renamed later** has two names in the summaries, one before and one after. Reports group by its ID and can show its latest name.
- **The summaries grow by a few rows a day** for each state, payment method and product sold. Rebuilding two days stays small however long the shop runs.
- **Payments made before part 15C** stay "Not recorded" for good.
- **Razorpay's fee** still has to be fetched and kept before profit and loss can be shown.

## Alternatives considered

- **Reports reading the live order tables:** each report would repeat the rules, and grow slower with the orders.
- **Updating the summaries in the transaction that settles a payment or a refund:** always up to date, but it changes the payment code, and a bug there could stop customers paying. The owner chose the job.
- **The rules in TypeScript,** writing the summaries row by row: the rules would be split between the code and the queries. In one function they are tested directly on PostgreSQL, and both tables come from one moment.
- **A materialized view:** refreshing it rebuilds every day each time, however old.
- **Leaving the old orders without groupings:** they would show as "Not recorded". The owner chose the catalog as it is now.
- **Keeping Razorpay's fee now:** not needed until profit and loss.
- **Summaries by customer or by pack size:** not among the groupings chosen. The figures about customers can come from the orders themselves.
