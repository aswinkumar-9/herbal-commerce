# 0039. The customer website: browsing the shop

- Status: Accepted and implemented (part 14A), changed in part 14B (see "Changed in part 14B")
- Date: 2026-11-20

## Context

Since part 4 the API serves the shop to anyone, without signing in: the active categories, each category's live products, each product's page, and since part 11 the search (ADR 0020 to ADR 0023, ADR 0030). Since part 13 the design system holds the shop's own look (ADR 0036), and the website's design rules are kept in `apps/web/.claude/skills/landing-page-design/`. There was no website to show any of it.

The owner made these choices on 2026-11-20:
- **Pages made on the server,** so that a link shared on WhatsApp, or found on Google, shows the product: its name, its words and its photo. React Router 8 (8.5.1, as in the console) in framework mode, on a small Node server.
- **Browsing first.** Part 14 comes in four pull requests: 14A browsing (home, categories, search and filters, product pages, with no sign-in), 14B the account, 14C the cart and checkout with Razorpay in test mode, 14D the customer's orders.
- **The pictures are the owner's own:** four pictures given on 2026-11-20, for the home page's first screen (one wide, one tall for a phone held upright), its story band, and beside its tagline.
- **The accent is saffron gold,** picked from those pictures; **the name is "Herbal Commerce"** until the owner confirms another; **the tone is calm and premium.**
- **The facts the website may state:** made in India, AYUSH licensed Ayurveda, tested in a lab, from the owner's own fields or makers. Prices include GST and delivery is free from ₹499 (₹49 below), as decided in part 7 (ADR 0026).

These defaults were chosen during development and told to the owner, who could overrule them:
- 24 products to a page of the shop: four rows of a wide screen's grid, three or two on smaller ones. At most 100 pages, the most the API gives.
- A category's page adds its next 24 products below with "Show more", instead of pages.
- A product's packs are listed, each with its price, MRP and stock, but not chosen: choosing a pack belongs with "Add to cart", in 14C, so the page has no button that does nothing yet.
- Searches, filtered views and later pages of a list ask search engines not to list them. The whole website does too, until the shop goes live (`WEB_INDEXING`).
- Still to be confirmed by the owner: the home page's wording "We grow and make what we sell" and "we make and pack them ourselves".

## Decision

### The server and the pages

- **`apps/web`**, React Router 8.5.1 in framework mode, with `ssr: true`. `server.ts` starts an Express 5 server (`server/app.ts`): in development with Vite's live reload inside it, in production from the build (`pnpm web:build`, then `pnpm web:start`). It runs at http://localhost:3001, the address the API's emails already use (`WEB_BASE_URL`).
- **The pages** (`app/routes.ts`):
  - `/`, the home page: the owner's picture across the first screen, with the words on a dark veil that rises behind them, one gold pill to the shop, four promises, the story band, the tagline that lights up word by word, how buying works, the categories, seven questions and answers, and the same pill again;
  - `/shop`, every product on sale: searched by words, filtered by category, type and price, sorted, 24 to a page, products in stock first;
  - `/categories/:slug`, a category's products in the order staff chose, with "Show more";
  - `/products/:slug`, a product's own page: its photos, its packs, what it is and how to use it, and its licence and maker;
  - any other address, the "not found" page, with the status 404;
  - since part 14B, the policy pages (ADR 0040), and signing in, signing up and the customer's own page (ADR 0041). Every page sits in one layout route, `routes/pages.tsx` (see "Changed in part 14B").
- **Everything works without a script.** The search is a plain `GET` form, the sort list belongs to it through its `form` attribute and has its own button inside `<noscript>`, "Show more" is a link to `?after=`, and a product's thumbnails are links to `?photo=`. With a script, a choice from a list shows its results at once, the page stays where it was and the keyboard stays on the list; "Show more" adds the products in place and puts the keyboard on the first one added; a thumbnail swaps the photo in place.
- **Windows:** `server.ts` and the build check start from the folder's real name (`realpathSync.native`), as a lowercase `c:` made Node load React twice.

### How the website asks the API

- **Only the website server asks the API** (`app/api.server.ts`): a browser never does, so the API needs no CORS. Each answer is checked against what the page expects (zod) before it is used.
- **What the page says:** the API's 404 makes the page "not found" (404). Anything else (busy, resting, unreachable, slower than 8 seconds, a redirect, an answer not as expected) makes it "The shop is taking a short break" (503), with the API's `Retry-After` or a minute. The reason goes to the server's log, which names the path only: search words never reach it.
- **The customer's IP goes along,** for the API's rate limits: the server removes any `x-herbal-client-ip` a visitor sent, writes its own from what it saw (believing only the proxies `WEB_TRUST_PROXY` names), and the page code passes it on as `X-Forwarded-For`.
- **The API is never asked what it would refuse** (`app/shop-search.ts`). The shop's address is read with the API's own rules: words of 2 to 100 characters with each run of spaces made one, prices in whole rupees up to ₹10,00,000 with the lowest not above the highest, a known type (by its own keys only, never one every object has), "best match" only with words, pages 1 to 100. A wrong word or price is said beside its field and left out; a wrong category, type, order or page, which only an edited address can hold, is dropped quietly, and so is a category no longer on show. The address uses friendly names (`?q=tulsi&type=ayurvedic-medicine&min=100`) and leaves out the usual order.
- **Photos only from the media address.** A card's photo, and both files of a product's photo, are kept only if, read as the browser would read them (`/../` worked out), they sit under `WEB_MEDIA_BASE_URL`. Any other is left out: the page shows a leaf rather than a broken picture or a request to another site.

### Security

- **A policy for each page, with its own nonce** (`app/security-headers.ts`, `app/entry.server.tsx`): `default-src 'none'; script-src 'self' 'nonce-…'; style-src 'self'; img-src 'self' <media address>/; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types 'none'`. Only React Router's start-up data is inline, and it carries the nonce. No inline style anywhere: motion uses CSS classes, the element's style object, or the browser's animation calls. In development Vite needs inline code, so the policy is left out there.
- **Every answer** carries `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin` (`no-referrer` until part 14B: see "Changed in part 14B"), a closed `Permissions-Policy`, `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy: same-origin`, `X-Robots-Tag: noindex, nofollow` until `WEB_INDEXING=on`, and HSTS over HTTPS. Pages are `private, no-cache`; the built files under `/assets` are kept a year, as their names change with them. Since part 14B the rules for every answer are in "What may be kept, and where" below. Files and data answers have their own policy, `default-src 'none'; frame-ancestors 'none'`.
- **The theme's first step** runs in `<head>`, before the stylesheet, so a dark choice never flashes white (ADR 0036). Until part 14B it was a file of its own; since then it is written into the page, under the page's nonce.
- **Text is always text:** React writes every value from the API as text, and the linter refuses `dangerouslySetInnerHTML`, `eval` and `javascript:` links.
- **Google's product data is written into the page itself** (schema.org microdata: `itemscope`, `itemprop`), not as a JSON-LD script. Under Trusted Types, React cannot make a script element when a customer moves to a product page without a full reload: it would need `innerHTML`, which the policy refuses.
- **The build is checked** (`scripts/check-build.ts`, part of `pnpm web:build`): it starts the built website with a stand-in for the API and reads the home page, the shop, a search, a category, a product, "not found" for an unknown address, category and product, and the home page while the API is busy (503). Each must have its own policy with a fresh nonce and nothing loose in it, every inline script must carry the nonce, nothing may be styled inline, every picture must come from the website or the media address, and no source map or `data:` address may be published.

### The settings

Every setting has a default for a laptop, so `pnpm web:dev` needs none. The server checks them as it starts and refuses a bad one. An address must be plain `http` or `https`, with nothing that could change the policy it is written into, and in production `https`, except on `localhost` or `127.0.0.1`.

| Setting | Default | What it is |
|---|---|---|
| `WEB_HOST` | `localhost` | Where the website listens |
| `WEB_PORT` | `3001` | Its port: the API's `WEB_BASE_URL` |
| `WEB_ORIGIN` | `http://localhost:3001` | The website's own address, for link previews and search engines |
| `WEB_API_URL` | `http://127.0.0.1:3000` | The API, as the website server reaches it |
| `WEB_MEDIA_BASE_URL` | `http://127.0.0.1:3000/media` | Where product photos come from: the API's `MEDIA_BASE_URL` |
| `WEB_TRUST_PROXY` | none | Proxies allowed to report the customer's IP, comma separated |
| `WEB_INDEXING` | `off` | `on` lets search engines list the website: only the live shop |
| `WEB_SESSION_SECRET` | a random one on a laptop | The key that seals customers' sign-in cookies, at least 32 characters: needed by the built website (since part 14B, ADR 0041) |
| `WEB_API_CACHE_SECONDS` | `60` built, `0` on a laptop | How long the API's public answers are kept, 0 to 600 seconds (since part 14B) |

### The look and the motion

- **The shop's look from the design system** (ADR 0036), with saffron gold added on 2026-11-20 (`packages/design/src/looks/shop.ts`): the gold pill for a page's one main action, with dark text (7.2:1), a deeper gold for links and chosen states on light, and a lighter one on dark. The menu bar's glass carries only main text; the page you are on sits on a solid chip. A new `scrim-rise` utility puts a dark veil behind a block of words on a picture, whole behind every line however many they wrap to. The design system's tests check every pair (149 tests).
- **The owner's pictures** stay outside the repository; `pnpm --filter web art` makes WebP copies in two widths and a 1200 × 630 JPEG for link previews (`app/art/`), with the API's `sharp`.
- **Motion:** the first screen rises into place as the page opens (CSS). Below it, each part rises 32 px and fades in over 700 ms on the shop's curve as it comes into view, once, 60 ms apart, watched by one shared `IntersectionObserver` (`app/motion.ts`). A part already in view is left as it is. The tagline's words light up one by one as they rise past a line 40% above the foot of the screen. A chosen photo fades in over 300 ms. While results load, cards' shapes pulse gently. When the device asks for less motion, nothing moves: parts only fade, the tagline is simply shown, the shapes stay still.

### Search engines and link previews

- **Every page names itself** (`app/seo.ts`): its title, its description, its own whole address (`canonical`), and Open Graph and Twitter tags with a picture at a whole address. The home page, the shop and categories show the owner's picture; a product shows its own main photo with its size and description, says it is a product (`og:type`), and gives its lowest price in rupees.
- **A view of another page** (a search, a filter, a later page of a category) says `noindex, follow` and names no canonical address. A product's `?photo=` view names the product's own address.
- **A product's page** is marked up for Google from what it shows: the product, its name, address, photos, description, maker and country of origin, and each pack as an offer with its SKU, its price in INR, and whether it is in stock.

## Changed in part 14B

### A page that can't be made shows inside the site

- **Every page sits in one layout route** (`routes/pages.tsx`, in `app/routes.ts`), and its error page shows "not found", "short break" or "something went wrong" inside the site's frame. The root's own error page is left only for a frame that can't be made.
- **Why:** until then the root's error page took the page's place. A link within the site to a page that couldn't be made, such as an unknown single word (404) or any page while the API rested (503), made React draw the whole document anew. Doing so it makes `<script>` elements (the theme's step, React Router's scripts and its scroll restoration) through `innerHTML`, which Trusted Types refuses, and **the page went blank.** Typing the address had always worked, as the server made the page, so only the run against the real API in part 14B, step 7, found it.
- **Checked:** a test follows a link to a page that is "not found" and counts how often the frame is made: once inside the layout, twice without it. Headless Chrome follows links to a "not found" and a "short break" page with no policy violation.

### Speed, after a Lighthouse audit on 2026-11-22

- **Pictures:** the owner's pictures as WebP at quality 68 with Sharp's photo preset, which looked the same as 78 side by side, with a middle width for each (960 and 1280 pixels), so a phone fetches a smaller file. The first row of product photos is fetched first; the rest wait until they near the screen.
- **Fonts:** Poppins 400, 500 and 600 preloaded from the shop itself (`@herbal/design/shop-fonts`, with `crossorigin`, as fonts are fetched). 700 is not: no text style uses it. The build check makes sure each preload is a file the stylesheet names.
- **Compression** (`app/compression.server.ts`, `scripts/precompress.ts`), with Node's own `zlib`, no package:
  - Brotli, else gzip, else none, as the browser asks;
  - the built files compressed once at Brotli's best when the website is built, each copy kept only if it saves 10% or more;
  - pages and their data compressed as they are sent, at a quicker level.

  No secret ever shares a compressed answer with words a visitor chose: the session stays in its cookie, and each page's nonce is new. So compression gives nothing away (BREACH). The built files went from 512 kB to 139 kB.
- **Code split** into React's and React Router's own files, beside each page's (`vite.config.ts`), so a release of the shop leaves them cached, as the console does (ADR 0031).
- **The theme's step inline,** under the page's nonce (`scripts/theme-init-plugin.ts`, ADR 0036): the file, fetched last, had held a phone's first paint back by about 300 ms. The build check makes sure it carries the nonce and comes before the stylesheet, and that no theme file is left.
- **The API's public answers kept for a minute** (`app/api.server.ts`):
  - only the catalog and the policy pages, asked with no customer's token, never a customer's own;
  - answers `200` and `404`, never a failure;
  - at most 500 addresses, the least recently used going first;
  - two pages asking the same at the same moment share one request.

  `WEB_API_CACHE_SECONDS` sets it: 60 for the built website, 0 on a laptop, so a change in the console shows at once while developing. **Prices, stock and policy pages may lag the console by up to that long**, and a page asked for just before a change keeps the older answer until then. The cart, checkout and orders (14C, 14D) must read afresh.
- **A thin bar at the very top** while the next page loads, shown only after 300 ms, so a quick change never shows it. It is read out as "Loading the page". With less motion asked for, it stands still across the width.
- **The next page fetched ahead:** every link within the site has `prefetch="intent"`, so pointing at it, focusing it or touching it fetches its page's code and data. A test reads every page and fails on a link without it. Chrome (157) reuses a prefetched answer only when it may be kept, so a prefetched data answer that is `200` is `private, max-age=10`.
- **The shop's cards are drawn once,** not again for every letter typed in its search (`memo`).
- **Lighthouse fixes:**
  - the tagline's words not yet lit are `ink-muted`, readable at 4.5:1, rather than the design rules' 25 to 35% (flagged to the owner);
  - the category cards' names are headings in order;
  - the label's list is a proper list.
- **Lighthouse afterwards,** on a phone: home 100, shop 98, a category 99, a product 99, the forms and policy pages 100. The desktop: 100 everywhere. Accessibility and best practices: 100 everywhere. SEO: 100, except the forms, which ask search engines not to list them by design.

### What may be kept, and where

For a CDN in front of the website, when one is chosen, and for the browser:

| What | `Cache-Control` | Why |
|---|---|---|
| Built files under `/assets` | kept a year, `immutable` | Their names change with them |
| Other public files (the icon, `robots.txt`) | kept an hour | |
| Pages and their data, for a visitor | `private, no-cache` | Asked again each time; never shared between visitors |
| A page's data fetched ahead, `200` only | `private, max-age=10` | So the click uses it. A redirect (`202`) or "not found" never is |
| Anything for a signed-in customer | `private, no-store` | ADR 0041 |
| The pages of emailed links | `private, no-store` | They carry a token |
| A missing file, a failure | `no-store` | |

- **Every data answer says `Vary: Cookie`,** so one fetched ahead while signed out is never used after signing in, and `Vary: Accept-Encoding` with compression.
- **A CDN must pass the cookie, and keep nothing marked `private`.** Behind one, `WEB_TRUST_PROXY` names its ranges, such as Cloudflare's, and the API's photos (ADR 0023) move to object storage behind it.

### Signing in brought one change

- **`Referrer-Policy: same-origin`,** not `no-referrer`: with `no-referrer`, a form sent without the page's script carries `Origin: null`, which the website's check for forms from another site refused (ADR 0041). Within the site the full address goes along; to another site, nothing.

### The checks

- **The tests:** 399 for the website when part 14B ended.
- **The build check also** checks the compressed copies, the cache rules above (data answers, signed-in, token pages and a missing file), the font preloads, the inline theme step, and that answers kept from the API are asked once.
- **Headless Chrome** checked, against a stand-in for the API, the loading bar (4), the pages fetched ahead (7) and the theme step (3), besides the account's checks (ADR 0041). On a throwaway database, with the real API, it went through all of part 14B (24).

## Consequences

- A link to the shop, a category or a product shows its words and picture in WhatsApp and to Google, and every page works before, or without, its script.
- The website is a second server to deploy, beside the API: it can't be static files like the console. Every page waits for the API; when the API is busy or away, the page says so with a 503 and a time to try again.
- The API needs no CORS for the website, and the customer's own IP still counts for its rate limits. Once the website is deployed, `WEB_TRUST_PROXY` must name the proxy in front of it, and the API's `TRUST_PROXY` the website server.
- The website stays out of search engines until the owner sets `WEB_INDEXING=on` for the live shop.
- React's nonce option for streamed parts of a page can't be checked by a test yet: no page streams late parts. It is set, and a test will follow with the first page that streams.
- WhatsApp's support for WebP preview pictures can't be checked from here: if a product's preview shows no picture, the API can add a JPEG for previews.
- The tests: 206 for the website (Vitest), and deliberate breaks of the code, each of which must make a test fail: 51 of 52 caught in the foundation (the nonce option above), 24 of 25 in the home page (the 25th changed nothing, as the code it broke had gone), and every one for the shop, the categories and the product page (53 and 30). Headless Chrome checked 64 things under the full policy against a stand-in for the API (the pages, their links, the keyboard, light and dark, phones, less motion, no script, and the way from page to page), and every page against the real API, without a policy violation.

## Alternatives considered

- **Pages made in the browser,** like the console (ADR 0031): simpler to deploy as static files, but link previews and search engines would see an empty page. Refused by the owner.
- **Next.js:** made for this, but larger, with its own server and conventions, and unlike the console. React Router's framework mode keeps one router across both.
- **The browser asking the API directly** for search and "Show more": fewer hops, but the API would need CORS for the website, and the page's policy would have to allow the API's address in `connect-src`.
- **JSON-LD for Google's product data:** the usual way, but under Trusted Types React can't create the script element after the first page. Microdata says the same from the visible page.
- **Choosing a pack on the product page now:** it would show one big price, but a choice that leads nowhere until the cart exists. It comes with "Add to cart" in 14C.
