# 0047. The sales dashboard: the Sales page, its filters, and the Excel sales report

- Status: Accepted and implemented (part 15D)
- Date: 2026-11-25
- Updated: 2026-11-28 (part 15E: the Sales page has tabs, the top lists moved to "Places and catalog", the report and its download are narrowed by state and payment method too, and the bars are chosen from days to financial years, see ADR 0048)

## Context

Part 15C keeps the data the reports are made from: each sale's groupings, how it was paid, and daily sales summaries in India's time, rebuilt every 5 minutes (ADR 0046). Nothing read them yet.

The owner's choices for the dashboard, on 2026-11-25:
- **a menu item of its own,** "Sales" at `/sales`, for Super Users only. The Overview stays the welcome page, and the drill-down reports of part 15E join the Sales page as tabs;
- **the headline is Sales:** what the products sold for without GST, paid less refunds. GST, delivery and what customers paid in all are shown beside it;
- **what it shows:**
  - the period's totals beside the period before: sales, orders, the average order and refunds;
  - new and returning customers, counted from the orders and payments themselves, not the summaries;
  - sales over time, by day, or by week or month for a long period;
  - top lists: products, categories with their subcategories, brands, states and payment methods;
- **the periods:** today, yesterday, the last 7 days, the last 30 days, this month, last month, this year, or any days chosen. Each is compared with the same number of days just before.

The owner tried that page by hand and passed it on 2026-11-25, then added to the same part:
- **filters:** by product, by category (a subcategory too) and by brand. With one, every figure, chart and list shows only those products' sales. Delivery isn't split by product;
- **an Excel download** of the report as shown, "as companies do": a summary and a register of every line sold or refunded, with no customer details;
- **for now, no GST invoice numbers and no CGST, SGST or IGST split.** They come once the company is registered;
- **`exceljs`** to write the file, rather than our own writer.

After the first download, the owner found the file "very limited": no filters, no charts, and little by product and category. The owner then chose `jszip`, so the file can have Excel's own charts.

## Decision

### The report: `GET /v1/staff/reports/sales`

- **For Super Users only** (`@SuperUserOnly()`, staff tokens only), so Admins never see the shop's takings. Reading the report is not audited.
- **Any period of up to 3660 days,** from `from` to `to`, in India's days, compared with the same number of days just before (`src/reports/sales-periods.ts`).
- **The figures** (`docs/api-specification.md`, "Reports"):
  - sales without GST, less refunds;
  - GST, delivery, and paid in all;
  - orders, the average order, and the refunded orders and their rupees;
  - new customers, who paid for the first time ever in the period, and returning ones, who had paid before.
- **The series:** every day, week or month of the period, those with nothing too. It uses days for up to 62 days, weeks from Monday for up to 182, and months beyond. The first bar starts with the period.
- **The lists:**
  - the best 10 products and brands;
  - every category with its subcategories, every state and every payment method;
  - the best come first, equal ones go by name, and those without a name go last;
  - a product is named as it last sold, so a renamed product shows its newest name.
- **Read from the daily summaries,** with Prisma's `groupBy`, apart from the customers. Those are counted from the payments in one query, as the summaries keep no customer.
- **Everything is read in one snapshot** (a `RepeatableRead` transaction), so the totals, the series and the lists always agree. `refreshedAt` says when the summaries were last rebuilt.

### The filters

- **`productId`, `categoryId` and `brandId`,** each optional and a UUID, and they combine.
  - A top category includes its subcategories.
  - The answer names each filter as the catalog names it now, or else as it last sold.
- **With a filter, every figure counts only the order lines of the products it keeps:**
  - sales, GST and refunds are those lines';
  - paid is their sales and GST together;
  - delivery is `null`, "Not split", because it is charged on a whole order;
  - orders and customers are those with such a line.

  They are counted from the payments, but only up to `refreshedAt`, so they agree with the summaries the rupees come from.
- **In the console,** one search box finds products, categories and brands by name. Each match is a button, and a chip shows each filter in use. "Show all sales" removes them all. The filters and the period stay in the page's address, each kept when the other changes.

### The Sales page

- **"Sales" in the menu,** after Orders, for Super Users only, behind the route guard.
- **The period chips,** "Last 30 days" first, and "Choose days" for any range, checked as the API checks it.
- **Tiles:**
  - Sales, with GST, delivery and paid in all beside it;
  - new and returning customers, orders, the average order and refunds;
  - each beside the period before, with an icon and words for the change, never colour alone.

  A line says when the figures were updated: "New payments show within 5 minutes". The page asks again every 5 minutes, and moves on at India's midnight.
- **The chart,** "Sales each day", "each week" or "each month".
  - Under the pointer or the arrow keys, a line and a readout show one bar.
  - "Show as a table" shows the same figures as a table.
- **The lists,** the best 10 first, then "Show all".
- **Loading** shows skeletons of the real layout, and the old figures stay dimmed while new ones load. A period with no sales shows one quiet note instead of the empty charts.

### The charts: our own, in SVG

- **`ColumnChart` and `BarList`,** in `apps/admin/src/charts`, by the owner's choice of 2026-11-23: no charting package.
  - They are drawn with SVG attributes only, so the console's policy and Trusted Types stay unchanged.
  - The bars are thin, with rounded ends at the value, and a zero line for the values below 0.
  - The rupee ticks are clean steps, shortened in India's way (K, L, Cr) from ₹10,000.
- **The chart green comes from the design system** (`packages/design`, the console's look):
  - `series` is `#1f7a55` in light and `#3fa874` in dark, and `series-hover` is lighter, `#2a8c63` and `#5cbd8a`;
  - each is checked by the design system's tests for its lightness band and its chroma (`CHART_COLOUR`), and for 3:1 against the cards in both themes;
  - the main green, `#2e6a44`, reads nearly grey in a chart, so it is not used for one.

### The Excel sales report: `GET /v1/staff/reports/sales/export`

- **The same parameters and rules as the report,** for Super Users only. It sends `Cache-Control: no-store` and names the file, for example `herbal-commerce-sales-2026-11-01-to-2026-11-25.xlsx`, with `-narrowed` added when a filter is in use.
- **Made on the API** (`sales-workbook.ts`, with `exceljs` 4.4.0), from one snapshot, as the report is:
  - every day of the period;
  - every grouping in full, in the period and in the one before (`sales-detail.ts`);
  - the register of each line sold or refunded, up to `refreshedAt`, so it adds up to the totals exactly.
- **Its sheets:**
  - **Dashboard,** first: eight tiles, each with the figure before and the change, and seven charts;
  - **Summary;**
  - **Sales by day,** with each day's weekday;
  - **Products, Pack sizes, Categories, Subcategories and Brands:** packs, gross, refunds, net sales, GST, the share, the period before and the change;
  - **States and Payment methods;**
  - **Sales register.**

  The API specification lists every column.
- **Every table works as a company's sheet does:**
  - the header row has Excel's filter and sort buttons, stays in view, and is printed on each page;
  - under the table, past a blank row so a filter never hides it, a Total row adds up only the rows shown (`SUBTOTAL(109, …)`);
  - Excel works the formulas out again on opening, and each cell also holds its result for viewers that don't.
- **The charts are Excel's own,** so they can be read, resized and filtered in Excel.
  - **Built by us:** `exceljs` can't write charts, so `sales-charts.ts` writes them as Office's chart XML, and `jszip` 3.10.2 adds them to the finished file. That is the version `exceljs` already uses.
  - **Each chart reads its sheet's cells:**
    - net sales by day, as columns;
    - as ranked bars, the top 10 products, the categories, the top 10 brands, the top 10 states, the payment methods and the top 10 pack sizes.
  - **They follow the sheet's filter,** as each plots only the rows it shows.
  - **They are the console's chart green,** with values on the bars.
  - **A chart with nothing to show** is replaced by a line of text.
- **Nothing in it can run:**
  - text that a spreadsheet could take for a formula starts with an apostrophe (`safeText`);
  - every text in the chart XML is escaped;
  - the only formulas are the totals the API writes itself.
- **No customer details:** no names, emails, phones or addresses, and no Razorpay IDs.
- **At most 100,000 register lines.** A longer period answers `400`, saying to download a shorter one.
- **Each download is written to the audit log** as `report.sales_exported`, with the period, any filter and the number of register lines, before the file is sent.
  - The audit log has a new kind for it, "Reports downloaded", told as "… downloaded the sales report of 1–25 Nov 2026, narrowed to a category and a brand".
  - A download can be passed on, so who took a copy, of what, is kept.
- **In the console,** "Download as Excel" asks for the file of the period and filters shown (`apiDownload`).
  - The answer must be that type, and the file name must use letters, digits, dots and dashes only.
  - The browser saves the file from a link to it in memory.
  - A toast names the saved file, and a failure is said in the page.

### Unchanged

- **The daily summaries and their job** (ADR 0046), paying, refunds and the website.
- **The database:** no migration.
- **The console's security policy:** the charts are SVG, and the file is saved from memory.

## The checks

- **API:**
  - 1254 tests in 121 suites, 74 tests and 8 suites of them new;
  - the type check and the lint pass;
  - the smoke test has 100 checks, 2 of them new: a customer's token can neither read nor download the sales report.
- **Console:** 882 tests in 64 files. Every build is checked for its security policy.
- **The design system:** 171 tests, which check the chart green in both themes. The palette was also checked with a colour-blindness validator, against the cards in light and dark.
- **On a throwaway PostgreSQL,** with sales and refunds seeded on either side of India's midnight, in two periods. The real services were compiled and run against it.
  - **The report: 13 checks,** with the database's own time zone set to India too.
  - **The filters: 19 checks.** Each filter and their combination gave only its products, and orders and customers agreed with the rupees.
  - **The register: 7 checks.** It added up exactly to the report's totals, filtered too.
  - **The workbook: 24 checks:**
    - every grouping added up to the totals, now, before and narrowed;
    - the workbook's totals agreed with the report;
    - each file had its seven charts.
- **The file itself:**
  - every part is well-formed XML;
  - every part has its type, and every link between parts leads somewhere;
  - each chart's elements are in the order Office's schema sets.

  No copy of Excel was at hand while building, so the owner's test was the first to open the charts in Excel.
- **In headless Chrome, under the console's full policy, without a violation:**
  - the page in light and dark, at desktop and phone width;
  - days, weeks, months and a quiet period;
  - the pointer, the keys, the table and "Show all";
  - the filters by typing, Tab and Enter;
  - the download, saved as a real `.xlsx` with its name.
- **Deliberate breaks: 320 of 320 caught,** one change at a time:
  - the report, 44;
  - the charts and their colours, 35;
  - the page, 44;
  - the chart and lists on the page, 27;
  - the filters, 26 in the API and 30 in the console;
  - the download, 39 in the API and 17 in the console;
  - the full workbook, 58.

  Those that slipped through at first each have a test now.
- **By hand, by the owner, on 2026-11-25:**
  - **the page:** the periods, the totals, the customers, the chart and the lists;
  - **then the rest:**
    - a payment in Razorpay's test mode, on the page within 5 minutes;
    - the filters by product, by a category with subcategories, and by a brand with it;
    - both downloads, opened in Excel: the dashboard's tiles and charts, the Total rows and charts following a sheet's filter, and the payment in the register with its delivery line;
    - both downloads in the audit log.

## Consequences

- **Super Users see the takings of any period, compared with the one before,** narrowed to a product, a category or a brand, at most about 5 minutes behind. Admins see none of it.
- **The Excel file can be passed on,** so it holds no customer, and each copy is in the audit log.
- **Two new packages in the API,** pinned: `exceljs` 4.4.0 and `jszip` 3.10.2.
  - `pnpm audit --prod` reports `uuid` below 11.1.1 through `exceljs`: its bounds check in v3, v5 and v6 with a buffer.
  - `exceljs` calls only `v4()`, so it isn't reachable (`docs/security.md`, section 5).
- **The chart XML is ours.** If a later `exceljs` writes drawings itself, `withCharts` refuses the file ("has a drawing already") and the tests fail, rather than sending a broken one.
- **The workbook is made in memory,** with at most 100,000 register lines. A longer period has to be downloaded in parts.
- **Delivery is never split by product:** a narrowed report shows "Not split".
- **CSV and PDF are still to come,** and so are the drill-down reports (part 15E). GST invoice numbers and the CGST, SGST and IGST split wait for the company's registration.
- **The charts on the page and in the file** use the same green, from the design system.

## Alternatives considered

- **The dashboard on the Overview page:** the owner chose a menu item of its own, with room for the reports as tabs.
- **A charting package** (Recharts, Chart.js): one more dependency to keep up to date, and to check against the console's policy in both themes. The owner chose our own SVG charts.
- **Delivery split across a filter's products by their share:** a made-up figure. The owner chose "Not split".
- **Our own `.xlsx` writer:** less to install, but more to get right. The owner chose `exceljs`.
- **Charts as pictures in the file:** they wouldn't follow a filter or be Excel's own. The owner chose `jszip` to add real charts.
- **Pivot tables:** harder to read for most people, and not every viewer shows them. Plain tables with filters and `SUBTOTAL` totals do the same work here.
- **Totals with `SUM`:** they would count the rows a filter hides.
- **Making the file in the browser:** it would bring a package into the console and the rules into two places, and the audit log would rest on the browser's word.
- **CSV first:** one table per file, with no totals or charts. Excel came first, by the owner's choice.
