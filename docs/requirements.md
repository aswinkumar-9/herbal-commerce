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
| Orders | Own only | View, confirm, pack, ship, cancel (before payment capture) | Full |
| Delivery and shipments | Track own | Manage | Full |
| Returns | Request | Review and approve/reject | Full |
| Refunds (money movement) | Request via return | **No** (can recommend) | Execute |
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
- Customer sign-up, login, profile, addresses (phone OTP; verification method to be chosen)
- Product catalog: categories, variants, images, ingredients, usage, batch and expiry
- Inventory with reservations
- Search and filters (PostgreSQL full-text first)
- Cart, checkout, delivery charge and tax, order confirmation
- Payments through a gateway (sandbox first), server-verified, idempotent
- Order lifecycle, cancellations, returns, refunds
- GST invoices (system-generated, sequential per financial year)
- Admin console: catalog, prices, stock, orders, returns, customers (limited)
- Super User console sections: admin management, invoices, payments, audit log, settings
- Email and in-app notifications; basic support tickets

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

1. Launch states or cities.
2. Do you manufacture the products or buy from licensed makers?
3. One warehouse or several; who packs?
4. Cash on delivery at launch?
5. Region-wise pricing and visibility, or one national catalog for the MVP?
6. API style: REST + OpenAPI (leaning) or GraphQL.
7. Who is the business owner in the role model: a Super User or an Admin?
8. Confirm the permission matrix in section 4.
