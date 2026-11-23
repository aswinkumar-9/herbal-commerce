# 0036. The design system: shared foundations, and a look for the console and one for the shop

- Status: Accepted and implemented (part 13)
- Date: 2026-11-20

## Context

On 2026-11-18 the owner asked for one design system for the console, the website and the apps, planned as a part of its own before the website (`docs/requirements.md`, section 10.2). Part 12E gave the console its look first, glass and clay (ADR 0035).

On 2026-11-20 the owner made clear that glass and clay is for the console only, for Admins and Super Users. The shop will look very different. They gave two references:
- the `landing-page-design` rules from [elayadesign/ai-design-skills](https://github.com/elayadesign/ai-design-skills) (MIT licence): calm, flat and premium, one typeface, big illustrated heroes, pill buttons, a floating glass menu bar, and motion that settles into place;
- a short video of sites in that style.

They chose, the same day:
- **Poppins** as the one typeface, with **English** for now;
- **light or dark as the phone is set,** with a switch on the page;
- **the hero illustrations come from the owner;** nothing is invented or generated;
- **the accent colour is picked from the art later.** Until then the main colour stays neutral.

Until part 13, the console's colours and rules lived in `apps/admin/src/index.css`. A website built next to it would have copied them, and the two would drift.

## Decision

### One package: `packages/design`

The design system is a workspace package, `@herbal/design`. It is private and never published.

| Where | What |
| --- | --- |
| `src/foundations.ts` | What every look shares: the 4 px grid and spacing steps, the type scale and the 26 named text styles, the weights, the corners, the screen widths, the layers, the contrast targets and the names of the colours |
| `src/looks/console.ts`, `console.rules.css` | The console's look (ADR 0035), as data, with its own rules |
| `src/looks/shop.ts`, `shop.rules.css` | The shop's look, as data, with its own rules |
| `src/theme.ts`, `src/theme-init.ts` | The shop's light and dark switch |
| `scripts/build.ts` | Writes each look as CSS for Tailwind 4: `css/console.css` and `css/shop.css` |
| `test/` | 147 tests: the foundations, the CSS being up to date, and every look's contrast |
| `preview/` | A page of the shop's look, for the owner to see and approve |

- **A look is data:** its colours in light and dark, its effects (glass, glow, scrim), its Tailwind theme values (shadows, corners, the font, the curve), its motion, and the colour pairs that must stay readable.
- **The CSS is written from the data** by `pnpm design:build`, and committed. A test fails when the committed file no longer matches its look, so nobody edits it by hand.
- **An app imports its look** after Tailwind: the console's `index.css` is now `@import 'tailwindcss'` and `@import '@herbal/design/console.css'`, plus two rules of its own. Its motion reads `CONSOLE_MOTION` from the package.
- **The same names everywhere:** both looks name the same colours (`canvas`, `surface`, `ink`, `primary` …) and the same text styles (`heading-1` … `caption-5`). A page reads the same in either look, and only the values differ.

### The shared foundations

- **Spacing:** the 4 px grid, and only these steps: 0, 2, 4, 8, 12, 16, 24, 32, 40, 48, 64, 80 and 96 px.
- **Type:** Tailwind's scale, and 26 named styles: headings 1 to 6, titles 1 to 5, body 1 to 6, buttons large to extra small, and captions 1 to 5. Each is one step of the scale with one weight, never thinner than regular or heavier than bold.
- **Corners:** Tailwind's radii only. A shape inside another, less than 32 px in, takes the outer corner less the gap (`nestedRadius`), so the curves run parallel.
- **Screen widths and layers:** Tailwind's breakpoints. The layers run from the page (0) through sticky bars (20) and the menu bar (30) to toasts and the skip link (50).
- **Readable everywhere:** WCAG 2.2 AA. Text keeps 4.5:1. Large text, and the edges and icons a control needs to be seen, keep 3:1.
- **For everyone:** a focus ring always shows, in the look's own colour, and "Reduce motion" turns CSS motion off in every look.

### The console's look moved, unchanged

- **Pixel for pixel:** headless Chrome took 20 screenshots of the console before and after the move, in light and dark, and every one was the same. A change of one unit in one colour was caught, so the comparison could see a difference.
- **One fix, found by the new tests:** the edges of fields, the search box and a switch's track had 1.31:1 against the card, below the 3:1 a control's edge needs (WCAG 1.4.11). A new colour, `line-strong`, gives them at least 3:1. Only the pages with fields changed.

### The shop's look

| What | Value |
| --- | --- |
| Typeface | Poppins in 4 weights (400 to 700), Latin letters only, served by the shop itself from `@fontsource/poppins` |
| Colours, light | A near-white page (`#fafaf9`), white cards, ink `#111111`, and black pill buttons |
| Colours, dark | Only the reference's dark backgrounds (`#131209`, `#1f1f1f`, `#272727`, `#313131`), light ink, and white pill buttons |
| The main colour | Black in light and white in dark, until the owner's art arrives |
| Backgrounds | Flat, never a gradient |
| The hero heading | A gradient on the text, left to right: black to grey in light, white to grey in dark. One solid colour when the device asks for more contrast |
| Glass | The floating menu bar: 72% of the card colour, blurred. Only main text sits on it. The phone menu: 94%, with a stronger blur |
| Text on a picture | It sits on a dark veil (`scrim`, 55% black), whole or from below (`scrim-fade`) |
| Motion | One curve, `cubic-bezier(0.22, 1, 0.36, 1)`. 300 ms under the pointer, 500 ms for layout, 700 ms for a part rising 32 px into view. Menu links arrive 60 ms apart, all within 400 ms |
| Words | Headings balance their lines, and running text avoids a word alone on its last line |

### Contrast is a test

The tests check every pair a look names, in light and dark:
- **text:** ink and muted ink on the page, cards and muted boxes; links; the main button, also under the pointer; errors and warnings;
- **edges and marks:** a field's edge, the focus ring and the accent, at 3:1;
- **the hero heading:** both ends of its gradient, at 4.5:1, though it is large text;
- **glass at its worst:** pure black under it in light, pure white in dark, with every text that sits on it;
- **the veil at its worst:** white text over a pure white picture keeps 4.88:1;
- **motion:** every movement settles within a second, rises at most 32 px on the 4 px grid, and steps at most 0.1 s between items.

Headless Chrome measured the preview page from its pixels too, with the text hidden so only what is behind it counts:

| | Light | Dark |
| --- | --- | --- |
| The menu bar's links, black (or white) under the glass | 9.52:1 | 6.04:1 |
| The phone menu's quiet text, black (or white) under it | 5.63:1 | 5.85:1 |
| White text on the veil, over a white picture | 4.74:1 | 4.74:1 |

### The light and dark switch

- **By default the page follows the device.** A customer may choose light or dark. The choice stays on that device, in `localStorage`, as a preference of the device, not the account, so it works before sign-in too. A choice that can't be read or kept, such as in a private window, simply means "as the device is set".
- **It is set on `<html>` as `data-theme`,** which the shop's CSS reads alongside the device's own setting.
- **It is set before the page is drawn,** so a page chosen dark never flashes white. That takes a plain, blocking script in `<head>`, and the policy forbids inline script. So `src/theme-init.ts` is built on its own as one small file and loaded first (`<script src>`). Chrome showed the theme set at 47.5 ms and the first paint at 112 ms.
  - **Since part 14B the website writes it inline instead,** in `<head>` before the stylesheet, under the page's own nonce (ADR 0039). The same file is built into it (`virtual:herbal-theme-init`), so there is no request to wait for: the file, fetched last, had held up a phone's first paint by about 300 ms. A page with a nonce for every visit can allow one inline script without a hash. The preview page, which has no nonce, still loads the file.
- **The console has no switch:** it still follows the computer (ADR 0035).

### The website's design rules

- The reference's rules are kept, with their MIT licence, at `apps/web/.claude/skills/landing-page-design/`. Claude Code reads them when it works on the website, and only then.
- A section at their top, "In this project", comes first:
  - the owner's choices above;
  - the values come from this package, never invented;
  - never invent art, prices, reviews, ratings or stock;
  - never apply them to the console;
  - the project's rules win where they differ: WCAG 2.2 AA, the security policy, whole rupees, and Phosphor icons after asking the owner.

### The preview page

- `pnpm design:preview` shows the shop's look at http://localhost:5180:
  - the text styles, and every colour with its light and dark value, written from the package's own data so the page can't drift from it;
  - buttons, badges and a form;
  - pictures with text on the veil, and frames where the owner's art goes;
  - a product card, its loading shape, an empty cart and a missing page;
  - the menu bar, the phone menu and the switch.
- **Under the same rules as the console:** the built page carries a strict policy (no inline script or style, Trusted Types, nothing from another site, nothing fetched at all), and `pnpm design:preview:build` checks every build for it.

### Security

- **The fonts come from the shop itself,** bundled from `@fontsource/poppins` 5.3.0 (SIL Open Font License 1.1). The page never asks Google, so the policy stays `font-src 'self'` and customers' addresses never reach another company.
- **The console's policy is unchanged.**
- **New packages:**
  - `@fontsource/poppins` 5.3.0, font files and their CSS only;
  - for the preview only, in development: Vite 8.3.6, Tailwind CSS 4.3.5 and its Vite plugin, the same versions as the console's, so nothing new was downloaded.
- **No exception** to the 3-day minimum release age.

## Alternatives considered

- **Tokens in JSON with a converter such as Style Dictionary.** Rejected: one more tool. TypeScript data and a short script that Node runs directly are simpler, and the same data feeds the tests and the preview.
- **Copying the console's CSS into the website.** Rejected: the two would drift.
- **One look for everything.** Rejected by the owner on 2026-11-20.
- **Fonts from Google Fonts.** Rejected: the policy would have to allow another site, and every visit would tell Google who looked at the shop.
- **An inline script for the theme, allowed by its hash.** Rejected: the build check refuses inline script outright, and one file is as quick. Since part 14B the website does write it inline, allowed by the page's nonce, not a hash, and its build check accepts only that one script with the nonce (ADR 0039).
- **The theme choice on the customer's account.** Rejected: it is a preference of the device, and it must work before sign-in.
- **An accent colour now.** Not yet, by the owner's choice: it is picked from the art.
- **React components in the package.** Not yet: the website's framework isn't chosen. The package holds the foundations, the looks and the theme switch, which any framework can use.

## Consequences

- **Pages use the looks' classes and names,** never a size, a colour, a shadow or a curve of their own. A change to a look goes into `src/looks/`, then `pnpm design:build`, and the tests must pass.
- **The website part** chooses its framework, imports `@herbal/design/shop.css`, loads the theme's first step as a plain script, and asks the owner the reference's intake questions (A1) in one batch first. Phosphor icons are installed then, after asking.
- **The apps,** later, can read the same data: the colours, the spacing, the type and the motion are plain TypeScript.
- **Tests:**
  - the design package: 147 tests, and a type check;
  - deliberate breaks: 23 in the foundations and the console's look, and 20 in the shop's look and the switch. The tests caught every one;
  - the console's 492 tests pass, its build check too, and 20 screens are the same pixel for pixel;
  - **in a real browser:** headless Chrome drove the built preview under its full policy, 65 checks in light and 65 in dark: the contrast above, the fonts from the page's own address, the theme set before the first paint, the switch, the phone menu and its keyboard, the form's messages, no sideways scrolling at a phone's width, less transparency, more contrast, reduced motion, and no policy refusal or page error.
- **Lessons:**
  - **Write a look as data, and its contrast becomes a test.** The tests found the fields' edges at 1.31:1, which had looked fine.
  - **A module script can't stop a dark page flashing white:** it runs after the page has started to draw. A plain script in `<head>` can.
  - **Check a change moves nothing, from the pixels.** The console's move was proven with before-and-after screenshots, not by eye.
