# 0041. The customer's account on the website

- Status: Accepted and implemented (part 14B)
- Date: 2026-11-21

## Context

Since part 3A the API has customer accounts: signing up with an email address that must be confirmed, signing in, a 15-minute access token renewed by a refresh token, a 30-day session (ADR 0007), limits on tries per IP and per email address (ADR 0009), and forgetting and resetting a password (ADR 0010). Since part 3C it has the customer's name, changing the password, signing out everywhere (ADR 0018), and up to 10 delivery addresses (ADR 0019). Since part 14A the website shows the shop to anyone (ADR 0039), but nobody could sign in to it.

The owner made these choices on 2026-11-21:
- **Signed in for 30 days on a device,** the API's session, with "Sign out" and "Sign out everywhere".
- **Deleting an account comes later,** in a part of its own: the API has no way yet, and orders and tax records must stay, so it means removing a person's details rather than their rows.
- **No CAPTCHA for now:** the API's limits per IP address and per email address, and the email check, are enough until they aren't.

## Decision

### The sign-in, sealed in a cookie

- **The browser never holds a token it can read** (`app/session.server.ts`). The website server keeps the API's access and refresh tokens, sealed in one cookie:
  - sealed with AES-256-GCM, under a key made from `WEB_SESSION_SECRET` (HKDF, SHA-256), with the cookie's name bound in. It can be neither read nor changed without the key;
  - `HttpOnly`, `SameSite=Lax`, `Path=/`, and lasting what is left of the API's 30-day session;
  - `__Host-herbal_session` with `Secure` over HTTPS, so no other site or subdomain can set it; `herbal_session` on a laptop over HTTP.
- **Every page and data request passes through one middleware** (React Router 8's `middleware` on the root route):
  - it opens the cookie;
  - it renews the access token when it has less than a minute left;
  - after the page, it writes the cookie again if it changed.
- **A renewal happens once,** even for two requests at the same moment, such as two tabs. Requests with the same old cookie within the next minute share its result, because the API ends a session whose refresh token it sees twice, thinking it stolen. That sharing lives in the website's memory, so it holds for one website process; more processes would share it through Valkey.
- **The API decides who is signed in:**
  - a refused renewal (`401`) signs the customer out here;
  - an API that can't be reached keeps the cookie, and tries again on the next request.

  Every call made for a customer goes through `askAsCustomer` (`app/account.server.ts`), which sends anyone not signed in to sign in, and comes back afterwards. When the API no longer knows the session, for instance after a password change on another device, it signs the customer out here and sends them to sign in.
- **What a signed-in customer gets is never stored:** every answer to them, pages and data alike, is `Cache-Control: private, no-store`. So a page fetched ahead (ADR 0039) is never reused for them.
- **`WEB_SESSION_SECRET`:** at least 32 characters, needed by the built website, which refuses to start without it. A new key signs every customer out. On a laptop the website makes its own random key, kept across Vite's reloads.

### Forms only from this site

- **A form must come from the website itself** (`server/app.ts`). Any `POST` needs an `Origin` equal to `WEB_ORIGIN`, or no `Origin` with `Sec-Fetch-Site` of `same-origin` or none. Anything else is `403`. React Router also refuses an action whose `Origin` differs from the request's own.
- **`SameSite=Lax`** keeps the cookie out of other sites' forms as well. No CSRF token is needed beside the two.
- **One exception, since part 14C:** Razorpay's answer, sent from Razorpay's own site as it sends the customer back to an order, has its own route before this check. It changes nothing: it only sends the customer on to a page where their own session confirms the payment with the API (ADR 0042).
- **Found on the way:** with `Referrer-Policy: no-referrer`, browsers send `Origin: null` with a form sent without the page's script, which the check refused. The website now sends `Referrer-Policy: same-origin` (ADR 0039).

### The pages

- **`/sign-in`:**
  - the email address and the password;
  - "Forgot your password?" and "Create an account";
  - one answer for a wrong address or password, as the API gives: "The email address or the password is not right.", with a hint, and "Send the link again", for someone who hasn't confirmed their address;
  - a closed account is told so, too many tries say how long to wait, and an API away says to try again in a minute;
  - the password box is emptied after every refusal.

  Signing in goes back to the page asked for (`?next=`), only if it is a page of this website (`app/sign-in-next.ts`). It never goes back to another site (`//evil.example`, `/\evil.example`, `https://…`) or to one of the forms of an emailed link: a link that leads there through signing in could carry someone else's token.
- **`/sign-out`** works by `POST` only: a link or a picture can't sign anyone out. `GET` goes home.
- **`/sign-up`:**
  - the name, the email address and a password of 10 to 128 characters;
  - "By creating an account, you agree to the Terms and conditions and the Privacy policy.", with both linked (ADR 0040);
  - the answer is "Check your inbox" whether or not the address has an account already, as the API's is.
- **The emailed links** (`/verify-email`, `/reset-password`):
  - opening a link uses nothing up: the page shows a button, and only pressing it sends the token, so a mail scanner that opens links can't spend it;
  - a link expired or used already says so and offers a new one;
  - a new password signs out this device too, as the API ends every session;
  - with no token at all, `/reset-password` leads to `/forgot-password`.

  Like every page that carries a token, they are `private, no-store`.
- **`/forgot-password`:** the same answer for any address, and a link only for an account.
- **`/account`, the customer's own page,** in four parts:
  - **Your details:** the name, changed in its box; the email address shown, as the API can't change it;
  - **Delivery addresses:** each with who receives it, where, and the phone for the courier, the default first and marked. "Edit" and "Make default" on each, named with the address, as two may look alike ("Edit the address for Asha Verma, 12 MG Road"). "Add an address", or at 10, "You have 10 addresses, the most we keep.";
  - **Password:** the way to `/account/password`;
  - **Signing out:** "Sign out" here, or "Sign out everywhere". This one signs out here only once the API has ended every session; if the API fails, the customer is told, and stays signed in to try again.
- **`/account/password`:**
  - the current password and the new one;
  - a hidden username box, so password managers know which account the new password is for;
  - a wrong current password is said beside its box;
  - success signs out every device, this one too, and the sign-in page says "Your password is changed, and you are signed out on every device."
- **`/account/addresses/new` and `/account/addresses/:id`:**
  - the name, a phone and a PIN code as people type them ("+91 98450-12345", "560 001"), checked by the API's own rules;
  - the state from a list of the 36 states and union territories, the API's own (a test compares the two);
  - the first address is the default;
  - removing one asks once more ("Remove this address?", with "Keep it"), with or without the page's script, and says when the newest other address becomes the default.

  An address's ID is checked before it goes into the API's address, so a made-up one can't reach another endpoint; someone else's address is "not found".
- **Every form works without the page's script.** With it:
  - the button says it is sending, and a second click waits;
  - the keyboard goes to the first problem, or the message, or what was done;
  - passwords leave the page once sent.

  Status messages are `<output>` elements, read out when they appear.

### The checks

- **Website:** 399 tests (Vitest), each action against a stand-in for the API and each page as it is drawn and read out. Deliberate breaks: 42 of 42 caught for signing up and the emailed links.
- **The build check** (`scripts/check-build.ts`, part of `pnpm web:build`):
  - signs in through the built website, and checks that the cookie is sealed and the account page is `no-store` with no token in it;
  - checks that a form from another site is refused;
  - checks that opening an emailed link asks the API nothing;
  - checks that a visitor to any account page is sent to sign in.

  Removing the sign-in requirement on purpose made it fail on all four account pages.
- **Headless Chrome, against a stand-in for the API:**
  - 11 checks for signing in and out, among them a token renewed once for two requests at the same moment, Back after signing out, and no script;
  - 14 for signing up and the emailed links;
  - 11 for the account page.
- **The whole way through, against the real API** (part 14B, step 7), in headless Chrome, with a throwaway PostgreSQL, Valkey and Mailpit:
  - signing up, the email in Mailpit, confirming, and signing in;
  - addresses as the API keeps them, with the longest state name, the default moving on, and the 11th refused;
  - the name, the password, forgetting it, and signing out everywhere;
  - another device's signing out reaching this one;
  - every form without the page's script;
  - the keyboard, light and dark at 390 and 320 pixels wide, and the headers;
  - 24 of 24, with the policy pages (ADR 0040).
- **That run found a mistake the stand-in had hidden:** the API lists addresses as `{ "addresses": [...] }`, not as a bare list, so the account page could only say "short break". The website now reads it as the API sends it, the stand-ins send the same, and a test reads the API's own code for that answer.

## Consequences

- Customers sign in once on a device for 30 days, and scripts on the page, whatever they are, can never read or send their tokens.
- The website server must keep `WEB_SESSION_SECRET` secret and steady: anyone with it could make a cookie, and changing it signs everyone out.
- A signed-in customer's pages are made afresh every time, and never fetched ahead for reuse. That is slower for them than for visitors, by choice.
- Sharing a renewal works within one website process. A second process needs the sharing moved to Valkey first, or a customer whose two tabs hit two processes at once could be signed out.
- Changing the email address, a list of the devices signed in, deleting an account, and a CAPTCHA are not here yet: the first three need the API first (ADR 0018), the last only if abuse shows up.
- A stand-in for the API only checks what it is told. Each part should run once against the real API before it is finished.

## Alternatives considered

- **Tokens kept by the page** (in memory or `localStorage`), as the console keeps its access token (ADR 0031): no cookie to seal, but any script on the page could read them, and server-made pages couldn't use them.
- **Sessions kept on the website server,** with only an ID in the cookie: tokens never leave the server, but a store (Valkey) to keep and share from the start. The sealed cookie needs none, and moves to it if more is needed.
- **A CSRF token in every form:** the usual way, but a hidden field on every page and a second secret. `SameSite=Lax` plus the `Origin` check refuse the same forms.
- **A link that confirms on opening:** one step fewer, but mail scanners open links, and would use them up.
- **Signing out everywhere at once, then asking the API:** feels quicker, but if the API failed the customer would think every device was signed out when none was.
