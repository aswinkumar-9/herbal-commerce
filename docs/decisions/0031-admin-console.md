# 0031. The admin console

- Status: Accepted and implemented (part 12A: the foundation)
- Date: 2026-11-12
- Updated: 2026-11-13 (part 12B: the catalog pages, see ADR 0032)

## Context

By part 11 the API had everything staff need to run the shop: categories, products, pack sizes and images, stock, orders and refunds, Admins and the audit log. But staff could use it only by hand, with PowerShell, a token and the README. The requirements put an admin console in the MVP (`docs/requirements.md`, section 6). The owner chose it as part 12 on 2026-11-11, before returns and the customer website.

The console is the project's first frontend. So part 12 starts with a foundation, part 12A: the app itself, staff signing in and staying signed in, the menu, and the security every later page relies on. The pages come after it.

The owner made these choices on 2026-11-11:
- **React with Vite,** a single-page app.
- **Catalog and stock first:** categories and products in 12B, pack sizes and images in 12C, stock in 12D. Then orders and refunds, then Admins and the audit log.
- **A calm herbal green,** in a light and a dark theme.
- **Motion "subtle and quick, as current trends go".**

On 2026-11-12 the owner added one more:
- **Staff are signed out after 30 minutes without activity** in any console tab.

The owner's standing request for every app and website applies too: proper security checks, and motion effects.

These defaults were chosen during development and told to the owner, who could overrule them:
- the console and the API share one origin, so there is no CORS;
- the theme follows the computer's setting, with no switch yet;
- the menu shows the areas still to come, marked "Soon", and each opens a page saying which part brings it;
- a Super User's areas (Admins, the audit log) are hidden from Admins;
- the motion follows the computer's "reduce motion" setting.

## Decision

### The app: `apps/admin`

A second app in the pnpm workspace, beside the API:

| Part | Choice |
|---|---|
| Build and dev server | Vite 8 |
| UI | React 19 |
| Pages | React Router 8: `/sign-in`, then the signed-in console, `/`, `/catalog`, `/stock`, `/orders`, and for Super Users `/admins` and `/audit-log` |
| Data from the API | TanStack Query (from 12B), and zod, which checks every answer |
| Look | Tailwind CSS 4, with the colours as named tokens (`bg-surface`, `text-ink`, `bg-primary` …) in `src/index.css`, for light and dark |
| Motion | Motion (`motion/react`) |
| Icons | Lucide |
| Tests | Vitest, with jsdom and Testing Library |

Every package is pinned to an exact version, and the 3-day minimum release age applies, as for the API (ADR 0008). Root commands: `pnpm admin:dev`, `admin:test`, `admin:lint`, `admin:typecheck`, `admin:build` and `admin:preview`.

### One origin, no CORS

The console calls the API at `/v1/...` on its own origin, never at another address:
- **On a laptop,** Vite serves the console at `http://localhost:5173`. It passes `/v1` and `/media` on to the API at `127.0.0.1:3000`.
- **In production,** the console's files and the API must be served from one origin, too: a reverse proxy sends `/v1` to the API. That is listed in `docs/security.md`, section 6.

So the API needs no CORS, and the staff cookie can be `SameSite=Strict`.

### The staff session in a browser

A browser must not keep a token where a script can read it. So, for the console only:

**The refresh token goes into a cookie the page cannot read:**
```
herbal_staff_refresh=<token>; Path=/v1/staff/auth; Max-Age=43200; HttpOnly; SameSite=Strict
```
`Secure` is added when `ADMIN_ORIGIN` is `https`. The cookie lives 12 hours, like the session (ADR 0014).

**The access token stays in the page's memory only,** never in `localStorage`, `sessionStorage` or a readable cookie. A reload starts without it, and the cookie brings the session back.

**The API uses the cookie only for requests from the console:** those whose `Origin` header is exactly `ADMIN_ORIGIN` (new setting; on a laptop `http://localhost:5173`, and `https` only in production). For those:
- **sign-in** (`POST /v1/staff/auth/login`) answers without `refreshToken`, and sets the cookie;
- **renewal** (`POST /v1/staff/auth/refresh`) takes no body: it swaps the cookie's token, and sets the new one. A refused token answers `401` and the cookie is cleared;
- **sign-out** (`POST /v1/staff/auth/logout`) takes no body: it ends the cookie's session, if any, and always clears the cookie. `204` either way.

Any other client, such as PowerShell or the smoke test, sends no such `Origin` and works as before, with the refresh token in the body.

**Why this resists cross-site requests (CSRF):** the cookie goes only to `/v1/staff/auth/*`, never to another site's request (`SameSite=Strict`), and only with the console's exact `Origin`. And it can only start, swap or end a session. It can't read or change anything: every other route needs the access token in the `Authorization` header, which only the console's own code holds.

The cookie's value is read only if it looks like a refresh token (20 to 200 URL-safe characters), and only the cookie with the exact name counts.

### Signing in and staying signed in

- **Sign-in page:** the email, the password (with a show/hide button) and the 6-digit code, with the right `autocomplete` hints for password managers and phones.
  - The form checks the same rules as the API before anything is sent. The code box takes digits only.
  - Wrong details get one message, "The email, password or code is not right", never which part. The password and the code are then cleared.
  - Too many attempts get "Try again in N minutes", from `Retry-After`.
  - Afterwards staff go to the page they asked for: only a page of the console, never another site (`auth/return-path.ts`), and never back to the sign-in page.
- **On start,** the console renews the session through the cookie, then reads `GET /v1/staff/me` for the name and the role. If the server can't be reached, it says so and offers "Try again" rather than sending staff to the sign-in page.
- **One API client** (`api/client.ts`) for every call:
  - it sends only to `/v1/` paths, with the access token from memory;
  - the browser's cache is never used (`cache: 'no-store'`), and the cookie goes to this origin only;
  - every answer is checked against its zod schema, so a surprise from the server is an error, never a half-read page;
  - a `401` renews the access token once (it lives 15 minutes), and the call is tried again. If the session can't be renewed, the console returns to the sign-in page with "Your session ended".
- **One renewal at a time.** The API ends the whole session when a refresh token comes back after it was swapped, because that looks stolen (ADR 0007). Two renewals at once, from React running its start-up twice in development or from two tabs, would sign staff out. So:
  - calls in one tab share one renewal;
  - tabs take turns through the browser's Web Locks API (`herbal-staff-refresh`), each sending the cookie the previous one set.
- **Sign-out** ends the session on the server first. Only then does the console forget the token and every staff answer it holds (TanStack Query's cache), so staff are never told they signed out while the session is still open. If the server can't be reached, the console says so and stays signed in.
- **Tabs follow each other** through a `BroadcastChannel` (`herbal-staff-session`). Signing out in one tab signs out the others ("You signed out in another tab"). Signing in in one makes the others pick up the session, with its name and role, which may be someone else's.

### The menu and roles

The menu shows each staff member only what their role can use: Admins never see Admins or the audit log. An Admin who types such an address sees "Only Super Users can open this page". This is only a convenience: the API refuses those routes to Admins anyway (ADR 0015).

The areas still to come are in the menu, marked "Soon". Each opens a calm page saying which part brings it.

### Signing out after 30 idle minutes

By the owner's choice, staff are signed out after **30 minutes without activity**, so a console left open on an unattended computer closes itself:
- **Activity** is any click, key, touch, scroll or mouse move, in any tab of the console. Tabs tell each other at most every 10 seconds, on `herbal-staff-activity`. A time from another tab is never taken as later than now, so no message can keep the console open for longer.
- **A minute before,** a small "Still there?" panel counts down, with a "Stay signed in" button. Screen readers hear it once, not every second.
- **The clock is read at every check,** every second and whenever the page shows again. So a laptop that slept for an hour signs out as soon as it wakes.
- **The sign-out is the normal one,** and the sign-in page says why: "You were signed out after 30 minutes without activity". The other tabs say the same.
- **If the server can't be reached then,** nobody is there to try again. So the console locks anyway: it forgets the token, and leaves a note in `localStorage` (`herbal-staff-sign-out-pending`, never a token). Its next start ends the session on the server before anything else.

The API itself still has no idle limit: its sessions last 12 hours (ADR 0014).

### The page's security policy

The built console runs under a strict Content Security Policy (`src/security-headers.ts`):

```
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' <MEDIA_BASE_URL>/;
font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none';
object-src 'none'; require-trusted-types-for 'script'; trusted-types 'none'; frame-ancestors 'none'
```

- **Only the console's own files,** with no inline script or style, and no `eval`. So a script slipped into the page, say through a product's text, can neither run nor load another.
- **Trusted Types:** the browser refuses any string turned into HTML or script. The console never needs that: React writes text as text, and the linter refuses `dangerouslySetInnerHTML`.
- **Images come only from the shop's image folder:** the API's `MEDIA_BASE_URL`, given to the build as `ADMIN_MEDIA_BASE_URL`, by default `http://127.0.0.1:3000/media`. Its characters are checked, so it can never change the policy around it.
- **No other site may frame the console** (`frame-ancestors 'none'`, and `X-Frame-Options: DENY`), against clickjacking.
- **The sign-in form can't be sent without the script** (`form-action 'none'`, and `method="post"`), so a password could never end up in an address.
- **Zod never tries `new Function`** (`z.config({ jitless: true })`), which the policy forbids.

**Where the policy lives:**
- **in the built `index.html`,** as a `<meta>` tag placed before anything loads, so it travels with the files wherever they are served. Browsers ignore `frame-ancestors` there, so it is left out of that copy;
- **in the headers of `pnpm admin:preview`,** with the other headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a `Permissions-Policy` that turns off the camera, microphone, location, payment and similar, `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy: same-origin`, and `X-Robots-Tag: noindex, nofollow`;
- **the production host must send the same headers.**

The Vite dev server sends the headers without the policy, because its live reload runs inline scripts. So the policy is tried on the built console, with `pnpm admin:preview`.

**Every build is checked** (`scripts/check-build.mjs`, part of `pnpm admin:build`), and fails:
- if the page has no policy, or the policy comes after something it should cover;
- if the policy allows `unsafe-inline`, `unsafe-eval`, `data:` or `*`, or lacks `default-src 'none'`, `script-src 'self'` or Trusted Types;
- if the page has an inline script or style;
- if any source map was published.

**More checks:**
- the linter refuses `eval`, `new Function`, `javascript:` links and frames without a sandbox;
- a page that breaks shows "Something went wrong" and a reload button, never what went wrong;
- the HTML asks search engines not to index the console, and browsers not to send its address to other sites.

### Look and motion

- **Colours** are named tokens in `src/index.css`: calm greens on warm neutrals in the light theme, deep greens in the dark one, chosen by the computer's setting.
- **Motion is short and calm,** so it never slows staff down (`src/motion.ts`):
  - every movement lasts 150 to 250 ms, quick to start and soft to land;
  - a page or a card rises in 8 pixels as it fades in, and leaves faster than it arrives;
  - lists arrive one row after another, 30 ms apart;
  - the menu's highlight slides to the page that opens;
  - messages and errors fade in;
  - buttons give a little under the finger.
- **"Reduce motion"** on the computer turns the movement off, in Motion (`MotionConfig reducedMotion="user"`) and in CSS.
- **Accessibility:**
  - every field has its label, and its hint and error are read out with it;
  - errors are announced, and focus moves to the first field to fix;
  - there is a "Skip to the page" link, the menu is marked as the main navigation, and it marks the open page;
  - focus is always visible.

### The build

Production builds have no source maps. The libraries are split from the console's own code (`react`, `motion`, `vendor`), so a new release of the console leaves them cached. No file is above 220 kB (69 kB compressed).

## Alternatives considered

- **Next.js or another framework that renders on the server.** Rejected: the console is for staff only, needs no search engine and no first paint for strangers, and a static app needs no server of its own to secure.
- **The refresh token in `localStorage` or `sessionStorage`.** Rejected: any script in the page could read it, which is how XSS turns into a stolen session (`docs/security.md`, "Secure local storage").
- **No refresh token in the browser at all,** signing in again on every reload. Rejected: a reload would need a new authenticator code every time.
- **A backend-for-frontend,** a small server that keeps the tokens and gives the browser only a session cookie. Not now: it is another server to run and secure, and the cookie on the auth routes gives most of its protection. Reconsider for the customer website.
- **The console on its own origin, with CORS and credentials.** Rejected: one origin needs no CORS rules to get wrong, and lets the cookie be `SameSite=Strict`.
- **A CSRF token as well.** Not needed now: the cookie works only on the three auth routes, only with the console's exact `Origin`, and can only start, swap or end a session.
- **The policy only as a header,** with no `<meta>` copy. Rejected: the console has no host yet, and the copy in the page protects it wherever it is served. The host must still send the header, for `frame-ancestors`.
- **`'unsafe-inline'` for styles.** Not needed: Tailwind builds one CSS file, and React and Motion change styles through the DOM, which the policy allows.
- **An idle limit in the API.** Not now: the API can't see clicks and keys, only requests. The console's limit covers the unattended computer. Reconsider with the customer website.
- **A component library,** such as MUI or shadcn/ui. Not now: a few small components of our own, on Tailwind, are enough for the foundation. Revisit when the forms and tables of 12B arrive.
- **A theme switch.** Not now: the console follows the computer's setting.

## Consequences

- **Tests:**
  - **The API:** 865 unit tests in 97 suites, up from 849 in 95. The new ones cover the cookie (its attributes, `Secure` with `https`, reading only a well-formed value under the exact name), the three auth routes from the console and from elsewhere, and `ADMIN_ORIGIN` (`https` only in production). Breaking the cookie code on purpose 21 ways, the tests caught all 21.
  - **The smoke test has 95 checks.** The new one, from the console's `Origin`: renewal and sign-out use only the cookie and ignore a token in the body, so without a cookie they answer `401` and `204`, and both tell the browser to forget it. A failed sign-in sets no cookie. (A real staff sign-in needs an authenticator code, so it is tested by hand.)
  - **The console:** 77 tests in 8 files:
    - the API client: the token, the renewal, renewals one at a time, refusals, the server out of reach, answers checked;
    - the return page, which never leads to another site;
    - signing in, staying signed in, signing out, tabs, roles and the idle sign-out, against a fake API;
    - the policy and the headers;
    - the error page, and zod without `eval`.
  - **Breaking the console's code on purpose, one way at a time:** of 38 breaks to signing in and the menu, the tests caught 36. TypeScript refused the other 2 (a Customer role in the console, and sending a form that failed its checks). Of 23 breaks to the idle sign-out and the policy, they caught 22, and a test was then fixed to catch the last one (see the lessons).
  - **In a real browser:** headless Chrome opened the built console under the full policy and headers, the sign-in page and its checks included, and reported no violation at all.
  - **The build check** was shown to fail on a copy of the build with the policy removed, an `unsafe-inline` added, an inline script and a source map.
  - **By hand, on 2026-11-12,** with a real Super User and an authenticator app:
    - signing in, the menu and its highlight, and reloading signed in;
    - a second tab, and signing out in one tab signing out the other;
    - in the browser, the cookie `HttpOnly`, `SameSite=Strict` and on `/v1/staff/auth`, and nothing in `localStorage` or `sessionStorage`;
    - the built console under the policy (`pnpm admin:preview`), with the headers present and no violation in the browser's console.
- **The console needs its own origin to be `ADMIN_ORIGIN`.** Served from any other address, the API ignores the cookie and the console says it can't reach the server. On a laptop, that means port 5173: Vite refuses to start on another one (`strictPort`).
- **Staff on a shared computer** are protected by the idle sign-out and by signing out. The cookie lasts at most 12 hours, like the session.
- **Admin invitation links still point at `WEB_BASE_URL/staff/accept-invite`** (ADR 0015). They will point at the console when its page for them is built.
- **Lessons:**
  - **A shared rate limit counts every caller.** The smoke test's check of the logout limit failed once the console's checks signed out too, because they share the limit. The check now counts them.
  - **Fake timers can freeze React too.** The idle tests first moved the clock before the console's timer had even started. They now let the page finish its effects before moving time.
  - **A test can pass for the wrong reason.** The test for a laptop waking from sleep passed even with the wake-up check removed, because the every-second check signed out instead. It now requires the sign-out at the moment the page shows again.
  - **A break that doesn't compile proves nothing.** With TypeScript's checks for unused names, 13 of the first breaks didn't compile. They were run again with those checks off, and caught.
  - **The dev server isn't the built console.** The policy can only be tried on the build (`pnpm admin:preview`), because the dev server's live reload needs inline scripts.
- **Still open:**
  - the console's pages: catalog (12B and 12C), stock (12D), then orders and refunds, then Admins and the audit log;
  - the page for accepting an Admin invitation, and the invitation link pointing at it;
  - for staff MFA: a QR code, recovery codes and passkeys (ADR 0013);
  - hosting: one origin with the API, HTTPS (the cookie then becomes `Secure`), the headers sent by the host, `index.html` never cached, and the build's `ADMIN_MEDIA_BASE_URL` set to the CDN (`docs/security.md`, section 6);
  - a place to send the policy's violation reports, and an error tracker that keeps the source maps;
  - a theme switch.
