# 0044. The catalog's groupings: brands, subcategories, and products in more than one category

- Status: Accepted and implemented (part 15A)
- Date: 2026-11-24
- Updated: 2026-11-24 (part 15B: the website shows subcategories and brands, `GET /v1/brands` lists the brands to shop by, and subcategories no longer need to stay hidden, see ADR 0045)

## Context

Part 15 brings analytics and reports for Super Users (`docs/requirements.md`, section 10.1). They group sales by category, subcategory and brand. Until now the catalog couldn't:
- categories had one level only (ADR 0020);
- each product was in exactly one category (ADR 0021);
- there were no brands.

The owner made these choices on 2026-11-23:
- **Subcategories: two levels only,** a category and its subcategories. A top category may hold products of its own as well as subcategories.
- **Brands: a list kept by staff in the console.** Each product may have one, or none: reports will say "No brand". The shop shows it on the product's page and as a filter.
- **"Few products might come under two categories":** a product keeps one **main** category, and may also be shown in others. Reports count each sale once, under the main one.
- **Not suppliers, and not India Post's divisions.** Place will be the whole country, then the state, later in part 15.

Part 15A builds these in the API and the console. Part 15B shows them on the website. From part 15C, each sale keeps its product, category and brand as they were when it was made.

## Decision

### Brands

- **The table `brands`** (`20261123120000_brands`):
  - a name, 1 to 60 characters;
  - a slug, unique among brands, made from the name unless one is given, so `Himalaya` and `HIMALAYA` can't both exist.

  `products.brandId` is optional, indexed, with `ON DELETE RESTRICT`. Products already in the catalog have none.
- **Staff keep the list** at `/v1/staff/brands`:
  - listing gives them by name, each with how many products have it, drafts too;
  - creating, renaming, or changing the slug. Renaming keeps the slug, so links to the shop filtered by a brand keep working;
  - deleting is for Super Users only, and only for a brand no product has. Otherwise it is `409 This brand still has products. Choose another brand for them, or none, first.` The database refuses it too.
- **Every change is audited** in the same transaction, after a row lock on the brand:
  - `brand.created`;
  - `brand.updated`, with only what changed;
  - `brand.deleted`, with what was deleted.

  A change to the values a brand already has writes nothing.
- **A product's `brandId`:**
  - must be an existing brand (`No brand with this ID`);
  - is held with `FOR KEY SHARE` while the product is saved, so the brand can be renamed meanwhile but not deleted;
  - `null` takes the brand away;
  - going live doesn't need one.
- **Where brands show:**
  - staff filter the product list by `brandId`;
  - the shop's product page gives `brand`, its name and slug, or `null`.

### Subcategories

- **`categories.parentId`** (`20261123130000_subcategories`) is the top category a category sits in. It is indexed, with `ON DELETE RESTRICT`, and a check that a category never sits inside itself. Categories already in the catalog stay top categories.
- **Two levels only,** checked by the API with the rows locked in the order of their IDs:
  - a category goes inside a top category only, never a subcategory: "This is a subcategory. Choose a top category: there are only two levels.";
  - never inside itself;
  - a category with subcategories can't go inside another: "This category has subcategories, so it cannot sit inside another. Move them first."
- **Moving** (`PATCH` with `parentId`) keeps the category's place number. Its products go with it. The console sends the place at the end of the new level with the move.
- **Ordering, one level at a time:**
  - `PUT /v1/staff/categories/order` with a `parentId` orders that top category's subcategories;
  - without one, the top categories;
  - the list must be exactly that level's categories, or it is `409`.
- **Deleting is refused** while the category still has subcategories, hidden or not (`409`), as it is while it has products.
- **Hiding a top category hides everything in it.** A subcategory is shown only while it and its top category are both active (`SHOWN_CATEGORY` in `catalog/shown-categories.ts`). The same rule decides the shop's lists, pages and search, and the packs the cart and checkout may sell (`catalog/shop-packs.service.ts`).
- **The shop:**
  - `GET /v1/categories` gives each active top category with its active `subcategories`;
  - a category's page gives its top category (`parent`), or its own `subcategories`;
  - a category's page lists only its own products. A subcategory's products are on its own page: slugs are unique across both levels, so each subcategory has one;
  - the search's `category` includes a top category's subcategories.

### Products in more than one category

- **The table `product_categories`** (`20261124090000_products_in_other_categories`):
  - a product and a category, the two together its primary key;
  - its place in that category;
  - deleting the product takes its rows with it (`ON DELETE CASCADE`). A category that still shows a product can't be deleted (`ON DELETE RESTRICT`).
- **The main category stays `products.categoryId`.** Reports will count the product's sales there, and its `position` orders it there.
- **`otherCategoryIds`, the categories it is also shown in:**
  - at most 5, each once, never the main one;
  - a change replaces the whole list. A category kept on it keeps the product's place there; one added puts the product last there;
  - to make one of them the main category, staff send both: the new `categoryId`, and the list without it.
- **Live there only while its main category is shown.** Hiding the main category takes the product out of every category it is shown in.
- **Staff order each category's products, its own and those shown there, as one list:**
  - `GET /v1/staff/products/order?categoryId=` lists every product shown in the category, drafts too, in order;
  - `PUT /v1/staff/products/order` takes exactly that list;
  - a product shown from another category that moved writes `otherCategoryPosition` in its `product.updated`: the category, and its place before and after.
- **Deleting a category is refused** while it shows products from other categories: "This category still shows products from other categories. Take it off their other categories first."
- **The shop:**
  - a category's page lists its own live products and those shown there, in one order: by place, then name, then ID. It is paged by those three in one raw query, every value a bound parameter;
  - the search's `category` finds the products shown there too;
  - a product's page names its main category only.

### Where a product goes

- **A product created without a place, or moved to another main category without one, goes last there:** one more than the highest place among its own products and those shown there, at most 9999. Before 15A the default was `0`, and the console worked out the next place itself.
- **The API works it out in the same transaction.** One query locks the main category, and any category newly added to `otherCategoryIds`, with `FOR KEY SHARE` in the order of their IDs, so none of them can be deleted meanwhile.

### In the console

- **A Brands tab** (`/catalog/brands`, after Products):
  - each brand by name, with its slug and how many products have it;
  - "New brand" and Edit open a form. The slug's hint says what an empty slug becomes;
  - Super Users see Delete. The dialog checks first whether any product still has the brand. While one does, it can only be kept.
- **The Categories tab is a tree:**
  - each top category, with its subcategories indented under it;
  - each level is put in order by dragging or with the keyboard, on its own. One "Order saved" bar speaks for all of them;
  - the editor's "Inside" offers the top categories, with "(hidden)" after a hidden one. It is locked for a category that has subcategories: "It has subcategories, so it stays a top category: there are only two levels.";
  - a subcategory switched on inside a hidden top category stays "Hidden", and says "Customers see it once Hair Care is shown.";
  - the delete dialog checks for subcategories, its own products, and products shown from other categories.
- **A product's page:**
  - "Brand": "No brand", or one from the list. It is locked until the list loads, and says "Add brands on the Brands page.";
  - "Also shown in": a box for each other category, named as "Hair Care › Hair Oils", with "(hidden)" after a hidden one. At most 5: once 5 are ticked, the rest are locked;
  - choosing a new main category takes it off "Also shown in".
- **The product list:** with one category chosen and nothing else, it shows every product shown in that category at once, in order, ready to drag. A product from another category says "Main category Hair Care › Hair Oils". Before, staff had to press "Show more" until all of them were there.
- **The audit log:**
  - sentences for brands, such as "added the brand Himalaya";
  - the fields "Inside", "Brand", "Also shown in" and "Place in a category it is also shown in";
  - reordering a category's products, those shown from another category too, reads "moved the product".

### The website, until part 15B

- **Unchanged.** It keeps only the fields it knows, so the new ones (`subcategories`, `parent`, `brand`) are dropped, and its pages look as before.
- **Already from the API:** products shown from another category appear in that category's list, and a subcategory's page opens by its address.

## The checks

- **API:**
  - 1163 tests in 109 suites, 90 of them new;
  - the type check and the lint pass;
  - the smoke test has 97 checks. The new one checks that brands are for staff only, and the products' order list joins the product routes customers can't use.
- **On a real PostgreSQL,** in a throwaway container, with every change rolled back:
  - **subcategories:**
    - a category inside itself or an unknown one, refused;
    - a top category with subcategories that can't be deleted;
    - the lock order;
    - a product hidden with its top category;
  - **products shown in other categories:**
    - the place a new one gets;
    - a product shown twice in one category, refused;
    - the shop page's order of its own and shown products, and staff's order with drafts;
    - the locks when ordering;
    - a category still showing a product, which can't be deleted;
    - deleting the product takes its rows with it.
- **The console:** 803 tests, 62 of them new, with Vitest and Testing Library against a fake API. The type check, the lint and the build with its security policy check pass.
- **Deliberate breaks:** 225 of 225 caught, one change at a time:
  - API: brands 30, subcategories 38, other categories 43, where a product goes 12;
  - console: the Brands tab 24, subcategories 44, the product form 34.

  One was caught only once a test was added: saving a subcategory list must bring back the server's order.
- **By hand, by the owner, on 2026-11-24, in the console against the real API.** The owner tried:
  - a brand added and renamed;
  - subcategories added, ordered, and switched on under a hidden top category;
  - a product with a brand and "Also shown in";
  - a category's products ordered with one shown from another category;
  - the delete rules for a brand and a category;
  - the audit log's sentences;
  - the shop unchanged.

  The owner reported it done.

## Consequences

- **Staff can group the catalog** as the reports will: by subcategory, by brand, and with a product shown in more than one category, still counted once.
- **Until part 15B, subcategories have no link on the website.** Its category list shows only the top categories, and a top category's page only its own products. Products in a subcategory are found by search and by their own address. Keep subcategories hidden until 15B is out.
- **Two products created at once in one category may get the same place.** `KEY SHARE` keeps the category, not the number. The name then orders them, and staff can drag them apart.
- **A brand used by any product can't be deleted,** drafts included. Staff choose another brand, or none, for each one first.
- **More than two levels** would need the shop, the console and the reports to change. The owner chose two.
- **Sales already made** keep no brand or category. Snapshots start with part 15C, so a sale from before can't be reported by them.

## Alternatives considered

- **A product in several categories with none main.** Reports would have to split a sale, or count it twice. The owner chose one main category.
- **Brand as text typed on each product.** Simpler, but "Himalaya" and "Himalaya Herbals" would become two brands in the reports. A list kept by staff spells each one once.
- **Categories nested to any depth.** It would need recursive queries and a deeper menu. The owner chose two levels.
- **A subcategory's products listed on its top category's page by the API.** It would mix two orders, and page them together. The API gives each category its own list, and the website loads each subcategory's products on its own, in 15B.
- **The console working out a new product's place, as before.** It needs every product of the category, now including those shown from others, and two staff could still pick the same number. The API works it out in the same transaction as the save.
- **Suppliers and India Post's divisions.** Not wanted by the owner.
