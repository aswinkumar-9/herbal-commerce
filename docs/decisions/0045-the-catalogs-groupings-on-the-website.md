# 0045. The catalog's groupings on the website: subcategories, brands and the shop's filters

- Status: Accepted and implemented (part 15B)
- Date: 2026-11-24

## Context

Part 15A gave the catalog subcategories, brands, and products shown in more than one category, in the API and the console (ADR 0044). The website kept only what it knew: it listed the top categories alone, a top category's page showed only its own products, and no page named a brand. Subcategories had no link in the shop, so staff were told to keep them hidden until part 15B.

The owner's choices:
- **2026-11-23:**
  - a top category's page shows its own products first, then each subcategory's, with links to the subcategories;
  - the shop shows the brand, and filters by it.
- **2026-11-24:**
  - the brand shows **on the product's page only,** as "By Himalaya", a link to the shop filtered by that brand. Product cards stay as they are;
  - the shop's search words find a product **by its brand's name too,** counted as much as its own name.

## Decision

### The API

- **`GET /v1/brands`**, public, for the shop's brand filter:
  - only brands with at least one **live** product: active, in a main category customers see (`SHOWN_CATEGORY`). A brand whose products are all drafts or hidden isn't listed;
  - each brand's name and slug only, by name, without paging;
  - the shop's limit of 600 per minute, like the other public routes.
- **The search's `brand` filter** (`GET /v1/products?brand=himalaya`): one brand, by its slug. An unknown one finds nothing. It is part of the search cache's key, so one brand's search is never answered with another's.
- **The search words find a brand's name:**
  - the raw query joins the product's brand (`LEFT JOIN`), and compares the words with its name;
  - the brand's name counts as much as the product's own name (1.0). The summary counts 0.8 and the description 0.6, as before;
  - the words are still one bound parameter;
  - a product without a brand is found by its own words, as before;
  - "himalaya", or "himalya" with its typo, finds Himalaya's products.
- **No migration.** The API specification is v0.36.

### A category's page

- **A subcategory's trail** passes through its top category: Home › Shop › Hair Care › Hair Oils.
- **A top category with subcategories:**
  - under its name, a pill link to each subcategory, in the order staff chose: "Sections of Hair Care" to a screen reader. These links show on every page of its list;
  - next, its own products, with "Show more" as before;
  - then, on its first page only, a section for each subcategory:
    - its name, as a heading;
    - "See all Hair Oils", a link to its page;
    - its first 4 products, one row on a wide screen (`PREVIEW_SIZE`).
- **How the website asks:**
  - it asks for the category's own page first, as that names the subcategories;
  - then it asks for each subcategory's first 4 at the same time;
  - a subcategory hidden meanwhile (`404`), or one with no live products, gets no section;
  - a later page (`?after=`) asks for the category's own products only.
- **A top category with no products of its own** goes straight to its sections. "Nothing here yet" shows only when it has nothing at all.

### The shop

- **The category list:**
  - a top category with subcategories is a group under its name;
  - the group's first choice is the top category whole, "All Hair Care": its own products, its subcategories' products, and those shown in it from other categories;
  - then come its subcategories;
  - a top category without subcategories stays a plain choice.
- **The brand list:**
  - the brands from `GET /v1/brands`, by name. The website asks for them at the same time as the categories;
  - it is hidden while no brand has a live product;
  - a choice shows its results at once, like the other lists.
- **The address:**
  - `?brand=himalaya` is read like the category: it must be a slug;
  - a brand or category the shop no longer lists is dropped quietly, like any other out-of-date part of an address;
  - a subcategory's slug is kept.
- **The chips:** a subcategory or a brand gets its own chip, which takes it away. "Clear filters" takes the brand away too, and the count of filters in use includes it.
- **The layout:** the filters are three across on a wide screen, with "Show results" beside the prices.

### A product's page

- **The trail** passes through the top category: Home › Shop › Hair Care › Hair Oils › the product.
- **"By Himalaya"** sits under the name:
  - the brand's name is a link to `/shop?brand=himalaya`;
  - search engines read it as the product's brand: schema.org `Brand`, with its name, in the page's microdata;
  - a product without a brand shows nothing there.

### What the website checks

- **Every answer is checked before use, as before:**
  - the categories with their `subcategories`;
  - a category's page with its `parent` and `subcategories`;
  - a product's `category.parent` and `brand`;
  - the list of brands.

  A slug must look like a slug, so a brand's slug from the API can only ever make a link into the shop. An answer that isn't as expected makes the page say the shop is taking a short break (`503`).
- **`apiFind`, for an answer that may rightly be missing,** now takes a query too, for the subcategories' first products.

### Unchanged

- **The home page** still lists the top categories only. Each one's page leads on to its subcategories.
- **The security policy and the caches are unchanged.** The brand list and the subcategories' first products are public answers. Like the others, the built website keeps them for a minute.

## The checks

- **API:**
  - 1166 tests in 110 suites, 3 of them new;
  - the type check and the lint pass.
- **The search's query on a real PostgreSQL,** in a throwaway container, with every change rolled back:
  - "himalaya" found a Himalaya product, scored 1.00;
  - "himalya", with its typo, found it too;
  - a product without a brand was found by its own words;
  - a brand with only a draft and a hidden product found nothing;
  - SQL typed as words found nothing.
- **The smoke test: 98 checks.**
  - **Four were stale since part 15A,** which changed the shop's answers without running the smoke test.
  - **They now:**
    - read the subcategories;
    - walk every subcategory's page;
    - expect a product's `brand`;
    - accept a top category's products found in its subcategories.
  - **New:** a check for `GET /v1/brands`, and the brand filter and a brand's name added to the filter check.
  - **Run by the owner** against the running API.
- **Website:**
  - 565 tests, 24 of them new;
  - the type check and the lint pass;
  - the build check passes. Its stand-in API now has a subcategory and a brand, and it opens the subcategory's page and the shop filtered by both.
- **Deliberate breaks:** 56 of 56 caught, one change at a time:
  - the API, 14;
  - the category pages and the trails, 19;
  - the shop and the product page, 23.

  Seven were caught only once a test was added:
  - the search cache's key without the brand;
  - the brand's name counted at 0.8;
  - the subcategory links shown only for two or more;
  - a product's brand that isn't as expected taken as none;
  - a brand's slug not checked;
  - a top category with one subcategory left out of the groups;
  - the brand list not showing the address's brand.
- **Headless Chrome, 22 checks,** on the built website under its full policy, against a stand-in API:
  - a top category's links, own products and sections, and one with nothing of its own;
  - a subcategory's trail;
  - a product's trail and brand;
  - the shop's groups, brand list and chips;
  - choosing a brand;
  - following "By Dabur" to the shop.

  Each was checked at 1280 and 390 wide, in light and dark. There were no policy violations, no console errors and no sideways scrolling.
- **By hand, by the owner, on 2026-11-24,** in the console and on the website against the real API:
  - a top category with three subcategories, one of them empty;
  - "See all" and the trails;
  - "By Himalaya" leading to the filtered shop;
  - the category groups, the brand list without a brand that has no live product, and the chips;
  - searching for "himalaya" and "himalya";
  - hiding a subcategory, then its top category.

## Consequences

- **Customers can shop by subcategory and by brand.** Staff no longer need to keep subcategories hidden (ADR 0044).
- **A top category's first page asks the API once more for each subcategory.** Each ask counts against the customer's 600 a minute, as their IP goes along. In production the website keeps the answers for a minute, so a busy page costs little. If a category ever has many subcategories, one API answer with every subcategory's first products would save the asks.
- **A new brand appears in the shop's filter only once one of its products is live.** An old link to a brand no longer listed shows the shop without that filter.
- **Product cards don't name the brand,** by the owner's choice. It can be added later without changing the API: the search would need to give each card its brand.
- **The home page doesn't list subcategories.** If the owner wants them there, the categories' list already has them.

## Alternatives considered

- **The API giving a top category's page with each subcategory's first products in it:** one ask instead of several, but a shape made for one page, and two orders mixed in one answer (ADR 0044). The website asks for each one.
- **One flat list of categories in the shop, as "Hair Care › Hair Oils",** as the console does: long names, and the arrow is read aloud oddly. Groups are read as groups.
- **The brand on every product card:** not chosen by the owner.
- **A page of its own for each brand** (`/brands/himalaya`): the shop filtered by brand already does this, with the words, the other filters and the order, and needs no new page.
- **Brand names left out of the search:** a customer typing a brand would find only products that mention it in their own words. The owner chose to search them.
