# 0021. Products

- Status: Accepted and implemented (part 4B)
- Date: 2026-11-04

## Context

Part 4A added categories (ADR 0020). Part 4B adds the products themselves. Prices and pack sizes come in part 4C, and images in part 4D.

The products are herbal: Ayurvedic medicines, foods and supplements such as herbal teas, and cosmetics. Indian law wants certain details on a product's page (`docs/requirements.md`, section 8, still to be confirmed by a lawyer):
- the licence that allows it to be made and sold: an **AYUSH** licence for an Ayurvedic medicine, an **FSSAI** licence for a food or supplement, a cosmetics licence for a cosmetic;
- the **name and address of the maker**;
- the **country of origin**;
- the **ingredients**.

Staff often enter a product before every paper is at hand, so a product must be able to wait as a draft.

The owner made two choices on 2026-11-03:
- **The licence and maker details are required before a product goes live.** A draft may lack them.
- **Ingredients are one text field,** written exactly as printed on the pack.

## Decision

### The table

`products` holds:
- `categoryId`: exactly one category, with a foreign key `ON DELETE RESTRICT`;
- `name` and a unique `slug`, with the same rules as categories (ADR 0020);
- `summary` (one line, for list pages), `description`, `ingredients` and `usage`;
- `type`: a Postgres enum `ProductType`, `AYURVEDIC_MEDICINE`, `FOOD_OR_SUPPLEMENT` or `COSMETIC`;
- `licenceNumber`, `manufacturerName` and `manufacturerAddress`;
- `countryOfOrigin`, `India` by default and never empty;
- `isActive`, false by default, and `position`, the order within the category;
- `createdAt` and `updatedAt`.

Every detail except the country is optional in the table, so drafts can be incomplete.

### Going live

A product is live (`isActive`) only with all five of: `type`, `licenceNumber`, `manufacturerName`, `manufacturerAddress` and `ingredients`. Two layers enforce it:

1. **The API** checks the product **as it will be saved**: the stored values plus the change. It answers `400 Validation failed` and names each missing field ("Needed before the product can go live"). The rule therefore also refuses:
   - removing a detail from a live product;
   - changing a product's type so that its licence no longer fits.

   Adding the missing details and going live in one request works.
2. **The database** has a hand-written check constraint, `products_live_needs_details_chk`, in the migration. Even a bug in the API cannot put a product online without its details. Prisma does not manage check constraints, so it lives only in the migration's SQL, like the lowercase-email check (ADR 0003).

The rule lives in one function, `productIssues` in `catalog/product-rules.ts`. The create schema and the change both use it.

### The licence number

- **One form:** spaces are dropped and letters made capitals. ` 25d / 123 / 2015 ` is stored as `25D/123/2015`. Only letters, digits, `/`, `.` and `-` are allowed, at most 50 characters.
- **An FSSAI licence is exactly 14 digits,** checked even in a draft, because a wrong number is never right. AYUSH and cosmetics licences have no single national format, so only the characters are checked.

### The other fields

| Field | Rule |
|---|---|
| `name` | 1 to 100 characters |
| `summary` | up to 160 |
| `description` | up to 5000 |
| `ingredients`, `usage` | up to 2000 each |
| `manufacturerName` | up to 200 |
| `manufacturerAddress` | up to 500 |
| `countryOfOrigin` | 2 to 60, never empty |
| `position` | a whole number from 0 to 9999 |

Texts are trimmed, and an empty one means none (`null`). The product type comes from the database's enum, so the API and the database can never disagree on the list.

### Who may do what

| | Visitor or customer | Admin | Super User |
|---|---|---|---|
| See a live product in an active category | Yes | Yes | Yes |
| List every product, drafts too | No | Yes | Yes |
| Create, change, activate, deactivate | No | Yes | Yes |
| Delete | No | No: `403`, they deactivate instead | Yes |

The staff controller follows the categories' pattern (ADR 0020): `@StaffOnly()` as a whole, `@SuperUserOnly()` on delete only, and route tests that list both.

### Audit

The same as for categories:
- `product.created`, with everything staff set;
- `product.updated`, with only the fields that changed, before and after;
- `product.deleted`, with everything the product was.

Each entry is written in the same transaction as its change, after a row lock on the product (`SELECT … FOR UPDATE`). A change that changes nothing, and a refused change, write no entry. The shared helpers `changedFields` and `pick` (`catalog/changes.ts`) decide what really changed, for categories and products alike.

### Deleting a category that has products

The foreign key's `RESTRICT` makes Postgres refuse it. The API turns that refusal (Prisma's `P2003`) into `409 This category still has products. Move them to another category or delete them first.` It doesn't count products first, so a product added at the same moment cannot slip through. A product sent with a category that doesn't exist gets `400` on `categoryId`, from the same foreign key.

### The shop

**Customers see a product only while both the product and its category are active.** Hiding a category hides its products without touching them.

| Endpoint | Shows |
|---|---|
| `GET /v1/categories/:slug/products` | The category (name, slug, description) and one page of its live products: name, slug and summary. Prices come with part 4C. |
| `GET /v1/products/:slug` | The product's own page: the texts, the type, the licence number, the maker's name and address, the country of origin, and its category's name and slug |

- **Both are `@Public()`,** and answer `404` for anything hidden or unknown, so a draft cannot be told from a product that doesn't exist.
- **The shop never shows IDs or staff fields.** Its pages continue after the **slug** of the last product shown (`?after=<slug>`). The staff list continues after an ID.
- **Page sizes:** a shop page has 1 to 50 products (20 by default), and a staff page 1 to 100 (50 by default). The order is the same for both: position, then name.

### Endpoints for staff

| Endpoint | Who | Purpose |
|---|---|---|
| `GET /v1/staff/products` | Staff | Every product, drafts too, one page at a time. Optional filters: `?categoryId=` and `?isActive=` |
| `POST /v1/staff/products` | Staff | Create a product, a draft unless `isActive` is sent |
| `PATCH /v1/staff/products/:id` | Staff | Change it, move it to another category, activate or deactivate it |
| `DELETE /v1/staff/products/:id` | Super Users | Delete it for good |

## Alternatives considered

- **Every detail required from the start.** Rejected by the owner: staff must be able to start a product before the papers are at hand.
- **The details optional even for live products.** Rejected by the owner: a product page without its licence breaks the labelling rules.
- **Ingredients as a list** (one row per ingredient with an amount). Rejected by the owner for now. The text matches the printed label exactly, and full-text search (later) can still find an ingredient.
- **Checking the rule in the API only.** Rejected: a future bug or a manual SQL change could put an unlicensed product online. The check constraint costs one SQL statement.
- **Checking only the fields a change sends.** Rejected: removing the licence of a live product would pass. The rule must see the product as it will be.
- **Product IDs in the shop's URLs and paging.** Rejected: slugs are readable and say nothing about the database.
- **A product in several categories.** Not now: one category keeps the shop's navigation and the delete rule simple. A second table can add this later.

## Consequences

- Part 4C can add pack sizes and prices to a product, and the shop pages will show them.
- **Tests:**
  - 407 unit tests in 55 suites.
  - The smoke test has 63 checks. The new ones:
    - unknown shop pages answer `404`;
    - a too-large page answers `400`;
    - every live category page and product page shows only its listed fields, with a licence and a maker;
    - a customer's token cannot list, create, change or delete products.
  - **By hand, with a phone, in part 4B:**
    - an Admin created two drafts, was refused going live (five fields) and an FSSAI licence of 4 digits, then completed one product and activated it in one request;
    - the shop showed only that product;
    - the Admin got `403` on delete, and hiding the category hid the product;
    - a Super User got `409` deleting the category, then deleted the products and the category.

    The audit log held exactly one `product.updated`, and nothing for the refusals.
- **The migration in this part taught a rule** (ADR 0003): the foreign key was lost while adding the check constraint by hand. The fix was a second migration, never an edit of the applied one.
- **Still open:**
  - legal review of the label fields;
  - the rules on curative claims, which are about the description text, so staff must review what they write;
  - net quantity and MRP (part 4C), batch and expiry (part 5);
  - search (later).
