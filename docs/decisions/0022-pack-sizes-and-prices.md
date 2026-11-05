# 0022. Pack sizes and prices

- Status: Accepted and implemented (part 4C)
- Date: 2026-11-05

## Context

Part 4B added products (ADR 0021). A customer buys a **pack** of a product, such as 60 capsules or 100 g, and each pack has its own price. Part 4C adds the packs and their prices.

Indian law asks for these (`docs/requirements.md`, section 8, still to be confirmed by a lawyer):
- **The net quantity and the MRP** are printed on every pack. The MRP includes all taxes, and nobody may charge more than it.
- **GST invoices** (with orders, later) name each product's **HSN code**, which classifies the goods, and its **GST rate**. Since GST 2.0 (22 September 2025), the rates are 0, 5, 18 and 40 percent.

The owner made these choices:
- On 2026-11-04:
  - **Each pack has an MRP and a selling price**, never more than the MRP.
  - **No approval step for price changes for now.** The audit log records each one.
  - **The size is a number and a unit,** such as 60 and `CAPSULES`.
  - **The HSN code and GST rate are set once per product,** not per pack.
- On 2026-11-05: **prices are whole rupees,** not paise. The shop's prices look like 49, 99, 299 and 999.

## Decision

### The table

`product_variants` holds one pack size of a product:
- `productId`, with a foreign key `ON DELETE CASCADE`: the packs go with their product;
- `sku`: staff's own code for the pack, such as `ASH-CAP-60`, unique across all products;
- `quantity` and `unit`: the net quantity on the label. The unit is a Postgres enum `PackUnit`: `G`, `KG`, `ML`, `L`, `CAPSULES`, `TABLETS` or `PIECES`;
- `mrpRupees` and `priceRupees`: the MRP and the price the shop charges;
- `isActive`: on sale, true by default. A pack can be taken off sale without touching its product;
- `position`: the order on the product's page;
- `createdAt` and `updatedAt`.

A product has each size once: `(productId, quantity, unit)` is unique.

### Prices are whole rupees

- **Staff type `499` for ₹499.** No conversion, and no risk of a price 100 times too high or too low.
- **Integer columns, never floating-point numbers.** A price is a whole number from 1 to 10,00,000. `449.50` is refused.
- **Both prices include GST,** as an MRP must. The GST inside a price is worked out on the invoice.
- **Amounts that can have paise come later, as whole paise.** The GST inside a price is one example (5% inside ₹449 is ₹21.38), an order's total after a discount another. They will live in integer columns named `…Paise`, with orders.

Money fields always say their unit in their name: `mrpRupees`, `priceRupees`, `fromPriceRupees`.

### The price never exceeds the MRP

Two layers enforce it, as for a live product's details (ADR 0021):
1. **The API** checks the pack **as it will be saved:** the stored values plus the change, inside the transaction, after a row lock on the pack. A lower MRP alone is refused when it would fall below the stored price. The answer is `400 Validation failed` on `priceRupees`: "The price may not be more than the MRP".
2. **The database** has a hand-written check constraint, `product_variants_quantity_and_price_chk`: the quantity and both prices are above 0, and the price is at most the MRP.

### The other fields

| Field | Rule |
|---|---|
| `sku` | 3 to 40 characters: capital letters, digits and single hyphens. Trimmed and made capitals: ` ash-cap-60 ` is stored as `ASH-CAP-60`. |
| `quantity` | A whole number from 1 to 1,000,000, in its unit |
| `unit` | One of the seven `PackUnit` values |
| `isActive` | Default `true` |
| `position` | A whole number from 0 to 9999. Default `0`. |

The packs are listed by `position`, then by quantity.

Two clashes answer `409`, from the database's unique rules:
- `Another pack size already has this SKU. Choose a different one.`
- `This product already has a pack of this size.`

### HSN code and GST rate, per product

`products` gets two new fields:
- `hsnCode`: 4, 6 or 8 digits. Spaces are dropped: `3004 90` is stored as `300490`.
- `gstRate`: in percent, one of `GST_RATES` in `catalog/product-rules.ts`, today 0, 5, 18 and 40. When the law changes, that list changes. **A chartered accountant confirms the rate for each HSN code.**

A product now goes live only with these two as well, so seven fields in all. Both layers of ADR 0021 check them: the rule `productIssues`, and the check constraint `products_live_needs_details_chk`, which this part's migration replaces.

### Who may do what

| | Visitor or customer | Admin | Super User |
|---|---|---|---|
| See the packs on sale of a live product | Yes | Yes | Yes |
| List every pack of a product, off sale ones too | No | Yes | Yes |
| Add a pack, change it, change its prices, take it off sale | No | Yes | Yes |
| Delete a pack | No | No: `403`, they take it off sale instead | Yes |

The staff controller follows the categories' and products' pattern: `@StaffOnly()` as a whole, `@SuperUserOnly()` on delete only, and route tests that list both.

### Audit, instead of approval

Every change is in the audit log, in the same transaction:
- `variant.created`, with everything staff set;
- `variant.updated`, with only the fields that changed, before and after;
- `variant.deleted`, with everything the pack was.

A price change therefore always leaves its old and new price, with who changed it, when, from which IP and in which request. A change that changes nothing writes no entry.

**Deleting a product deletes its packs** (the cascade). Its `product.deleted` entry keeps them: `before.variants` lists each pack's SKU, size, prices and whether it was on sale.

### The shop

| Endpoint | Shows |
|---|---|
| `GET /v1/categories/:slug/products` | Each product's card also has `fromPriceRupees`: the lowest price among its packs on sale, or `null` while none is on sale |
| `GET /v1/products/:slug` | The product's page also has `variants`: its packs on sale, each with `sku`, `quantity`, `unit`, `mrpRupees` and `priceRupees` |

- **A pack is known by its SKU.** The shop still shows no IDs.
- **A pack taken off sale disappears from the shop** at once, and from the card's lowest price.
- **A live product without a pack on sale stays visible,** with an empty `variants` list and `fromPriceRupees: null`. The website can show it as unavailable.

### Endpoints for staff

| Endpoint | Who | Purpose |
|---|---|---|
| `GET /v1/staff/products/:productId/variants` | Staff | Every pack of a product, off sale ones too. Not paged: a product has only a few. |
| `POST /v1/staff/products/:productId/variants` | Staff | Add a pack, on sale unless `isActive` is `false` |
| `PATCH /v1/staff/variants/:id` | Staff | Change a pack: its prices, SKU, size, position, or whether it is on sale |
| `DELETE /v1/staff/variants/:id` | Super Users | Delete a pack for good |

## Alternatives considered

- **Prices in whole paise.** This was the first plan, built in steps 1 to 5 of this part. The owner changed it on 2026-11-05, before any real price existed. Shop prices are whole rupees, and a staff member who typed `499` would have set ₹4.99. One migration renamed the two columns (ADR 0003).
- **A decimal column** (`NUMERIC(10,2)`). Rejected: whole numbers are exact in JavaScript and JSON, while a decimal comes back as a string or a special object.
- **One price only.** Rejected by the owner: the law wants the MRP, and the shop can show the discount.
- **A Super User approves large price changes,** as the permission matrix in `docs/requirements.md` proposes. Not now, by the owner's choice: the audit log keeps every change, so a wrong price can be found and put right. Revisit with the admin console.
- **The size as free text,** such as "60 caps". Rejected by the owner: a number and a unit can be sorted and compared, and each unit has one spelling.
- **HSN code and GST rate per pack.** Rejected by the owner: they classify the goods, which are the same in every size.
- **Checking the price in the API only, or only the fields a change sends.** Rejected, for the same reasons as in ADR 0021: a lower MRP alone would slip through, and so would a bug.

## Consequences

- **Tests:**
  - 437 unit tests in 58 suites.
  - The smoke test has 66 checks. The new ones:
    - each pack on a product's page shows only its SKU, size and prices, and never a price above its MRP;
    - each card's from-price is the lowest price on its product's page, or `null` without a pack on sale;
    - a customer's token cannot list, add, change or delete pack sizes.
  - **By hand, with a phone, in part 4C** (still in paise, before the switch):
    - an Admin was refused a GST rate of 12%, then created a live product with its HSN code and a rate of 5%;
    - the Admin added two packs and was refused four times:
      - a price above the MRP;
      - a SKU already taken;
      - a size the product already had;
      - a lower MRP that fell below the stored price;
    - the Admin changed a price and took a pack off sale, and the card's from-price followed each time;
    - the Admin got `403` deleting a pack;
    - a Super User deleted a pack, the product and the category.

    The audit log held the pack's whole price history. The `product.deleted` entry kept the pack that was off sale.
- **This part taught three migration rules** (ADR 0003):
  - rename a column by hand, because Prisma would drop it and add it again;
  - guard a migration that could misread existing data;
  - keep a project-wide search and replace away from applied migrations. One reached them in this part. The checksums showed it before the pull request, and the files were restored.
- **Still open:**
  - legal review of the label and price rules;
  - stock per pack, with batch and expiry (part 5);
  - GST on invoices and order totals in paise (orders);
  - approval of large price changes (with the admin console);
  - images (part 4D).
