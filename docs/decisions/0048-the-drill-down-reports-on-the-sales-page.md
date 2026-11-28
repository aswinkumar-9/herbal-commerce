# 0048. The drill-down reports: tabs on the Sales page

- Status: Accepted and implemented (part 15E)
- Date: 2026-11-28

## Context

Part 15D gave Super Users a Sales page: any period beside the one before, a chart, top lists, filters by product, category and brand, and an Excel download (ADR 0047). The drill-down reports were to join it as tabs.

The owner's choices for part 15E, on 2026-11-27:
- **all four tabs:**
  - **Places and catalog:** choosing a state, a category, a brand or a payment method narrows the page to it, and the categories open to their subcategories;
  - **Customers:** accounts made beside first purchases, new and returning customers in each bar, who bought again, and the top customers by name and email. Their names and emails are shown **in the console only, never in a download**;
  - **Orders by status:** what waits to be packed or shipped, what was delivered, the cancellations by who cancelled, and the refunds by status, read from the live orders;
  - **Stock:** low stock, the stock beside the sales as days of cover, and the batches running out of shelf life;
- **all the chart changes:**
  - bars of days, weeks, months, quarters or years, to choose;
  - a line with the period before faint behind it;
  - a donut for a share of a few parts;
  - a calendar of days, darker for more sales;
  - no hours;
- **the tiles' changes in colour:** green when better and red when worse, so refunds going up are red. The arrow and the words stay;
- **the years are financial years,** April to March, named "FY 2026–27", with a "This financial year" period. Quarters are named by their months, such as "Jan–Mar 2026";
- **downloads of the new tabs** wait for part 15F, with PDF and CSV.

## Decision

### The sales report, wider: `GET /v1/staff/reports/sales`

- **Two more filters,** each optional:
  - `state`, one of India's 28 states and 8 union territories, as the addresses name them;
  - `method`, a payment method, or `NOT_RECORDED` for the payments made before part 15C.
- **A state or a method alone reads the orders' summaries,** so delivery is still counted. With a product, a category or a brand, the lines' summaries are read, and delivery is "Not split", as in part 15D (`keepsProducts`).
- **`unit`** chooses the bars: `day`, `week`, `month`, `quarter` or `year`, at most 366 of them. A year is a financial year, from 1 April. Without `unit`, the bars follow the period's length, as before.
- **Each bar has `previous`,** the same days of the period before, for the faint line.
- **`calendar`** has every day of a period of up to 366 days, and is `null` for a longer one.
- **The Excel download** takes the same filters. A narrowed file's name ends in `-narrowed`, its Summary names "State:" and "Payment method:", and the audit log says "narrowed to a state" or "to a payment method".

### Three new reports

Each is for Super Users only (`@SuperUserOnly()` on the whole controller, staff tokens only), takes the sales report's parameters with the same rules and errors, and is read in one snapshot (a `RepeatableRead` transaction). Reading is not audited. The API specification lists every field.

#### `GET /v1/staff/reports/customers`

- **Counted from the payments, refunds and accounts themselves,** in India's days, as the sales report counts its customers:
  - the customers who paid in the period, new ones (who paid for the first time ever) and returning ones;
  - `boughtAgain`, those who paid for more than one order in the period. A second payment for one order isn't another order;
  - `accountsMade`, the customers' accounts made in the period. They are never narrowed: an account has no products, state or way of paying.
- **The bars** count a customer once in each bar they paid in.
- **`topCustomers`:** the best 10, by their sales without GST, less refunds, as the summaries count them, up to `refreshedAt`, with each one's name, email and orders. None before the summaries are first made.

#### `GET /v1/staff/reports/orders`

- **Read live** from the orders, payments, refunds and the audit log, not the summaries, so the tab is never behind.
- **Waiting now,** whatever the period:
  - the orders waiting for payment, to pack, packed for the courier and on their way, each with when the oldest reached that step;
  - the refunds on their way back;
  - the failed refunds that no Super User has given back by hand yet.
- **The orders placed in the period,** on their day in India, by where each is now, beside those placed in the period before:
  - placed, paid for, at each step, delivered, not paid in time, and cancelled;
  - the cancelled split by who cancelled and when: the customer or a Super User, before or after paying;
  - a paid order's canceller is the reason of its refund. An unpaid one's is a Super User when the audit log has their `order.cancelled`, else the customer;
  - every order is at one step, so the steps add up to the orders placed.
- **The refunds asked for in the period,** by how each is now (with "given back by hand") and by why, each in a fixed order.
- **Narrowed** to the orders with a line the filter keeps, sent to the state, or paid that way. A way of paying keeps paid orders only.

#### `GET /v1/staff/reports/stock`

- **Read live from the batches as they are now.** The period gives only the rate of sale.
- **For each pack size:**
  - the packs that may be sold today, in batches with at least 6 months left (ADR 0024);
  - its level, out, low or fine, as on the Stock page;
  - the packs sold in the period, less those of cancelled orders given back, as the summaries count them;
  - `daysOfCover`: how many whole days the stock lasts at that rate, over the period's days up to today. It is `null` when nothing sold.
- **`shelfLife`:** the batches still holding packs that stop selling within 90 days, or already have, with the days left and the packs likely left over then.
  - The batch that expires first sells first, as orders take stock, so a later batch sells only what the earlier ones leave.
  - A batch that has stopped selling takes no sales.
- **The totals** count the pack sizes on sale: out, low, the packs that may be sold and what they fetch at today's prices. They also count the packs of any pack size that may no longer be sold.
- **Narrowed by product, category or brand,** as the catalog has them now. A state or a way of paying never narrows it: the shop keeps one store for every order.

### The Sales page's tabs

- **Five tabs,** each with its own address, keeping the period, the bars and the filters:
  - **Overview** (`/sales`): the tiles, the chart, and the calendar;
  - **Places and catalog** (`/sales/places`): the states, the payment methods, the categories with their subcategories, the top brands and the top products. They moved here from the overview;
  - **Customers** (`/sales/customers`);
  - **Orders by status** (`/sales/orders`);
  - **Stock against sales** (`/sales/stock`).
- **Every name on Places and catalog narrows the whole page.** Each is a button that shows when it is pressed, and pressing it again shows everything. A state and a payment method join the filter chips, as a product, a category and a brand did.
- **The overview's chart:**
  - "Bars": Days, Weeks, Months, Quarters or Years. A choice that would draw more than 366 bars is disabled, and the choice stays in the address;
  - "Shape": a line beside the period before, or columns;
  - for 14 days or more, a calendar of each day, in weeks from Monday.
- **The Customers tab:**
  - tiles for the customers, the new, the returning, those who bought more than once, and the accounts made;
  - a chart of all customers, the new, the returning or the accounts made;
  - the top customers, each name with the email under it.
- **The Orders tab:**
  - "Waiting now": tiles linking to the Orders and Refunds pages, already filtered, with failed refunds in red and with an icon;
  - "Placed in the period": tiles, a chart, and where the orders are now and who cancelled them, as a donut or as bars;
  - the refunds asked for, by status and by reason, as tables.
- **The Stock tab:**
  - tiles for what is out (in red when any), low, the packs that may be sold, what they are worth, and the packs too near expiry to sell (in red when any). Out and low link to the Stock page filtered;
  - "Days of cover", the shortest first, the best 10 then "Show all";
  - "Out of stock or low", the out first;
  - "Running out of shelf life", with the packs likely left over in red.

  On a phone, the tables hide their less important columns and show the same under each name.
- **The Orders and Stock tabs ask again every minute,** and say "Live: read …". The others follow the summaries, every 5 minutes.
- **Each tile's change** is green when better and red when worse, with its arrow and its words. A screen reader hears "for the better" or "for the worse".
- **Two more periods:** "This financial year" among the chips, and quarters and years named by their months.

### The charts

All are ours, in SVG with attributes only, so the console's security policy is unchanged (ADR 0047). Each has "Show as a table", and a keyboard way through it.

- **`LineChart`:** the period in the chart green, the period before in a faint line behind, a legend, and a line and readout under the pointer or the arrow keys.
- **`DonutChart`:** parts in a fixed order, 2 px gaps between them, the total in the middle, and a legend with each part's figure and share. Pointing at a part marks its row too.
  - It is used for 2 to 6 parts, none below 0.
  - Otherwise the same figures are bars.
- **`CalendarChart`:** weeks from Monday, darker for more, in four steps with their ranges in a legend. A day still to come is outlined.
- **`CountChart`,** the Customers and Orders tabs' shared card: a line of whole counts, with "Show" and "Bars".
- **The colours come from the design system** (`packages/design`, the console's look):
  - `series-1` to `series-7` for the parts of a donut, each part keeping its colour wherever it shows. They are the data-viz method's hues without red, which says "worse".
    - Every neighbour, the last beside the first too, passed the palette validator for colour-blind and normal vision, in both themes.
    - Three light ones are under 3:1 on a card, so a donut always lists each part's figure beside it.
  - `series-other` for "Not recorded";
  - `heat-1` to `heat-4`, one green from little to most, for the calendar;
  - `good` for a better change, and the existing `danger` for a worse one.

  The design system's tests check each colour's contrast, and that the calendar's steps grow darker in one hue.

### Personal data on the Customers tab

- **Names and emails show only to Super Users, on the page.** They are in no download, and part 15F's downloads must keep them out.
- **The answer is `no-store`,** as every signed-in answer is, and the console keeps it only in memory.
- **Reading isn't audited,** as with the rest of the Sales page (ADR 0047).

### Unchanged

- **The database:** no migration. The new reports read the tables that exist, the summaries included.
- **The summaries and their job** (ADR 0046), paying, refunds, the website and the console's security policy.

## The checks

- **API:**
  - 1294 tests in 124 suites, 40 tests and 3 suites of them new;
  - the type check and the lint pass;
  - the smoke test has 103 checks, 3 of them new: a customer's token can read none of the three new reports.
- **Console:** 975 tests in 70 files. Every build is checked for its security policy.
- **The design system:** 203 tests, which check the new colours in both themes. The donut's colours were checked with the palette validator against the cards, in light and dark.
- **On a throwaway PostgreSQL,** with the real services compiled and run against it:
  - **the sales report's new filters and bars: 30 checks.** A state, a payment method and each kind of bar, quarters and financial years too, added up to the totals;
  - **the customers report: 65 checks;**
  - **the orders report: 58 checks:**
    - each order at one step, with one canceller;
    - India's midnight at both ends of a period and of the period before;
    - who cancelled, before and after paying, the audit log's ID in capitals too;
    - what waits now, and the refunds by status and by reason;
    - every filter, and two together;
  - **the stock report: 19 checks:**
    - the packs sold, less those given back, a second payment never, at India's midnight;
    - the cover, the totals, and a rate over a month still running;
    - the batches within 90 days, the first to expire selling first;
    - the filters: a state and a payment method never narrow it.
- **In headless Chrome, under the console's full policy, without a violation: 261 checks:**
  - every tab, in light and dark, at desktop and phone width;
  - the bars, the line, the donut and the calendar, by pointer, keys and table;
  - narrowing from a name, and the chips;
  - no sideways scroll, and no labels running into each other.
- **Deliberate breaks, one change at a time: 322 of 324 caught.** The two left behave exactly as the code does, so no test could catch them: how a rate of exactly 10 a day is written, and an end to the orders' query that reads a few hours more, which the code never counts.
  - the sales report's filters and bars, 49;
  - the charts and their colours, 41;
  - the tabs and Places and catalog, 43;
  - the Customers tab, 26 in the API and 20 in the console;
  - the Orders tab, 25 in the API and 35 in the console;
  - the Stock tab, 26 in the API and 27 in the console;
  - the SQL of the orders report, 21, and of the stock report, 11, each against the real database.

  Those that slipped through at first each have a test now.
- **By hand, by the owner, on 2026-11-28, against the real API:**
  - the smoke test;
  - every tab: the bars to financial years, the line, the calendar, and narrowing from a name;
  - a payment in Razorpay's test mode, on the Orders tab within a minute and on the Customers tab;
  - a paid order cancelled by a Super User and an unpaid one by the customer, each with its canceller and its refund;
  - the Stock tab's links and filters;
  - a download narrowed to a state, without customer details, in the audit log;
  - dark mode and phone width, and an Admin kept out.

## Consequences

- **Super Users can follow a figure down** to a state, a way of paying, a category, a brand or a product, across every tab.
- **The orders and the stock are never behind.** They are read live every minute, so each look reads the order and batch tables, not the summaries. That is fine for one shop, and they can move to summaries if they grow slow.
- **Customers' names and emails are on a page.** They are personal data (`docs/security.md`), shown only to Super Users and never downloaded.
- **A state or a way of paying never narrows the stock,** and the tab says so.
- **The cover is an estimate** from the period's rate, as are the packs left over at the end of a batch's selling life. A short period gives a rough rate.
- **No new packages, and no migration.**
- **Downloads of the new tabs, PDF and CSV come in part 15F.** Profit and loss waits for costs (open decision 2).

## Alternatives considered

- **The orders and the stock from the summaries:** they would be up to 5 minutes behind, and the summaries keep no order's step and no batch. The owner chose live orders.
- **Orders counted by when each step happened,** such as delivered in the period: one order could count in several periods. Counting the orders placed in the period, at their step now, adds up.
- **The stock narrowed by state or way of paying:** there is one store, so it would invent figures.
- **A warning 30 days before a batch stops selling,** as the Stock page's "Expiring soon" (ADR 0034): too late to plan a sale or a return. 90 days gives time.
- **A pie instead of a donut:** a donut has the total in the middle, and the same parts.
- **A charting package:** the owner chose our own charts in part 15D.
- **Hours in the bars:** the owner chose none.
- **Calendar years:** the owner chose financial years, as the books keep them.
