# 0020. Product categories

- Status: Accepted and implemented (part 4A)
- Date: 2026-11-03
- Updated: 2026-11-04 (part 4B: products, and a category with products cannot be deleted, see ADR 0021)

## Context

The product catalog is in the MVP scope (`docs/requirements.md`): categories, variants, images, ingredients, usage, batch and expiry. Part 4 builds it in four steps:
- 4A: categories;
- 4B: products;
- 4C: variants and prices;
- 4D: product images.

Categories come first, because every product will belong to one.

The permission matrix (`docs/requirements.md`, section 4, not yet confirmed by the owner) says, for products and categories:
- **Customers** view them.
- **Admins** create, edit, activate and deactivate them.
- **Super Users** have full control, including delete.

Two things are new here:
- **Customers read this data without signing in.** It is the first public business data.
- **Admins change shared data.** Until now, every audited staff change was a Super User managing Admins.

Open decision 5, region-wise pricing and visibility or one national catalog, is still open. This part assumes **one national catalog**.

## Decision

### The table

`categories` holds:
- `id`, a UUID;
- `name`;
- `slug`, unique;
- `description`, optional;
- `isActive`, false by default;
- `position`, 0 by default;
- `createdAt` and `updatedAt`.

**One level, with no subcategories for the MVP.** A herbal shop starts with a handful of categories, such as hair care, skin care and teas. A tree would add work to every query and every screen. A parent column can be added later without breaking anything.

### The slug

The slug is the readable part of a web address: `/categories/hair-care`.

- **Only lowercase letters `a`–`z`, digits and single hyphens,** at most 60 characters (`^[a-z0-9]+(?:-[a-z0-9]+)*$`). Each name then has exactly one form, so `Hair-Care` and `hair-care` can never be two different links.
- **Made from the name, unless one is sent** (`slugify` in `catalog/slug.ts`):
  1. The name is normalized to Unicode NFKD, and the accent marks are dropped: `Café Crème` becomes `cafe-creme`.
  2. Every run of other characters becomes one hyphen: `Teas, Tisanes & Kadha` becomes `teas-tisanes-kadha`.
  3. The result is cut to 60 characters, with no hyphen left at the end.
- **A name without Latin letters or digits** (in Devanagari, for example) gives an empty slug. Then a slug must be sent with it, and the error names the `slug` field.
- **Unique, decided by the database.** The unique index refuses a slug that another category has, and the API answers `409 Another category already has this slug. Choose a different one.` The code doesn't look first: between a check and the save, another request could take the same slug.
- **Renaming keeps the slug,** so bookmarks and search-engine links keep working. A new slug must be sent on purpose.

### The other fields

| Field | Rule |
|---|---|
| `name` | 1 to 60 characters, trimmed |
| `description` | Optional, up to 500 characters, trimmed. Empty, or `null` in a change, means none. |
| `position` | A whole number from 0 to 9999. Lower numbers come first. |
| `isActive` | `false` unless sent |

- **A new category starts hidden.** Staff prepare it, then activate it.
- **One order everywhere:** by `position`, then `name`, then `id`, for staff and customers alike.
- **A change needs at least one field** (`400 Nothing to change`). Unknown fields, such as `id` or `createdAt`, are dropped.

### Who may do what

| | Visitor or customer | Admin | Super User |
|---|---|---|---|
| See the active categories (`GET /v1/categories`) | Yes | Yes | Yes |
| See every category, hidden ones too | No | Yes | Yes |
| Create, change, activate, deactivate | No | Yes | Yes |
| Delete | No | No: `403`, they deactivate instead | Yes |

- **The staff routes are in one controller, `@StaffOnly()` as a whole,** so a route added later cannot miss it. Only the delete handler is also marked `@SuperUserOnly()`. The roles guard reads the handler first, then the controller.
- **The route tests list both:**
  - `staff/staff-routes.spec.ts` checks that delete is the controller's only Super-User-only handler;
  - `auth/public-routes.spec.ts` checks that the public list is the only public category handler.
- **The staff controller lives in the catalog module** (`src/catalog/staff-categories.controller.ts`), next to the public one, not in `src/staff`. `src/staff` keeps staff accounts and sign-in. A feature's staff routes live with the feature (`docs/architecture.md`, section 5).

### Audit

| Action | What it keeps |
|---|---|
| `category.created` | `after`: the five fields staff set (`name`, `slug`, `description`, `isActive`, `position`) |
| `category.updated` | `before` and `after`: **only the fields that changed** |
| `category.deleted` | `before`: the five fields, so the log keeps what was deleted |

- Each entry is saved **in the same transaction** as the change, with the actor, the client IP and the request ID (ADR 0015).
- **A change that changes nothing** (every value sent is the one already stored) saves nothing and writes no entry, like an Admin's status change (ADR 0016).
- The entries have `targetType` `category`. The audit log view shows `target: null` for them, because it names accounts only. Find a category's entries with `?targetId=<its ID>`: they outlive the category (ADR 0012).

### One change at a time per category

- **A change or a delete first locks the category's row:** `SELECT id FROM categories WHERE id = $1 FOR UPDATE`, inside the transaction. It then reads the category.
- If two staff members change the same category at the same moment, they take turns. Each audit entry's `before` is then the true last state.
- An unknown ID finds no row to lock and answers `404 Category not found`.
- **The statement is a tagged template.** The ID travels as a parameter, and the route has already checked that it is a UUID. It is the third raw SQL statement in the API, after the health check and the address lock (ADR 0019).

### The public list

- **`GET /v1/categories` is `@Public()`,** because customers browse the shop before they sign in.
- **Active categories only, with only `name`, `slug` and `description`:** no `id`, `isActive`, `position` or timestamps. The query selects exactly those three columns. A column added later cannot leak by accident, and staff fields can change without affecting customers.
- It has only the per-IP baseline rate limit (600 per minute), like every route. It is a small read, and there is no paging: a catalog has only a few categories. The staff list has no paging either.
- It holds nothing personal, so it doesn't carry `Cache-Control: no-store`.

### Endpoints

| Endpoint | Who | Purpose | Answer |
|---|---|---|---|
| `GET /v1/categories` | Anyone | The active categories | `200 { "categories": [...] }` |
| `GET /v1/staff/categories` | Staff | Every category, with every field | `200 { "categories": [...] }` |
| `POST /v1/staff/categories` | Staff | Create a category | `201` with the category |
| `PATCH /v1/staff/categories/:id` | Staff | Change, activate or deactivate it | `200` with the category |
| `DELETE /v1/staff/categories/:id` | Super Users | Delete it for good | `204` |

### Deleting a category that has products

Since part 4B, a product belongs to one category, and the database refuses to delete a category that still has products: a foreign key with `ON DELETE RESTRICT`. The API then answers `409 This category still has products. Move them to another category or delete them first.` Staff deactivate the category instead, which hides its products from the shop too, or move or delete its products first (ADR 0021).

## Alternatives considered

- **Subcategories (a tree).** Not now, for the reasons above.
- **Transliterating names into Latin letters** (आयुर्वेद → `ayurveda`). Rejected for now: it needs rules for each script, and the results are often disputed. Staff type the slug instead.
- **A new slug on every rename.** Rejected: every rename would break links, unless old slugs were kept as redirects.
- **Checking that the slug is free before saving.** Rejected: the gap between the check and the save. The unique index is always right.
- **Soft delete** (a "deleted" flag). Rejected. Deactivating already hides a category and can be undone. Delete is for mistakes, and the audit log keeps what was deleted.
- **Letting Admins delete.** Rejected: the permission matrix keeps delete for Super Users.
- **Showing customers every field.** Rejected. They need three, and every extra field would become part of the public API.
- **Region-wise visibility.** Not now: open decision 5.

## Consequences

- Part 4B can attach products to a category, and the public list gives the shop its navigation.
- **Tests:**
  - 357 unit tests in 50 suites.
  - The smoke test has 58 checks. The new ones: the public list shows only the three fields, a signed-in customer gets the same list, and a customer's token cannot list, create, change or delete categories.
  - The staff side is tried by hand with a phone (README, "Manage categories"). In part 4A, an Admin created a category, activated it twice and got `403` on delete, and a Super User deleted it. The audit log then held exactly three entries for it, with a single `category.updated`.
- The audit log now holds day-to-day staff work too, not only the management of staff accounts.
- **Windows PowerShell 5.1 garbles letters outside English** in a request body sent as `application/json`. The README's commands send `application/json; charset=utf-8`, so names like `Café` arrive intact.
- **Still open:**
  - the owner's confirmation of the permission matrix (open decision 8);
  - one national catalog (open decision 5);
  - transliterated slugs, if non-English names become common.
