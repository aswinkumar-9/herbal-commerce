# 0033. Pack sizes and images in the console

- Status: Accepted and implemented (part 12C)
- Date: 2026-11-18

## Context

Part 12B gave the admin console its catalog pages: categories and products, each product on its own page (ADR 0032). A product still couldn't go live from the console, because it needs an image, and its pack sizes and photos could only be managed by hand with PowerShell. Part 12C brings both to the product's page. Stock follows in 12D.

The owner made these choices on 2026-11-13:
- **Pack sizes and images are two more sections on the product's page,** after "In the shop". Each saves on its own, apart from the product's details.
- **Both are ordered by drag and drop and the keys,** as in 12B. The first image is the main photo.
- **A pack size is added and changed in a dialog,** like a category.
- **Several images are uploaded at once,** chosen or dropped, each with its own progress and a way to try again.

The API lacked two things these sections need:
- saving a new order of a product's pack sizes, or of its images, in one request (each row could only be moved on its own);
- a sensible place for a new image. It always got position `0`, so once staff had ordered the images (`0`, `1`, `2`…), a new one landed second, just after the main photo.

These defaults were chosen during development and told to the owner, who could overrule them:
- a new pack size and a new image go last;
- the files go one at a time, in the order chosen;
- a chosen file shows its name and size, not a preview;
- a pack size can be taken off sale from its row, with a switch;
- a live product with no pack size on sale shows a warning, as customers can't buy it;
- an image without a description is called "Image 1", "Image 2" and so on, in the order the images were added, and keeps its name as it moves.

## Decision

### The API

- **`PUT /v1/staff/products/:productId/variants/order`** with `{ "ids": [...] }`: every pack size of the product, off sale ones too, each once, first to last. At most 100.
  - The product is held (`FOR KEY SHARE`), so it can't be deleted meanwhile. An unknown product is `404`.
  - Its pack sizes are locked in the order of their IDs, as everywhere (ADR 0019), with `FOR NO KEY UPDATE`. Stock movements, carts and orders, which point at the pack sizes, are not held up.
  - The list must be exactly the product's pack sizes. Otherwise the answer is `409`: "The product's pack sizes changed while you were ordering them. Reload and try again."
- **`PUT /v1/staff/products/:productId/images/order`** with `{ "ids": [...] }`: every image of the product, each once, first to last. At most 6.
  - The product is locked as an upload or a deletion locks it (`FOR UPDATE`), so no image is added or deleted while the order is saved.
  - Its images are locked in the order of their IDs.
  - The list must be exactly the product's images. Otherwise `409`: "The product's images changed while you were ordering them. Reload and try again."
- **For both:**
  - each row's position becomes its place in the list;
  - only the rows that moved are written, each with its own audit entry (`variant.updated` or `image.updated`), holding the position before and after, all in one transaction;
  - the answer is the whole list, as now saved;
  - they are for Admins and Super Users, like the rest of pack sizes and images. The 600 per minute baseline limits them.
- **A new image goes after the last one:** its position is one more than the highest, at most 9999, or `0` for the first. The count and the highest position are read together, after the lock on the product.

### Pack sizes on the page

- **A list in the order customers see,** each row with its name ("100 ml", "60 capsules"), SKU, price and MRP, an on-sale switch, Edit, and Delete for Super Users.
- **The dialog** has the quantity and its unit, the SKU, the MRP and the price, and "On sale".
  - It checks what the API checks before sending: whole rupees up to 10,00,000, and the price never above the MRP. A price like "499.50" is refused. "₹1,000" and "1,000" are taken.
  - The API's clashes, a SKU or a size taken, mark their own field.
  - A change sends only what changed.
  - A new pack size goes last: the console sends the position after the highest.
- **Deleting** says what is lost, and offers "Take it off sale instead". A pack size that still has stock can't go: the API says so, and the dialog shows it.

### Images on the page

- **A list, the main photo first,** each row with its thumbnail, its name, "Main photo" on the first, Describe and Delete. "N of 6" shows how many there are.
- **A box takes the files,** dropped on it, or chosen with "Choose images". The browser's own file picker sits behind a label that looks like a button, so the keyboard reaches it.
- **Each file is checked before it is sent,** so a mistake shows at once: JPEG, PNG or WebP, at most 10 MB, not empty. A HEIC photo from an iPhone gets its own hint. The API still checks everything.
- **The files go one at a time, in the order chosen.** So the images arrive in that order, and one person never fills the API's queue of images being checked (2 at once, 10 waiting).
  - Each row shows its progress, as a bar and as a `<progress>` that screen readers announce.
  - Cancel stops a file on its way, or one still waiting. Once all of it is sent, the row says "Checking the image…", and Cancel goes: the API's work can't be called off.
  - "Try again" is offered only when trying again may help: no connection, a timeout, too many uploads, or the server's problem. A file the API refuses, too small or not an image, says why, and offers only Remove.
  - Each new image goes into the list as it arrives.
  - When the files on their way fill the last places, the picker goes, and a note says why.
- **Uploads go through `XMLHttpRequest`,** as `fetch` can't report how much of a body has gone. It keeps the same rules as every other call (`apiUpload` in `src/api/client.ts`):
  - the API's own origin only;
  - the access token renewed once on `401`;
  - the answer checked with zod;
  - the file's own type as the `Content-Type`.
- **No preview of a chosen file.** Its name and size are shown instead, and the real thumbnail a few seconds later. A preview would need `blob:` in the page's `img-src`, and the policy stays as strict as it is (ADR 0031).
- **A file dropped beside the box is turned away** while the section is on the page: a "no drop" pointer, and nothing happens. Otherwise the browser opens the photo in the tab, in place of the console, and unsaved changes are lost. Text dragged on the page still works as usual.
- **Describe** opens a dialog for the description, up to 150 characters. Empty removes it.
- **Deleting** is for Admins too (ADR 0023). A live product's only image can't go: the dialog says why and offers only Close, and the API refuses it too.

### Leaving the page

- **One guard for the whole page.** React Router asks only the newest guard (`useBlocker`), and warns about a second one. So a dialog with its own guard hid the page's: with the pack size dialog open, Back lost the product's unsaved changes.
- **The page keeps the only guard,** and the parts of it that hold changes of their own report to it through `useUnsavedPart`, inside `UnsavedParts` (`src/components/unsaved-changes.tsx`):
  - an open dialog with changes;
  - files still waiting or on their way.
- Leaving while files are on their way asks first. Leaving stops them.

### Ordering

- **The same as 12B** (`useReorder` and `useSavedOrder`): the handle, the keys, each move read out, the whole new order sent one request at a time, and the server's order back after a refusal.

### Security

- **The page's security policy is unchanged.** The images come from the API's media address, already in `img-src`, and nothing else.
- **The API's answers are checked:** an image's `url` and `thumbnailUrl` must be `http` or `https` addresses, so a `javascript:` or `data:` address could never reach the page.
- **File names and descriptions are shown as text,** never as HTML.
- **No new packages.**

## Alternatives considered

- **Sending the files in parallel.** Rejected: the images would arrive in a random order, and six large files at once would fill the API's queue for everyone.
- **Previews of the chosen files** through `blob:` or `data:` addresses. Rejected: the page's `img-src` would have to allow them. The real thumbnail shows within seconds.
- **All the files in one request.** Rejected: the API takes one image per request (ADR 0023), and one bad file would fail them all.
- **`fetch` with a streamed body, for progress.** Rejected: not in every browser, and it needs HTTP/2. `XMLHttpRequest` reports upload progress everywhere.
- **One request per moved row,** with the `PATCH` that exists. Rejected, as in 12B: one drag moves many rows, and a failure halfway would leave a mixed order.
- **Each dialog keeping its own guard.** Rejected: the router keeps only one, so the page's was lost.
- **Editing a pack size in its row.** The owner chose a dialog. A row is too narrow for six fields at a phone's width.
- **Making the whole page a drop target for images.** Rejected: a file dropped on the pack sizes would be uploaded as a photo. The box is the only place, and stray drops are turned away.

## Consequences

- **Tests:**
  - **The API:** 920 unit tests in 97 suites, up from 895.
    - Breaking the new API code on purpose 52 ways (49 for the orders, 3 for a new image's place), the tests caught all 52. Four breaks of the route parameters were caught only once new tests checked the pipes on each route.
    - On a real PostgreSQL 17, in a container removed afterwards, 21 checks ran through the real services, each in a transaction that was rolled back. They covered both orders, their audit entries and their `409`s, and that stock can still move while a product's pack sizes are being ordered. A stronger lock, tried on purpose, made the stock wait.
    - The smoke test still has 95 checks. Its checks that customers can't use the staff routes now cover the two new ones.
  - **The console:** 374 tests in 26 files, up from 251 in 22.
    - Breaking its new code on purpose, one way at a time:
      - 43 breaks to the data layer and the upload;
      - 49 to the pack sizes;
      - 66 to the images and the page's guard;
      - 7 to the guard against stray drops.
    - In the end the tests caught every one.
  - **In a real browser:** headless Chrome drove the built console under its full policy and headers, with a stand-in API, and the images on a separate address, as the API's `/media` or a CDN will be. 19 checks covered:
    - a pack size added in the dialog, moved with the keys and a mouse drag, and taken off sale;
    - images moved with a mouse drag;
    - files chosen through the real file picker, and dropped as real files;
    - refusals, a busy server and "Try again";
    - an upload slowed down to show its progress, then cancelled;
    - leaving during an upload;
    - the 6-image limit, a description, and deleting;
    - no sideways scrolling at a phone's width.

    There was no policy violation and no error. An image from another address, added on purpose, was blocked and reported.
  - **By hand with the real API:** still to do before the merge. The checks are in the pull request.
- **A product now goes live from the console.**
- **Lessons:**
  - **A default of `0` works only until staff order the rows.** The new image went second, not last. Positions given by the server now follow the last one.
  - **React Router keeps one guard only.** A dialog's own guard silently replaced the page's. The router's warning in the test output showed it.
  - **A cancelled upload can still fail afterwards.** Its late error must not start the next file, or two would go at once. 30 breaks went unnoticed until one test covered it.
  - **A drop that misses its target goes to the browser,** which opens the file in place of the page. Only a real browser showed it.
  - **A short row must still fit at a phone's width.** A refused file's reason was squeezed to one word per line. Screenshots at 375 pixels showed it.
  - **Prettier on one API file reformats lines nobody touched.** The API's files are formatted by hand.
- **Still open:**
  - stock in 12D, then orders and refunds, then Admins and the audit log;
  - the page for accepting an Admin invitation (ADR 0031).
