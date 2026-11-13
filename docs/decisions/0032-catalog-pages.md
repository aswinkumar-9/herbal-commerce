# 0032. The catalog pages

- Status: Accepted and implemented (part 12B)
- Date: 2026-11-13

## Context

Part 12A gave the admin console its foundation: signing in, the menu and a strict security policy (ADR 0031). Part 12B brings its first pages, the categories and the products, so staff can run the catalog without PowerShell. Pack sizes and images follow in 12C, and stock in 12D.

The owner made these choices on 2026-11-12:
- **A product is edited on its own page** (`/catalog/products/:id`), in sections. It has too many details for a dialog.
- **Staff find products by name** in the product list.
- **The order customers see is set by drag and drop.** The owner chose it over up and down buttons.
- **Deleting asks first, in a dialog that says what is lost.** It suggests hiding instead, and its Delete button is red. Deleting stays for Super Users (ADR 0020, ADR 0021).

The API lacked three things these pages need:
- reading one product (staff could only list them);
- searching products by name;
- saving a new order in one request.

These defaults were chosen during development and told to the owner, who could overrule them:
- a category is edited in a dialog over the list, as it has only four fields;
- a new category or product goes last;
- the product list's filters are kept in the page's address, so the list comes back as it was left;
- the product list shows 100 products at a time;
- products can be ordered only with one category chosen and nothing else filtering the list.

## Decision

### The API

Four additions, all for staff only, and all limited by the 600 per minute baseline:

- **`GET /v1/staff/products/:id`:** one product, drafts too, for its page.
- **`q` on `GET /v1/staff/products`:** words in the product's name.
  - The same matching as the shop's search (ADR 0030): part of a word or a typo still finds a product.
  - The same rule for the words: 2 to 100 characters, with each run of spaces made one.
  - The closest names come first, on one page of up to `limit`. `nextAfter` is always `null`, and `after` together with `q` is refused.
  - It combines with `categoryId` and `isActive`.
  - It looks at the name only: staff look for a product they know, and the name alone gives the closest matches.
- **`PUT /v1/staff/categories/order`** with `{ "ids": [...] }`, and **`PUT /v1/staff/products/order`** with `{ "categoryId": "...", "ids": [...] }`: the whole new order in one request.
  - The list must hold every category, or every product of the category, drafts too, each once. Otherwise the answer is `409`, saying the list changed and to reload. A row added, moved or deleted while staff were ordering would otherwise fall outside the order.
  - Every row is locked in the order of the IDs, as everywhere (ADR 0019). The lock (`FOR NO KEY UPDATE`) still lets a product be added to a category while the categories are being ordered. For products, the category is held too (`FOR KEY SHARE`), so it can't be deleted meanwhile.
  - Each row's position becomes its place in the list. Only the rows that moved are written, each with its own audit entry (`category.updated` or `product.updated`) holding the position before and after, all in one transaction.
  - The answer is the whole list, as now saved.

### The pages

The menu's Catalog area has two tabs, Categories and Products. The line under the open tab slides to the next one.

- **Categories** (`/catalog/categories`):
  - the categories in the order customers see them;
  - a switch on each row shows or hides a category at once, and a note says so;
  - "New category" and Edit open a dialog;
  - Delete is there for Super Users only.
- **Products** (`/catalog/products`):
  - a search box, which searches once typing pauses for 300 ms, or at once with Enter, and needs 2 characters;
  - a category filter and a status filter (live or drafts);
  - 100 products at a time, and "Show more";
  - each draft says how many details it still needs to go live.
- **A product's page** (`/catalog/products/new`, and `/catalog/products/:id`):
  - four sections:
    - Basics: the name, category, slug and the texts;
    - Label details: the type, licence, manufacturer, address, country and ingredients;
    - Tax: the HSN code and the GST rate;
    - In the shop: whether customers see it.
  - **A save bar stays at the bottom of the window.** It says what is wrong or that changes are unsaved, and holds "Save changes" and "Discard changes".
  - **"Products" at the top goes back to the list** with its filters as they were left.
  - **The page makes the API's checks before sending:** the name, the category, the slug, the licence's characters, an FSSAI licence's 14 digits, the country, the HSN code, and the details needed to go live. So most mistakes show at once.
  - **The API's refusals mark their own fields.** The focus goes to the first field to fix.
  - **A new product is always a draft.** When going live is refused for want of an image, the switch says "Add an image first: a live product needs at least one." Images arrive in 12C.
  - **A change sends only what staff changed since the page was loaded or last saved.** A change someone else saved meanwhile is not undone. Typing done while a save is on the way is kept.
  - **A new product, or one moved to another category, goes last in that category.** The page reads the category's products first, to find the last position.
  - **Leaving with unsaved changes asks first:** "Leave without saving?". Reloading or closing the tab makes the browser ask.

### Ordering by drag and drop

- **Motion's `Reorder`,** already part of the console: no new package. A row is dragged by its handle, so the rest of the row can still be clicked.
- **The keyboard works too.** The handle takes the focus:
  - Up and Down move a row one place, and Home and End to the top or the bottom;
  - each move is read out, such as "Hair Care moved to position 2 of 3.";
  - the focus stays on the handle.
- **The screen moves at once.** The new order is sent when the row is dropped, or at each key press.
  - **One request at a time.** Moves made while one is on the way are sent after it, as their latest order only, so an older order can never arrive last.
  - **A refusal puts the server's order back** and says why.
  - "Saving the order…" and then "Order saved" show above the list, and are read out.
- **Products are ordered within one category,** and only when every one of its products is on screen, with no status filter and no search. The API needs the whole list.

### Deleting

- **For Super Users only:** Admins don't see the button, and the API refuses them anyway.
- **The dialog says what is lost.**
  - It offers "Hide it instead" for a category that is shown, or a product that is live.
  - "Delete for good" is red.
  - "Keep it" comes first, and has the focus.
- **A category that still has products can't be deleted.** The dialog checks first and says so.
- **A product that still has stock is refused by the API.** The dialog shows why.
- **After a product is deleted, the product lists are emptied.** So it never shows in a list again, even for a moment.

### The building blocks

- **Buttons** that keep the focus while busy, and can't send a form twice.
- **Dialogs: the browser's own modal `<dialog>`.**
  - The rest of the page can't be reached while one is open.
  - The focus goes back where it was when it closes.
  - Escape and a click outside close it, except while it is saving.
- **Notes ("toasts")** in a region that screen readers read out. They stay longer for errors, and pause under the pointer or the focus.
- **Form fields:** each one's label, hint and error are read out together.
- **A switch** with the `switch` role, which keeps the focus while it saves.
- **React Router's data router** (`createBrowserRouter`), so a page can ask before staff leave it (`useBlocker`).
- **Reading again on failure:** a read is retried once, only when the server could not be reached or had a problem. A change is never sent twice on its own.

### Security

- **An ID from the address bar is used in a path only if it is a UUID.** Anything else is "There is no such product", and no request is sent, so `..` or `/` can never reach the API's path.
- **The filters from the address are checked:** a category must be an ID, a status `live` or `draft`, and the words are read as the API reads them. Anything else is ignored.
- **The page's security policy is unchanged.** Dragging and motion change styles through the DOM, which the policy allows (ADR 0031).
- **No new packages.**

## Alternatives considered

- **Up and down buttons for ordering.** The owner chose drag and drop. The arrow keys on the handle keep it usable without a mouse.
- **A position typed into each row.** Rejected: staff think in "before" and "after", and two rows with the same number leave the order unclear.
- **One request for each moved row.** Rejected: one drag moves many rows. A failure halfway would leave a mixed order. The whole list in one transaction is saved completely or not at all.
- **Saving an order without checking that the list is complete.** Rejected: a product added meanwhile would keep its old position, somewhere among the ordered ones.
- **A drag-and-drop library,** such as dnd-kit. Not needed: Motion, already in the console, has `Reorder`, and the keyboard is handled by the console itself.
- **Editing a product in a dialog.** The owner chose its own page: it has too many details.
- **Searching the summary and the description too, as the shop does.** Not for staff: they look for a product they know by name.
- **Paging a search.** Not needed: staff narrow the words instead, and the 100 closest names are on one page.
- **Sending every field that differs from the server's copy.** Rejected: it would undo a change someone else saved meanwhile.
- **A component library** (ADR 0031 said to revisit it here). Still not: a few small building blocks fit the policy and the motion rules, and are tested with the pages.

## Consequences

- **Tests:**
  - **The API:** 895 unit tests in 97 suites, up from 865.
    - Breaking the new API code on purpose 29 ways, the tests caught all 29.
    - On a real PostgreSQL 17, in a container removed afterwards, 22 checks ran through the real services, each in a transaction that was rolled back. They covered:
      - the search: typos, filters, the name only, and words that look like SQL finding nothing;
      - reading one product;
      - both orders, their audit entries and their `409`s;
      - that a product can be added to a category while the categories are being ordered (a stronger lock, tried on purpose, made it wait);
      - that a second order waits for the first.
    - The smoke test still has 95 checks. Its checks that customers can't use the staff routes now cover the new ones.
  - **The console:** 251 tests in 22 files, up from 77 in 8.
    - Breaking its new code on purpose, one way at a time:
      - 50 breaks to the building blocks;
      - 38 to the categories page;
      - 78 to the products pages.
    - In the end the tests caught every one. The first runs found gaps, which new tests closed. Four breaks were dropped:
      - two showed code that did nothing, and it was removed;
      - one could never fail;
      - one shows only in a real browser.
  - **In a real browser:** headless Chrome drove the built console under its full policy and headers, with a stand-in API answering from sample data. It covered:
    - the list and the search;
    - moving with the keys (the focus stayed on the handle) and a real mouse drag (one order sent);
    - saving a change, and going live refused for want of an image;
    - adding and deleting a product;
    - the dialog closing with Escape and with a click outside;
    - no sideways scrolling at a phone's width.

    There was no policy violation and no error.
  - **By hand, on 2026-11-12 and 2026-11-13,** each step with the real API: ordering with the mouse and the keys, showing and hiding, adding, changing and deleting categories and products, the search and the filters, going live refused, and leaving with unsaved changes.
- **A product still can't go live from the console.** It needs an image, and images come in 12C. Until then, the API's image upload (README, "Manage product images") does it.
- **Lessons:**
  - **React keeps the focus on an element it moves.** The code that put the focus back on the handle after a keyboard move did nothing: the breaks showed no test could tell, and a test that drops the focus as a browser does showed React puts it back. It was removed.
  - **A list kept on screen while the next one loads must never be ordered.** The last category's rows would have been sent as the new one's order. Ordering waits for the real list.
  - **Typing key by key in a test is slow on a busy machine.** A test sometimes paused longer than the search waits. It now puts the words in at once.
  - **The page's title is set just after the page draws.** Tests now wait for it: an older sign-in test failed now and then once the suite grew.
  - **Refreshing lists that read themselves again whenever they open changes nothing.** A break showed it, and those calls were removed. A deleted product is a different case: its lists are emptied, so it can't flash back.
- **Still open:**
  - pack sizes and images in 12C, after which products go live from the console;
  - stock in 12D, then orders and refunds, then Admins and the audit log;
  - the page for accepting an Admin invitation (ADR 0031).
