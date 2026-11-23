# 0042. The cart, checkout and paying on the website

- Status: Accepted and implemented (part 14C)
- Date: 2026-11-23

## Context

Since part 6 the API keeps a signed-in customer's cart: at most 4 packs of one product, all its sizes together, and 50 pack sizes, always at today's prices (ADR 0025). Since part 7 it places an order from the whole cart, to one of the customer's addresses, priced by the server, with an `Idempotency-Key`, the stock held for 15 minutes and at most 3 orders waiting for payment (ADR 0026). Since part 8 it starts and confirms payments through Razorpay, and trusts only Razorpay's word (ADR 0027). Since part 14B a customer can sign in to the website and keep delivery addresses (ADR 0041), but couldn't buy anything there.

The owner made these choices on 2026-11-23:
- **Pay on Razorpay's own page** (its "Hosted Checkout"), not in a Razorpay window over ours.
- **"Add to cart" while signed out:** sign in, then the pack is added on the way back.
- **On a product's page:** choose a pack size, then how many packs (1 to 4), and one "Add to cart". The number can change in the cart too.
- **The delivery address at checkout:** one of the saved ones, the default chosen; "Add an address" goes to the address form and comes back to checkout with it chosen.

## Decision

### Adding to the cart

- **A product's page** (`routes/product.tsx`):
  - its pack sizes are one group of radio cards: the size is each one's name, its price, MRP and stock its description. A size out of stock can't be chosen, and the first in stock is chosen to start with;
  - "How many packs", 1 to 4, and "Add to cart".
- **The API sets a line's packs; it doesn't add them** (`PUT /v1/me/cart/items/:sku`). So the website reads the cart, then sends what was there plus the packs chosen (`app/cart.server.ts`). Before that it works out the room left for the product, 4 less its packs in every size, and says so when there is too little: "That is the most for one product: 4 packs, all sizes together."
- **A visitor's "Add to cart"** goes to sign in. The choice travels in `?next=` (`/products/tulsi-drops?add=TUL-DRP-100&packs=2`), and is added just after signing in. The product's page then says "Added 2 packs of 100 ml to your cart." only if the cart really holds them.
- **The menu,** for a signed-in customer: "Cart", with the number of packs, read out as "Cart, 3 packs". No number at 0, or when the API can't be asked.

### The cart

- **`/cart`,** for a signed-in customer only, `private, no-store` like every page of theirs:
  - each line with its photo, name, size, price and MRP;
  - "−" and "+" buttons, 48 pixels, read out as "One pack fewer, Tulsi Drops, 100 ml". "−" stops at 1, and "+" at 4 packs of the product or a line that can't be bought;
  - "Remove", and the lines out of stock or no longer sold said so, and left out of the sums.
- **The summary:** the packs, the total at MRP, what the customer saves, the subtotal, and the rule for delivery (free from ₹499, else ₹49). The API's GST is inside the prices.
- **"Go to checkout" only when every line can be bought:** the API orders the whole cart or nothing. Otherwise: "Remove the packs that can’t be bought now, and you can check out."

### Checkout

- **`/checkout`** (`routes/checkout.tsx`):
  - the saved addresses as radio cards, read out by name and street ("Asha Verma, 12 MG Road"), the default chosen. With none saved, the customer is asked to add one first;
  - "Add an address" goes to `/account/addresses/new?then=checkout`, whose way back is "Back to checkout". Saving goes back to `/checkout?address=<its ID>`, with it chosen. An ID in the address that isn't the customer's own is ignored;
  - the order as the API prices it now (`GET /v1/me/checkout`): each line ("2 packs at ₹449 each"), the items, delivery (Free or ₹49), the total, and how much is GST;
  - "Place order", and "Placing it holds your packs for 15 minutes while you pay."
- **Placing it once:**
  - each checkout page carries a new key (a UUID), sent as the `Idempotency-Key`. A second tap, or the form sent again, gets the order the first one placed;
  - the website sends the total it showed. If the API's total differs, the order is refused, and the new total is shown;
  - **when it isn't known whether the order went through** (the API answered with a failure, or not at all), the form keeps the same key. Trying again then can't place a second order.
- **Why it can't be placed, said in plain words,** with the keyboard on the message:
  - the cart is empty;
  - some packs can't be bought (with "Back to your cart");
  - the total changed;
  - 3 orders already wait for payment;
  - a pack ran out;
  - the address is gone;
  - too many tries, and how long to wait;
  - the API is resting.

  The API's own words decide which; a test reads them from `apps/api/src/orders/order-rules.ts`.
- **Found by the Chrome checks:** React Router 7 and later don't reload a page's data after an action that answers `4xx` or `5xx`. After a refused order, checkout kept the old total and key, so "Place order" sent the old total again. Checkout now always reloads after an action (`shouldRevalidate`), and a test guards it.

### The order's page

- **`/orders/:id`** (`routes/order.tsx`), the customer's own only. Another customer's order, or an ID that isn't a UUID, is "not found", and a made-up ID never reaches the API.
- **It shows:**
  - "Order 7KQ2M9XDPA", with "Quote this reference if you contact us.";
  - where it stands, in plain words: "Waiting for payment. Your packs are held until 8:27 pm." (India's time), paid, packed, on its way, delivered, cancelled, or not paid in time;
  - what was ordered at what price, and where it goes;
  - **"Money going back"**, when a payment goes back: why (paid after the time to pay with the stock gone, paid twice, paid after cancelling, or cancelled), and where it stands (on its way, back, or "could not be given back by itself", for staff to give back by hand).

### Paying on Razorpay's own page

- **"Pay ₹348"** on an order waiting for payment is a plain HTML form to Razorpay's page, `POST https://api.razorpay.com/v1/checkout/embedded` (`app/razorpay.ts`). No Razorpay script runs on our pages, and it works without the page's script too. It carries:
  - `key_id` and `order_id`, from `POST /v1/me/orders/:id/payment`. The page's loader asks for them; the API makes the Razorpay order the first time and answers the same one after;
  - `amount` in paise, the API's rupees × 100, and `currency` `INR`;
  - `name` (the shop's) and `description` ("Order 7KQ2M9XDPA");
  - `prefill[email]` (from `GET /v1/me`) and `prefill[contact]` (the delivery phone, with `+91`), as Razorpay asks for both. Nothing else about the customer goes to Razorpay;
  - `callback_url`, `WEB_ORIGIN/orders/:id/payment`, and `cancel_url`, `WEB_ORIGIN/orders/:id?payment=cancelled`.

  Once pressed, the button says "Opening Razorpay", and a second press waits. Back on the page with the browser's Back button, it works again.
- **Razorpay's answer comes back as a form from Razorpay's own site.** The customer's cookie stays behind (`SameSite=Lax`), and the check every other form passes would refuse it (ADR 0041). So:
  - **one narrow route takes it, before that check** (`server/payment-return.ts`): `POST /orders/:id/payment`, for an order's ID only. It reads the form, URL-encoded or multipart, at most 16 kB, and **changes nothing**;
  - with a payment's ID (`pay_…`) and a 64-hex signature, it answers `303` to `GET /orders/:id/payment?payment=…&signature=…`. With anything else, such as Razorpay's error fields, it answers `303` to `/orders/:id?payment=failed`.
- **That page, with the customer's own session, asks the API to confirm** (`routes/order-payment.tsx`, `POST /v1/me/orders/:id/payment/confirm`). The API checks Razorpay's signature against the Razorpay order it saved, then asks Razorpay itself (ADR 0027). Then the order's page:
  - paid, or with its money going back: the order says so;
  - not captured yet, or Razorpay or the API out of reach: `?payment=checking`, "Razorpay has not confirmed your payment yet. Look at this page again in a minute, before paying again." Razorpay's webhook settles it anyway;
  - a wrong signature: `?payment=unverified`;
  - signed out meanwhile: sign in first, then it confirms.

  That address holds the payment's ID and signature. Neither can pay anything, and confirming needs the customer's session, but no cache keeps it (`private, no-store`), and it moves on to the order's own address at once.
- **What the order's page says when the customer is back,** while the order still waits for payment:
  - "You left Razorpay’s page before paying. You can pay below.";
  - "The payment did not go through. You can try again below." (as an alert);
  - "Razorpay has not confirmed your payment yet…";
  - "We could not verify that payment. If it went through, this page will show it once Razorpay tells us." (as an alert).

  The keyboard starts on it. Any other word in `?payment=` is ignored.
- **When paying can't start:**
  - the time to pay is over, even before the order has expired: "The time to pay for this order is over, so its packs are going back on sale. You can order them again.", with "Go to the shop";
  - payments are not available, or too many tries, with the wait;
  - the order changed a moment ago.

### The security policy: forms may go to Razorpay

- **`form-action 'self' https://api.razorpay.com`, on every page** (`app/security-headers.ts`). Nothing else in the policy changed: no Razorpay script, frame or connection.
- **Why every page:** a page's policy is fixed when the browser first loads it. Customers reach an order's page by moving within the site, for instance from checkout, so the policy in force is that of whichever page they first opened. A policy on the order page alone would have blocked "Pay".
- **What it risks:** an injected form could send a customer to Razorpay. React writes every value as text, so nothing can be injected, and a link, which no policy limits, could already send them anywhere.

### The checks

- **Website:** 495 tests (Vitest), each loader and action against a stand-in for the API, each page as it is drawn and read out, and the return route through the real Express server. Tests compare the API's refusals, Razorpay's ID formats and the signature's form with the API's own code. Deliberate breaks: 56 of 56 caught, across the three steps.
- **The build check** (`scripts/check-build.ts`):
  - opens `/cart`, `/checkout` and an order's page signed in (`no-store`, no token in them) and as a visitor (sent to sign in);
  - places an order through the built website, with the page's key reaching the API as the `Idempotency-Key`;
  - checks the order's page's form to Razorpay, and the policy's `form-action`;
  - sends Razorpay's answer from Razorpay's origin, without a cookie, then follows it to the confirmation with the customer's session, and back to the order.

  Taking out the key, or the return route, on purpose made it fail.
- **Headless Chrome, against a stand-in for the API** that also plays Razorpay, signing payments with its own secret. Chrome's requests to Razorpay's page were answered by a stand-in page that sends the customer back as Razorpay does.
  - **8 checks for the cart:** signing in from "Add to cart", the limit of 4, a pack out of stock, the steps and removing, no script, the keyboard, phones and dark;
  - **9 for checkout:** adding an address from checkout, placing, a price changed meanwhile, the same key twice, a fourth waiting order, "not found", no script, phones and dark;
  - **14 for paying:**
    - paid;
    - left before paying;
    - a failed payment;
    - one not captured yet;
    - a forged signature;
    - the Back button;
    - paid twice;
    - paid after the time ran out;
    - the time to pay over;
    - payments down;
    - no script;
    - phones and dark;
    - no policy violation anywhere.
- **By hand, by the owner, against the real API in Razorpay's Test Mode** (a manual test now ends each milestone): placing an order, paying on Razorpay's real page, coming back paid, and leaving Razorpay's page before paying. Run with `pnpm web:dev`, then the built website under its full policy. Everything worked.

## Consequences

- Customers buy on the website from a product's page to a paid order, and card or bank details never touch our pages.
- **No UPI on Razorpay's page in Test Mode:** it offers cards, netbanking, wallets and pay later. Our form doesn't limit the methods. NPCI retired UPI by typing a UPI ID ("Collect") from 28 February 2026, and Razorpay tests UPI by QR code (computers) and by app (phones) in Live Mode only. **Check UPI when going live.** If Live Mode doesn't offer it on this page, ask Razorpay to enable UPI Intent and QR, or weigh Razorpay's Standard Checkout, whose script would need the policy widened.
- Opening an order that waits for payment starts its payment with the API: 60 an hour per IP (ADR 0027). Customers who share a public IP, as on mobile networks, share that limit; reaching it shows the wait, not "Pay".
- Every page's policy allows forms to Razorpay. A second payment provider would need its own entry.
- "Create an account" from a cart's sign-in loses the pack chosen, since confirming the email comes between. The customer adds it again.
- The website never decides a payment: if the confirmation can't reach the API, Razorpay's webhook, or the API's check before an order expires, settles it (ADR 0027).
- The customer's list of orders, its history and cancelling come in part 14D.

## Alternatives considered

- **Razorpay's Standard Checkout** (`checkout.js`, a window over our page): what the apps use (`docs/api-specification.md`), but it runs Razorpay's script, with its frames and connections, inside our policy. The owner chose Razorpay's own page.
- **Confirming in the route Razorpay sends to:** fewer steps, but that request carries no cookie, so no session; the route would have to trust what it was sent. It only forwards instead.
- **Keeping the payment's ID and signature in a cookie for the next page,** rather than in the address: nothing in the address, but another cookie set from a request from another site, for a few seconds' use. Neither can pay anything, and the address is never cached.
- **"Pay" as a form to our own server,** which would start the payment and send the browser on to Razorpay: no payment started by opening the page, but the browser's Back button would then lead to a form sent again, and without the page's script the customer would press twice. Starting it on opening is safe to repeat: the API answers the same Razorpay order.
- **The policy's `form-action` widened on checkout and order pages only:** narrower, but it blocked "Pay" for customers who had first opened any other page.
