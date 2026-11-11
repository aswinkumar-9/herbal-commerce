# 0030. Search and filters

- Status: Accepted and implemented (part 11)
- Date: 2026-11-11

## Context

Customers could only browse the shop one category at a time (ADR 0021). Search and filters are in the MVP scope, "PostgreSQL full-text first" (`docs/requirements.md`, section 6). The owner chose this part on 2026-11-11, ahead of returns, the admin console and the customer website, so that the shop's API is complete before the website is built.

Customers type on phones, so they will often type part of a word, or misspell one. Herbal products also have names that are easy to misspell, such as Ashwagandha or Chyawanprash.

The owner made four choices on 2026-11-11:
- **A search looks in the product's name, summary and description.** Not in its ingredients, how to use it, or its maker.
- **It finds parts of words and words with typos:** "ashwa" and "ashwaganda" both find Ashwagandha.
- **The filters are category, product type and price.** Each works without search words too. "In stock only" was not chosen.
- **Out-of-stock products come last,** marked as out of stock, rather than being hidden.

These defaults were chosen during development and told to the owner, who could overrule them:
- the search is public, like the shop, and shows only live products in active categories;
- each result is a card as on a category page, plus whether it is in stock;
- the price filter and the price sort use the product's lowest price on sale, as its card shows;
- the sorts are relevance, price either way, and name;
- search words have 2 to 100 characters;
- searching has its own per-IP limit;
- the search words are never stored or logged.

## Decision

### `GET /v1/products`

| Parameter | What it does |
|---|---|
| `q` | The search words: 2 to 100 characters after trimming, each run of spaces made one. Empty means none. |
| `category` | A category's slug. A hidden or unknown category finds nothing (`200`, empty), never `404`. |
| `type` | `AYURVEDIC_MEDICINE`, `FOOD_OR_SUPPLEMENT` or `COSMETIC` |
| `minPriceRupees`, `maxPriceRupees` | Whole rupees, 0 to 10,00,000, compared with the product's lowest price on sale. The lowest may not be above the highest. |
| `sort` | `relevance` (the default with words, and only with words), `price-asc`, `price-desc`, or `name` (the default without words) |
| `page`, `limit` | Page 1 to 100, and 1 to 50 products a page (default 20) |

The answer:
```json
{
  "products": [
    {
      "name": "Ashwagandha Capsules",
      "slug": "ashwagandha-capsules",
      "summary": "For calm and restful sleep",
      "fromPriceRupees": 449,
      "imageUrl": "http://127.0.0.1:3000/media/products/<key>-small.webp",
      "inStock": true
    }
  ],
  "total": 1,
  "page": 1,
  "nextPage": null
}
```

- **Anyone may search,** signed in or not, as for the shop. A wrong parameter answers `400 Validation failed`, naming the field, such as `Search with at least 2 characters` or `Sorting by relevance needs search words`.
- **Searching has its own limit:** 120 per minute per IP (`search`), as each search weighs every live product. Apps should search after the customer pauses typing, not at every key.
- **A card shows no ID,** as everywhere in the shop: its name, slug, summary, lowest price on sale, main photo and whether it is in stock.

### Finding by words: pg_trgm

PostgreSQL's `pg_trgm` extension compares words by their three-letter pieces ("trigrams"): "ashwa" has the pieces "ash", "shw" and "hwa". A word that shares most of its pieces with a word in the text matches it. So a part of a word, or a word with a typo, still finds the product.

- **A product matches** when the words are like a word in its name, summary or description: `q <% name`, the "word similarity" operator, at its default threshold of 0.6.
- **A match in the name counts most:** the score is the best of the name's word similarity, the summary's × 0.8, and the description's × 0.6.

On sample products, "ashwa" (0.83), "ashwaganda" (0.82) and "aswagandha" (0.64) all found Ashwagandha Capsules, and "chyavanprash" (0.63) found Chyawanprash. "tulasi" scored only 0.44 against Tulsi, so it doesn't find it: an alternative spelling is too far off.

**Three trigram indexes** (GIN, `gin_trgm_ops`) on the name, the summary and the description let PostgreSQL find the matches without reading every product. With seq scans turned off, a test search used all three at once. They are in the schema (`@@index(…, type: Gin)`), so Prisma sees no drift.

### Raw SQL, safely

The matching is the app's first query written in raw SQL, because Prisma has no word for trigram similarity:
- **It uses Prisma's tagged template,** `$queryRaw` with `${words}`, so the words are always a bound parameter, never part of the SQL text. A test checks the six places the words go, and a search for `'; DROP TABLE products; --` on a real database finds nothing and changes nothing.
- **`$queryRawUnsafe` and `Prisma.raw` are never used with anything a client sends.**

### Then everything else, in the API

1. **The matches:** with words, the raw query answers up to 500 product IDs, the best first, with their scores. With no match, the search stops there.
2. **The products:** one Prisma query reads the live products in active categories, filtered by category and type, and by the matches when there are words. It reads at most 500, by name, each with its packs on sale and its main photo.
3. **The stock:** the inventory says which of their packs are in stock (`StockService.inStock`, ADR 0024). A product is in stock when any of its packs on sale is.
4. **The price:** each product's lowest price on sale. A price filter keeps only the products whose lowest price is within it, so never one with no pack on sale.
5. **The order:** products in stock first, then by the sort asked for, then by name (ignoring letter case), then by slug. So the same search always answers in the same order, and its pages never overlap. A product with no pack on sale comes last when sorting by price, either way.
6. **The page:** `total` is how many were found, and `nextPage` is the next page number, or `null`.

**Why in the API, not in SQL:** whether a pack is in stock belongs to the inventory, which keeps its batches to itself (ADR 0001, ADR 0024). Sorting in SQL would mean reading its tables. The shop is small, so reading every match and sorting them in the API is simple and fast.

**When to revisit:** at a few thousand live products. Before then, the 500-product limit never bites. After it, a search engine, or the inventory telling the catalog its stock, would be needed (see "Alternatives considered").

### Search words never reach the logs

What a customer searches for in this shop may tell of their health, such as "piles" or "sugar". So:
- the request log writes the address with `q=[REDACTED]` (`withoutSearchWords` in `logging/logger.config.ts`), and the parsed query's `q` is redacted too;
- the search never stores the words, and its errors never repeat them.

## Alternatives considered

- **PostgreSQL full-text search** (`tsvector`), as the requirements first said. Rejected for now: it finds whole words and their stems, such as "teas" for "tea", but neither parts of words nor typos, which the owner chose. It could be added beside trigrams later, if stems are missed.
- **A search engine,** such as Meilisearch, Typesense or OpenSearch. Not now: it would be another service to run, secure and keep in step with the database, and the requirements defer it. Revisit when the catalog or the traffic outgrows PostgreSQL.
- **Searching the ingredients, the usage or the maker.** Not chosen by the owner.
- **An "in stock only" filter, or hiding out-of-stock products.** Not chosen by the owner: they come last, marked.
- **Sorting and paging in SQL,** with the stock read there. Rejected: the stock belongs to the inventory (ADR 0001). A cursor in the style of the category pages (`after`) would need the same.
- **A 404 for an unknown category filter.** No: a filter that matches nothing finds nothing, and a hidden category stays as invisible as an unknown one.
- **Removing accents** (`unaccent`) and synonyms, such as "tulasi" for "tulsi". Not now: the names are in English letters without accents. Synonyms come with real searches to learn from, which this part never stores.

## Consequences

- **Tests:**
  - 849 unit tests in 95 suites.
  - The search's tests were checked by breaking the code on purpose, one way at a time. Of 51 breaks, the tests caught 50. The one missed was the price order among out-of-stock products: a product with no pack on sale is never in stock, so it always came last anyway. A test now catches it.
  - **Against a real PostgreSQL,** in a throwaway container with a small shop:
    - the matches above, the summary and description searched and the ingredients not;
    - drafts and hidden categories never found;
    - the filters, the sorts and the pages;
    - SQL in the words treated as words.
  - **The migration** applied in a throwaway container, and Prisma found no drift.
  - **The smoke test has 94 checks.** The new ones:
    - bad searches are refused;
    - searching without words lists every live product once, those in stock first;
    - each search card agrees with its category card and product page;
    - a product is found by the start of a word in its name, and with a typo;
    - its category, type and price find it.

    Each new check was broken on purpose too, and failed.
  - **By hand, on 2026-11-11,** on the development API: "ashwa" found Ashwagandha Capsules, and a 1-letter search, relevance without words, and a lowest price above the highest were each refused with their message. That the log hides the words is checked by the unit tests.
- **Results can shift between pages** if stock or prices change between two requests. That is acceptable for a search.
- **Up to 500 products are weighed per search,** so a shop with more live products than that needs this revisited first.
- **`pg_trgm` must be available** on the production database. It ships with PostgreSQL, and is "trusted", so the database's owner can add it without being a superuser.
- **Lessons:**
  - **When a test fails, the assertions after it never run.** One check passed only because the test had already stopped. Fix a failing test, then read every result again.
  - **Check a surprising result against the data before changing the test:** two "wrong" results were the search being right about the seeded text.
  - **Trigrams are forgiving:** "zqagandha" still finds Ashwagandha, as it shares most of its pieces. A test of "not found" needs a word that is truly different.
  - **A smoke test can lose the API** while `pnpm api:dev` restarts after files change. `fetch failed` means it got no answer at all, not a wrong one.
- **Still open:**
  - Hindi and other scripts, accents and synonyms;
  - suggestions as the customer types, and "did you mean";
  - searching inside a category's page, and showing the category on each search card;
  - the website and apps that use the search;
  - a search engine, when the catalog grows.
