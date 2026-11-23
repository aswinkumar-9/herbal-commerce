# 0040. Policy pages: written in the console, shown on the website

- Status: Accepted and implemented (part 14B)
- Date: 2026-11-21

## Context

A shop that takes payments needs its policies where customers can read them: privacy, terms, refunds and cancellations, shipping and delivery, and how to reach the shop. Razorpay asks for them before a shop goes live, and the sign-up page has to link to the terms and the privacy policy (ADR 0041). The owner writes them, and changes them over time, without a developer.

The owner made these choices on 2026-11-21 ("add columns … provide me the window from Super User … I can add/update later"):
- **Five pages, a fixed list:** Privacy policy, Terms and conditions, Refunds and cancellations, Shipping and delivery, and Contact us. They are in the website's footer, and the sign-up page links to the first two.
- **Written by a Super User in the console,** in plain text with a few simple marks, beside a live preview of how customers will see it. The website builds its elements from the marks, never from HTML.
- **A draft, then Publish.** Saving keeps a draft only Super Users see; Publish puts it on the website. Every published version is kept, with who published it and when.
- **The developer never writes the legal text.** Until a page is published, the website says it is still being written.

## Decision

### The text and its marks

- **Plain text, three marks** (`packages/design/src/text-marks.ts`, shared by the console's preview and the website, so both read a page the same way):
  - a blank line starts a new paragraph, and a single line break stays a line break, as in an address;
  - a line starting `## ` is a heading;
  - a line starting `- ` or `• ` is an item of a list, and items in a row make one list.
- **Nothing else is read:** `<b>`, `**`, a link or a script stays text, written as it was typed. A page can't carry HTML, so there is nothing to clean.
- **At most 30,000 characters,** which fits the API's 100 kB limit for a request even at three bytes a character, as in Hindi. Line ends are made Unix ones, the ends are trimmed, and hidden control characters (pasted from a document) are refused with "The text has hidden control characters: paste it as plain text".

### The API

- **Two tables** (migration `20261121120000_policy_pages`, written by hand):
  - `policy_pages`: one row per page, made the first time it changes. It holds the draft, when and by whom it was saved (all three or none), and a revision that goes up by one on every save, discard and publish;
  - `policy_versions`: every published version, numbered 1, 2, 3 … per page with no gaps, with its text, when and by whom.
- **The database holds the rules too:** only a Super User saves or publishes; a page's revision only goes forward; a version is never changed or deleted (`policies_by_super_users`, `policy_pages_move_forward`, `policy_versions_kept`).
- **For anyone:** `GET /v1/policies/:page` gives the newest version, `404 This page has not been published yet` until the first. A page is `privacy`, `terms`, `refunds`, `shipping` or `contact`; any other word is `404 Policy page not found`.
- **For Super Users** (`/v1/staff/policies`): the list of the five pages, one page with its draft and its newest version, `PUT :page/draft`, `DELETE :page/draft`, `POST :page/publish`, the versions newest first, 20 at a time with `?before=` for older ones (since the paging work in part 14B), and one version with its text. See `docs/api-specification.md`, "Policy pages".
- **No change is lost unseen:** saving, discarding and publishing each name the revision they were made on. If the page changed meanwhile, the API answers `409` and changes nothing, so two Super Users never overwrite each other. Publishing takes exactly the saved draft that was previewed: it refuses a page with no draft, or one the same as the text already on the website.
- **The audit log** gets `policy.draft_saved`, `policy.draft_discarded` and `policy.published`, with the revision, the version and the number of characters, never the text. Saving the same text again is no change and is not logged. In the console's audit log they are the kind "Policy pages".

### The console

- **Policy pages,** in the menu for Super Users only (`/policies`): each page with a chip, "Not written yet", "Draft, not published", "On the website" or "Changes waiting", and the version on the website and the draft, each with who and when.
- **A page** (`/policies/:page`): the box to write in, its count of characters, and beside it "How customers will see it", drawn as the website draws it.
  - **Save draft** keeps the text; **Publish** asks first, naming the version it will be, and is offered only for a saved draft with nothing changed since; **Discard draft** asks first; **Undo my changes** goes back to the saved text.
  - **Changed elsewhere:** when another Super User saved or published meanwhile, the page says so and keeps the words in the box. "Load the newest text" asks first when it would replace words not saved.
  - **The box has no length limit of its own,** so nothing is ever cut off silently: over 30,000 characters, a message says how many to remove, and the draft can't be saved.
  - **Versions,** newest first, with who published each and when; "Read" opens one, and "Show older versions" reads the next 20.
- **The publish dialog says "Customers see the saved draft within a minute":** the built website keeps the API's answers for up to 60 seconds (ADR 0039). It said "at once" until the real API's run in part 14B, step 7, showed the old text right after publishing.

### The website

- **`/privacy`, `/terms`, `/refunds`, `/shipping` and `/contact`** (`routes/policy.tsx`): the title, "Last updated" with the day in India ("21 November 2026"), and the text from its marks: headings, paragraphs that keep their line breaks, and lists. Any other single word is "not found" (404), without asking the API.
- **Not published yet:** "We are still writing this page.", with a way to the shop, and the page asks search engines not to list it.
- **The footer** of every page has "The shop’s policies" with the five links, marking the one open. The sign-up page says "By creating an account, you agree to the Terms and conditions and the Privacy policy.", with both linked.

### The checks

- **API:**
  - 1056 tests when it was added;
  - the database's rules tried against a real PostgreSQL in a throwaway container, 38 of 38;
  - the real service there, with two saves at the same moment: one wins, the other gets `409`;
  - Prisma found no drift;
  - deliberate breaks of the code: 29 of 30 caught. The 30th changed nothing, as the API's input check already refuses what it let through.
- **Console:** 733 tests when the page was added, and 41 of 41 breaks caught. Paging the versions added 3 more.
- **Website:** 221 tests when the pages were added, and 23 of 23 breaks caught. Headless Chrome checked 8 things under the full policy: the text as written, the date, a page not written yet, the footer, the keyboard, dark, a phone, and a fresh nonce on every page.
- **The whole way through, against the real API** (part 14B, step 7, on a throwaway database), in headless Chrome:
  - a Super User signs in with the authenticator code, writes a page with marks and sees the preview;
  - they save the draft and publish it;
  - the website shows it with its heading and list, dated today, with a typed `<b>` still text.

## Consequences

- The owner can write and change the five pages alone, and every version customers were shown stays readable in the console, with who published it and when.
- A published change reaches the website within a minute, not at once. A page someone asked for just before publishing still shows the older text, or "still being written", until the website asks the API again.
- Adding a sixth page means a change to the code and a migration: the list is fixed in the API, the database's type, the console and the website.
- Formatting is deliberately poor: no bold, no links, no tables. A page that needs them (a table of delivery charges, a link to a grievance form) needs a new mark in `text-marks.ts`, which both the console and the website would read.
- The text isn't checked by anyone but its writer. Until each page is published, customers see "We are still writing this page."

## Alternatives considered

- **Markdown or a rich text editor:** more formatting, but HTML (or Markdown turned into it) would have to be cleaned before every page, and a cleaning mistake is a hole in the page. Three marks read into elements need no cleaning.
- **The text in the code:** simplest, but every change would need a developer and a release. Refused by the owner.
- **A content management service:** made for this, but another account, another service to trust with a script on the page, and another place for the shop's data.
- **Publishing without drafts:** fewer steps, but a half-written page would go live with every save.
- **Free-form pages, made and named by the owner:** flexible, but the footer, the sign-up links and Razorpay's checks need these five to exist under known addresses.
