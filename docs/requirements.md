# Requirements — Herbal E-Commerce Platform

Status: **Draft v0.1** (to be reviewed and approved before module work starts)

## 1. Purpose

An independent e-commerce platform for our own herbal products. Customers browse, order, pay and track deliveries on a mobile app and a website. Staff run the business from an admin console. One backend serves all clients.

## 2. Scope decisions made so far

| # | Decision | Source |
|---|----------|--------|
| D1 | No dealer or sub-dealer concept. Stock is centrally owned, with one price list. | Owner |
| D2 | Three roles only: **Customer**, **Admin**, **Super User**. | Owner |
| D3 | Only customers can create accounts from the application. | Owner |
| D4 | Admin accounts are created only by a Super User. | Owner |
| D5 | Super User accounts: maximum **3**, developers only, created by developers during development (not through the application). | Owner |
| D6 | Modular monolith backend; no Kubernetes or microservices until measured need. | Brief |
| D7 | Local development first (Windows 11 laptop, Docker for services). Jenkins CI/CD added in a later phase. | Brief |

## 3. Roles

- **Customer**: buys products and manages their own data.
- **Admin**: day-to-day catalog and order operations. Cannot see or manage invoices or payments.
- **Super User**: full control, including invoices, payments, admin accounts and system settings.

## 4. Permission matrix (proposed, needs owner confirmation)

| Area | Customer | Admin | Super User |
|------|----------|-------|------------|
| Own profile, addresses, cart, wishlist | Own only | n/a | n/a |
| Products and categories | View | Create, edit, activate/deactivate | Full, including delete |
| Prices and offers | View | Set and change | Full, approve large changes |
| Inventory and stock | n/a | Adjust, view movements | Full |
| Orders | Own only. Since part 9, cancel until shipped (owner, 2026-11-09) | View, confirm, pack, ship, cancel (before payment capture). Built in part 9: view, pack, ship and mark delivered. Cancelling went to Super Users only (owner, 2026-11-09). | Full. Since part 9, cancel until shipped, with the payment back in full |
| Delivery and shipments | Track own: since part 9, the steps, courier and tracking number | Manage: since part 9, the courier and tracking number typed in by staff (owner, 2026-11-09) | Full |
| Returns | Request | Review and approve/reject | Full |
| Refunds (money movement) | Request via return. Since part 9, cancelling a paid order before it ships gives the payment back on its own. | **No** (can recommend) | Execute. Since part 9, see every refund (ADR 0028) |
| Invoices | View own | **No access** | Full |
| Payments and reconciliation | Pay | **No access** | Full |
| Customer records | Own only | Limited view (name, phone, address for fulfilment) | Full |
| Support tickets | Create, view own | Handle | Full |
| Admin accounts | n/a | n/a | Create, disable, remove |
| Super User accounts | n/a | n/a | Developer command only |
| Audit log | n/a | n/a | View all |
| System settings | n/a | n/a | Full |

Assumptions to confirm: Admin handles delivery and return approval but never money; invoices are generated automatically by the system after payment is confirmed.

## 5. Account and access rules

1. Public registration creates **Customer** accounts only. No request, however crafted, can set a role.
2. Staff (Admin, Super User) sign in through a separate login path from customers.
3. Staff accounts require MFA.
4. Admin creation, disabling and removal is a Super User-only API, and every call is audit-logged.
5. Super User creation is a developer-run command that reads credentials from environment variables. The limit of 3 is enforced in application code and in the database.
6. All authorization is enforced on the server for every protected operation. Hiding a screen is not security.
7. Every Admin and Super User action that changes data is written to an append-only audit log (who, what, before, after, when, IP).

## 6. MVP scope (first release)

**Included**
- Customer sign-up, login, profile, addresses (phone OTP; verification method to be chosen). Email confirmation was chosen in part 3A (ADR 0007). Since part 14B on the website, by the owner's choices on 2026-11-21: signed in for 30 days on a device, with signing out there or everywhere; deleting an account later, in a part of its own, as orders and tax records must stay; no CAPTCHA while the API's limits and the email confirmation are enough (ADR 0041). Phone OTP is not built
- Product catalog: categories, variants, images, ingredients, usage, batch and expiry. Since part 15A: subcategories, two levels only, brands kept by staff, and products shown in up to 5 other categories besides their main one, by the owner's choices on 2026-11-23 (ADR 0044)
- Inventory with reservations
- Search and filters (PostgreSQL full-text first). Since part 11: by words in the name, summary and description, forgiving parts of words and typos (PostgreSQL's `pg_trgm`), and by category, type and price, with products in stock first, by the owner's choices on 2026-11-11 (ADR 0030)
- Cart, checkout, delivery charge and tax, order confirmation. Since part 10, the confirmation is also emailed once the order is paid (ADR 0029)
- Payments through a gateway (sandbox first), server-verified, idempotent. Razorpay, chosen by the owner on 2026-11-08 (ADR 0027)
- Order lifecycle, cancellations, returns, refunds. Since part 9: packed, shipped and delivered, typed in by staff, and cancelling until shipped with the payment back in full, by the owner's choices on 2026-11-09 (ADR 0028). Returns are still to come.
- GST invoices (system-generated, sequential per financial year)
- Admin console: catalog, prices, stock, orders, returns, customers (limited). Since part 12A: React and Vite, staff sign-in, the menu for each role, and signing out after 30 minutes without activity, by the owner's choices on 2026-11-11 and 2026-11-12 (ADR 0031). Since part 12B: categories and products, with search by name, ordering by drag and drop, a page for each product, and deleting for Super Users after a dialog that says what is lost (ADR 0032). Since part 12C: each product's pack sizes, edited in a dialog, and its images, several uploaded at once with their progress, both ordered by drag and drop, so a product goes live from the console, by the owner's choices on 2026-11-13 (ADR 0033). Since part 12D: stock, by the owner's choices on 2026-11-18 (ADR 0034): a Stock page of every pack size, filtered to out of stock, low or expiring soon; each pack size's batches, where staff receive deliveries, correct labels, write packs off and count a shelf by typing what they counted, never saved if the stock changed meanwhile; a low-stock number for each pack size; and each pack size's stock on its product's page. Since part 12E: its look, glass and clay, readable in light and dark (ADR 0035), which since part 13 comes from the design system (ADR 0036). Since part 12F: orders and refunds, by the owner's choices on 2026-11-19 (ADR 0037): the paid orders to pack first, each step by its chip, an order found by its reference, each order's page with its steps, a packing slip to print without prices, several orders packed at once, the number to pack in the menu, and a Refunds tab for Super Users, the failed ones first. Since part 12G: Admins and the audit log, by the owner's choices on 2026-11-19 (ADR 0038): an Admins page for Super Users, where they invite, send the invitation again, reset a lost authenticator app, disable, enable and remove; an invited Admin sets up the authenticator app in the console from a QR code, right after choosing the password, and sets it up again the same way after a reset; the audit log in sentences, with what changed on request, filters by kind of change and by person, and links from an Admin's row and an order's page; and a failed refund marked as given back by hand, with a note. Since part 15A: brands, subcategories, and each product's brand and the other categories it is shown in (ADR 0044).
- Customer website. Since part 14A: browsing without signing in, on pages made on the server so that shared links show the product: the home page, the shop with search, filters and sort, each category's page and each product's page with its licence and maker, by the owner's choices on 2026-11-20 (ADR 0039). Since part 14B: the five policy pages, written by a Super User in the console and linked from every page's footer (ADR 0040), and the customer's account: signing up with an emailed link to confirm, signing in, a forgotten password, the name, a new password, up to 10 delivery addresses and signing out everywhere (ADR 0041). Since part 14C: the cart, checkout to a saved or new address, and paying on Razorpay's own page, by the owner's choices on 2026-11-23 (ADR 0042). Since part 14D: the customer's orders, each order's history with the courier and the tracking number once shipped, and cancelling until it ships, by the owner's choices on 2026-11-23 (ADR 0043). Since part 15B: subcategories on a top category's page and in the trails, the shop filtered by subcategory and brand, a search that finds a brand's name, and the brand on a product's page, by the owner's choices on 2026-11-23 and 2026-11-24 (ADR 0045).
- Super User console sections: admin management, invoices, payments, audit log, settings. Since part 14B: the policy pages, drafted, previewed and published as versions (ADR 0040)
- Email and in-app notifications; basic support tickets. Since part 10, order emails: to the customer when an order is paid (a full summary), packed, shipped (with the courier and tracking number, again if corrected), delivered or cancelled, and when a refund is complete; and to the Super Users when a refund fails, by the owner's choices on 2026-11-11 (ADR 0029). In-app notifications and support tickets are still to come.

**Deferred**
- Loyalty points, referrals, subscriptions, EMI
- WhatsApp, voice and image search, live map tracking
- Multi-language beyond English, Windows desktop app
- Multi-vendor, separate search engine, Kafka, read replicas

## 7. Non-functional targets (initial)

- Targets are planning goals and are not claimed until verified by load tests.
- Catalog API p95 under 200 ms at launch load.
- No raw card data stored; payment data limited to gateway tokens and IDs.
- OWASP ASVS Level 2 as the security reference.
- Customer data and backups kept in India (launch market assumption).

## 8. Compliance notes (India, to be validated with a lawyer and CA)

GST (HSN codes, invoices), FSSAI/AYUSH licence numbers on products, Legal Metrology label fields, Consumer Protection (E-Commerce) Rules, DPDP Act consent and erasure, restrictions on curative claims.

## 9. Open decisions

1. Launch states or cities. All of India, decided by the owner on 2026-11-07 (ADR 0026).
2. Do you manufacture the products or buy from licensed makers?
3. One warehouse or several; who packs? One warehouse for now, decided by the owner on 2026-11-06 (ADR 0024). Who packs is still open.
4. Cash on delivery at launch? No: online payment only at launch, decided by the owner on 2026-11-07 (ADR 0026).
5. Region-wise pricing and visibility, or one national catalog for the MVP?
6. API style: REST + OpenAPI (leaning) or GraphQL.
7. Who is the business owner in the role model: a Super User or an Admin?
8. Confirm the permission matrix in section 4. For orders, delivery and refunds, the owner decided part 9's share on 2026-11-09 (ADR 0028).

## 10. Planned requirements (owner, 2026-11-18)

The owner added these for later parts. They are not built yet. Everything built from now on must stay compatible with them.

### 10.1 Analytics and reports

For Super Users, an interactive dashboard:
- **Figures:** sales overall, revenue and order trends, customer growth, new and returning customers, top products and categories, low stock, inventory performance, profit and loss, and the average order value.
- **Reports, with drill-down, by:**
  - place: overall, country, state, division and city;
  - catalog: category, subcategory, product, brand, and vendor or supplier;
  - customer;
  - date range: daily, weekly, monthly, quarterly and yearly;
  - payment method and order status.
- **Charts:** bar, line, pie, donut, area and heat maps, KPI cards, comparisons, and growth percentages.
- **Export** to PDF, Excel and CSV. The PDF has a professional layout, fit for presentations and audits.

**What the data needs first.** Some of these figures need data the system does not keep yet:

| For | Missing today |
|---|---|
| Profit and loss | Any cost. A stock batch has no purchase or making cost (open decision 2). |
| Payment method | Done in part 15C: each payment keeps its method (UPI, card, net banking, wallet, EMI, pay later or other) from Razorpay's own record, set once when it is paid. Payments made before have none: "Not recorded" (ADR 0046). Razorpay's fee is not stored yet: it comes with profit and loss, by the owner's choice on 2026-11-24. |
| Category, subcategory and product | Done in part 15C: each order line keeps the product, the top category and subcategory of its main category, and its brand, each by ID and name, as they were when it was placed. The lines placed before took them from the catalog on 2026-11-24, by the owner's choice (ADR 0046). |
| Subcategory | Done in part 15A: two levels, a category and its subcategories (ADR 0044). |
| Brand, vendor or supplier | Brands done in part 15A: a list staff keep, one or none per product (ADR 0044). Vendors and suppliers are not wanted (the owner, 2026-11-23). Multi-vendor is deferred (section 6), and D1 rules out dealers. A supplier per stock batch would fit products bought from makers. |
| Division | Not stored. It can come from the PIN code, with India Post's directory. Orders keep the city, state and PIN code. |
| Country | Delivery is to India only (ADR 0026), so for now it is the same as overall. |
| Low stock | Done in part 12D: each pack size has its own low-stock number, 10 by default (ADR 0034). Customers still see only "in stock" or "out of stock" (ADR 0024). |

These are best added before launch: an order placed without them can't be reported on them later.

**The owner's choices for part 15 (2026-11-23):**
- sales are what was paid less refunds: a payment counts on the day it was paid, and a refund on the day it was made, in India's time;
- profit and loss come later, once open decision 2 is settled;
- the charts are our own, in SVG, from the design system;
- reports group sales by category and subcategory (two levels), brand, and place as the whole country, then the state. Not by division, city or supplier;
- a product in more than one category counts under its one main category.

Part 15A added the catalog's side of these (ADR 0044), and part 15B showed them on the website (ADR 0045). The owner's choices on 2026-11-24: the brand shows on a product's page only, a link to the shop filtered by it, and the shop's search finds a product by its brand's name too. Part 15C added the data the reports are made from (ADR 0046), by the owner's choices on 2026-11-24: all three migrations, the old orders grouped by the catalog as it is now, Razorpay's fee later, and summaries no more than 5 minutes behind. Part 15D added the Sales page (ADR 0047), by the owner's choices on 2026-11-25:
- its own menu item, for Super Users only;
- Sales without GST as the headline;
- the totals beside the period before, new and returning customers, a chart over time and top lists;
- preset periods or any days;
- filters by product, category and brand;
- an Excel download with a dashboard of charts, every grouping in full and a register of every line.

The download has no customer details. Invoice numbers and the GST split wait until the company is registered.

**How it will be built:**
- Super Users only, with each export written to the audit log. Done in part 15D for the sales report and its Excel download (ADR 0047).
- Reports read daily summaries, counted in Indian time, not the live order tables, so the shop stays fast. Done in part 15C: rebuilt by a job every 5 minutes, by the state, the payment method, and each line's product, category, subcategory and brand (ADR 0046).
- Amounts in whole rupees, as everywhere.
- CSV and Excel files never start a cell with `=`, `+`, `-` or `@` unescaped, so a spreadsheet can't run a cell as a formula. Done in part 15D for Excel, a tab and a return included (ADR 0047).
- PDFs are made by the API, so they look the same every time.
- Charts run under the console's security policy, checked in a real browser. Done in part 15D: our own SVG charts, driven in headless Chrome without a violation (ADR 0047).

### 10.2 The website and the apps

For the website and the Android and iOS apps:
- **Style:** a blend of minimalism, glassmorphism, neumorphism or claymorphism, flat design and Material principles, responsive and mobile first.
- **Experience:**
  - one consistent design system, and smooth animations and micro-interactions;
  - accessibility, and dark and light modes;
  - fast rendering, modern typography and a professional palette;
  - intuitive navigation and touch-friendly controls.
- **More:**
  - a personalised dashboard, and real-time notifications;
  - advanced search and filters;
  - an installable web app (PWA), offline where it makes sense, and several languages;
  - clear security steps, and faster checkout;
  - skeleton screens while pages load.

**How it will be built:**
- One design system for the console, the website and the apps. It shares the foundations: accessibility rules, spacing, type, motion, and the names of the tokens. Each side has its own look on top of them. The console's look is glass and clay (ADR 0035). The website's and the apps' look follows the owner's references (2026-11-20). Built in part 13 as `packages/design`, with both looks and a preview page of the shop's (ADR 0036).
- Glass and soft depth only on a few surfaces, such as bars and sheets. Every text keeps WCAG 2.2 AA contrast. They switch off for people who ask the system for less transparency or motion. Blur is used sparingly, as it slows low-end Android phones.
- Offline means browsing only: the app never keeps a signed-in customer's data for offline use, and checkout and payment stay online.
- The website's and the apps' texts are kept apart from the code from the first page, so languages can be added. The admin console stays in English.

**The owner's order, 2026-11-18:** first the admin console gets glass and clay touches, keeping its text easy to read (done in part 12E, ADR 0035); then a design system shared by the console, the website and the apps is planned as a part of its own, before the website (done in part 13, ADR 0036).

**The owner, 2026-11-20:** glass and clay is the console's look, for Admins and Super Users. The customer website and apps will look very different, from a reference video the owner sends when the design system is planned.

**The owner, 2026-11-20, for the shop's look** (ADR 0036):
- the references: the `landing-page-design` rules from elayadesign/ai-design-skills and a short video of sites in that style: calm, flat and premium, big illustrated heroes, pill buttons, a floating glass menu bar, and motion that settles into place;
- one typeface, Poppins, served by the shop itself, and English for now;
- light or dark as the phone is set, with a switch on the page;
- the hero illustrations come from the owner; nothing is invented or generated;
- the accent colour is picked from the art later. Until then the main colour is neutral, black or white.

### 10.3 Questions for the owner

1. Should each stock batch keep its cost, in whole rupees? This depends on open decision 2.
2. ~~Subcategories: one level under each category?~~ Answered on 2026-11-23: two levels, a category and its subcategories (ADR 0044).
3. ~~Is there more than one brand? Should each batch name its supplier?~~ Answered on 2026-11-23: brands are a list staff keep, one or none per product, shown in the shop (ADR 0044). No suppliers.
4. ~~Low stock: one threshold for all, or one per pack size?~~ Answered on 2026-11-18: one per pack size, 10 by default, 0 for never (ADR 0034).
5. Several languages are on the deferred list (section 6). Do they come into scope, and which languages? For now English only (the owner, 2026-11-20); the website's texts are kept apart from the code, so languages can come later.
6. The apps: React Native (Expo) would share TypeScript, the API's types and the design tokens with the website. Choose when the apps start.
7. ~~A refund Razorpay refused (`FAILED`) stays so after a Super User gives the money back by hand, and stays in the console's failed card. Should staff mark it as given back, with a note, and should the customer be emailed then?~~ Answered on 2026-11-19: a Super User marks it as given back by hand, with a note saying how, and the customer is not emailed (ADR 0038).
8. Signing up says "By creating an account, you agree to the Terms and conditions and the Privacy policy.", with both linked, and no box to tick (ADR 0041). Is that enough, or should customers tick a box? A lawyer may advise.
9. The website shows prices, stock and policy pages up to a minute behind the console, so the shop stays quick when many people look (ADR 0039, ADR 0040). Is a minute acceptable, or should some of them show at once?
10. Hosting: where the API and the website will run, and whether a CDN such as Cloudflare goes in front of the website. The cache rules for one are ready (ADR 0039, "What may be kept, and where").
