// Pays for a real order in Razorpay's test mode, in a browser: what the smoke
// test can't do, because only a person can use Razorpay's payment page
// (ADR 0027). Development and Razorpay test keys only: no real money moves.
//
//   pnpm api:pay-test            pay for an order: it is paid
//   pnpm api:pay-test --cancel   cancel the order first, then pay: the money
//                                goes back in full, as a test refund
//
// To pay late, wait more than 16 minutes on the page before paying: the order
// expires, then the payment takes its stock again, or goes back in full.
// Needs the API (pnpm api:dev), Mailpit (docker compose), a pack in stock,
// and the internet. Each run creates a throwaway customer
// (pay.<number>@example.com) and one order: orders are never deleted.
const { createHmac, randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { parseEnv } = require('node:util');

const API = process.env.API_URL ?? 'http://localhost:3000';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const PAGE_PORT = 4400;
const CANCEL_FIRST = process.argv.includes('--cancel');

const email = `pay.${Date.now()}@example.com`;
const password = 'pay-test-password-1';
let failures = 0;

function check(name, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) {
    failures += 1;
  }
}

async function call(method, path, { json, token, headers: extra } = {}) {
  const headers = { ...extra };
  let body;
  if (json) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(API + path, { method, headers, body });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 500));

// Reads the token from the newest email with this subject in Mailpit.
async function emailedToken(address, subject) {
  const query = encodeURIComponent(`to:${address} subject:"${subject}"`);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const found = await fetch(`${MAILPIT}/api/v1/search?query=${query}`).then(
      (response) => response.json(),
    );
    const id = found.messages?.[0]?.ID;
    if (id) {
      const message = await fetch(`${MAILPIT}/api/v1/message/${id}`).then(
        (response) => response.json(),
      );
      const match = /token=([A-Za-z0-9_-]+)/.exec(message.Text ?? '');
      if (match) {
        return match[1];
      }
    }
    await pause();
  }
  throw new Error(`no "${subject}" email found in Mailpit`);
}

// The first pack in stock in the shop.
async function firstPackInStock() {
  const shop = await call('GET', '/v1/categories');
  for (const category of shop.body?.categories ?? []) {
    const page = await call('GET', `/v1/categories/${category.slug}/products`);
    for (const card of page.body?.products ?? []) {
      const product = await call('GET', `/v1/products/${card.slug}`);
      const pack = (product.body?.variants ?? []).find((each) => each.inStock);
      if (pack) {
        return pack;
      }
    }
  }
  return undefined;
}

// The page an app would show: Razorpay's own payment page, opened over it.
// Razorpay's page counts in paise, but our API answers rupees only, so the
// app multiplies by 100 itself (ADR 0027).
function paymentPage(payment) {
  const options = {
    key: payment.razorpayKeyId,
    order_id: payment.razorpayOrderId,
    amount: payment.totalRupees * 100,
    currency: 'INR',
    name: 'Herbal Commerce (test mode)',
    description: `Order ${payment.reference}`,
    // A made-up phone number, to save typing one on Razorpay's page.
    prefill: { email, contact: '9000090000' },
  };
  const json = JSON.stringify(options).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Test payment</title>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
</head>
<body style="font-family: sans-serif; max-width: 34rem; margin: 2rem auto; padding: 0 1rem">
<h1>Order ${payment.reference}</h1>
<p>Total: Rs ${payment.totalRupees}. This is Razorpay's test mode: no real money moves.</p>
<p>Pay with the test card <code>4100 2800 0000 1007</code> (any future expiry date, any CVV),
or with UPI <code>success@razorpay</code>. If a test bank page asks, choose Success.</p>
<button id="pay">Pay with Razorpay</button>
<pre id="result"></pre>
<script>
const show = (text) => { document.getElementById('result').textContent = text; };
const options = ${json};
options.handler = async (answer) => {
  document.getElementById('pay').disabled = true;
  show('Paid. The API is confirming the payment...');
  const response = await fetch('/paid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(answer),
  });
  show(await response.text());
};
options.modal = { ondismiss: () => show('Closed without paying. Press the button to pay.') };
document.getElementById('pay').onclick = () => {
  const checkout = new Razorpay(options);
  checkout.on('payment.failed', (answer) => show('The payment failed: ' + answer.error.description));
  checkout.open();
};
</script>
</body>
</html>`;
}

// Serves the page on this computer only, and waits for Razorpay's answer to
// come back from it. `reply` shows the outcome on the page.
function payInBrowser(payment) {
  let answered = false;
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      if (request.method === 'GET' && request.url === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(paymentPage(payment));
        return;
      }
      if (request.method === 'POST' && request.url === '/paid' && answered) {
        // Only the first payment is checked.
        response.writeHead(409, {
          'Content-Type': 'text/plain; charset=utf-8',
          Connection: 'close',
        });
        response.end('This test already has a payment: see the terminal.');
        return;
      }
      if (request.method === 'POST' && request.url === '/paid') {
        answered = true;
        let body = '';
        request.on('data', (chunk) => {
          body += chunk;
        });
        request.on('end', () => {
          const reply = (text) => {
            response.writeHead(200, {
              'Content-Type': 'text/plain; charset=utf-8',
              Connection: 'close',
            });
            response.end(text);
            server.close();
          };
          try {
            resolve({ answer: JSON.parse(body), reply });
          } catch (error) {
            reply('Razorpay answered something unexpected.');
            reject(error);
          }
        });
        return;
      }
      response.writeHead(404);
      response.end();
    });
    server.on('error', (error) => {
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(
              `port ${PAGE_PORT} is in use: is another payment test open?`,
            )
          : error,
      );
    });
    server.listen(PAGE_PORT, '127.0.0.1', () => {
      console.log(
        `\nOpen http://localhost:${PAGE_PORT} in your browser and pay.`,
      );
      console.log('(Press Ctrl+C to stop without paying.)\n');
    });
  });
}

async function main() {
  const env = parseEnv(
    readFileSync(path.join(__dirname, '..', '..', '..', '.env'), 'utf8'),
  );
  if (
    env.NODE_ENV !== 'development' ||
    !env.RAZORPAY_KEY_ID?.startsWith('rzp_test_')
  ) {
    throw new Error('it runs only in development, with Razorpay test keys');
  }
  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    throw new Error('RAZORPAY_WEBHOOK_SECRET is missing from .env');
  }

  // A throwaway customer, signed in, with an address.
  await call('POST', '/v1/auth/register', {
    json: { email, password, fullName: 'Pay Test' },
  });
  await call('POST', '/v1/auth/verify-email', {
    json: { token: await emailedToken(email, 'Verify your email address') },
  });
  let tokens = (
    await call('POST', '/v1/auth/login', { json: { email, password } })
  ).body;
  if (!tokens?.accessToken) {
    throw new Error('the throwaway customer could not sign in');
  }
  const address = await call('POST', '/v1/me/addresses', {
    json: {
      fullName: 'Pay Test',
      phone: '+91 98450 12345',
      line1: '12, 3rd Cross, Indiranagar',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560 038',
    },
    token: tokens.accessToken,
  });

  // One pack of the first pack in stock, ordered at the checkout's total.
  const pack = await firstPackInStock();
  if (!pack) {
    throw new Error('no pack is in stock: put one in stock first');
  }
  await call('PUT', `/v1/me/cart/items/${encodeURIComponent(pack.sku)}`, {
    json: { packs: 1 },
    token: tokens.accessToken,
  });
  const quote = await call('GET', '/v1/me/checkout', {
    token: tokens.accessToken,
  });
  const placed = await call('POST', '/v1/me/orders', {
    json: { addressId: address.body?.id, totalRupees: quote.body?.totalRupees },
    token: tokens.accessToken,
    headers: { 'Idempotency-Key': randomUUID() },
  });
  if (placed.status !== 201) {
    throw new Error(`the order was not placed: ${placed.body?.message}`);
  }
  const orderPath = `/v1/me/orders/${placed.body.id}`;
  const payment = await call('POST', `${orderPath}/payment`, {
    token: tokens.accessToken,
  });
  if (payment.status !== 200) {
    throw new Error(`paying could not start: ${payment.body?.message}`);
  }
  if (!payment.body.razorpayKeyId.startsWith('rzp_test_')) {
    throw new Error('the API is not using Razorpay test keys');
  }
  console.log(
    `Order ${placed.body.reference}: Rs ${placed.body.totalRupees} for one ${pack.sku}.`,
  );
  if (CANCEL_FIRST) {
    const cancelled = await call('POST', `${orderPath}/cancel`, {
      token: tokens.accessToken,
    });
    check(
      'the order is cancelled before paying',
      cancelled.body?.status === 'CANCELLED',
    );
  }

  const { answer, reply } = await payInBrowser(payment.body);
  let outcome = 'The payment test stopped: see the terminal.';
  try {
    outcome = await confirmAndCheck({
      env,
      answer,
      refreshToken: tokens.refreshToken,
      orderPath,
      placed: placed.body,
    });
  } finally {
    reply(outcome);
  }
  process.exitCode = failures === 0 ? 0 : 1;
}

// What the app does once Razorpay's page has answered: it confirms the
// payment. Then Razorpay's webhook for the same payment comes too.
async function confirmAndCheck({
  env,
  answer,
  refreshToken,
  orderPath,
  placed,
}) {
  // An access token lasts 15 minutes: a fresh one, in case the payment came
  // late.
  const tokens = (
    await call('POST', '/v1/auth/refresh', { json: { refreshToken } })
  ).body;
  const confirmed = await call('POST', `${orderPath}/payment/confirm`, {
    json: {
      razorpayPaymentId: answer.razorpay_payment_id,
      razorpaySignature: answer.razorpay_signature,
    },
    token: tokens?.accessToken,
  });
  const event = JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: { id: answer.razorpay_payment_id } } },
  });
  const webhook = await fetch(`${API}/v1/payments/razorpay/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Razorpay-Signature': createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
        .update(event)
        .digest('hex'),
    },
    body: event,
  });
  const after = await call('GET', orderPath, { token: tokens?.accessToken });

  const order = confirmed.body;
  const refunds = order?.payment?.refunds ?? [];
  const late =
    Boolean(order?.payment?.paidAt) &&
    new Date(order.payment.paidAt) > new Date(placed.holdExpiresAt);
  check(
    'the API confirms the payment (200)',
    confirmed.status === 200 && Boolean(order?.payment),
  );
  if (CANCEL_FIRST) {
    check(
      'the cancelled order stays cancelled, and the payment goes back in full',
      order?.status === 'CANCELLED' &&
        order.payment?.paidAt === null &&
        refunds.length === 1 &&
        refunds[0].reason === 'ORDER_CANCELLED' &&
        refunds[0].amountRupees === placed.totalRupees &&
        ['PENDING', 'PROCESSED'].includes(refunds[0].status),
    );
  } else if (order?.status === 'PAID') {
    check(
      late
        ? 'the order is paid late: its stock was taken again'
        : 'the order is paid',
      Boolean(order.payment?.paidAt) && refunds.length === 0,
    );
  } else {
    check(
      order?.status === 'PENDING_PAYMENT'
        ? 'the order is paid (it still waits: is Razorpay capturing payments automatically?)'
        : 'the order is paid, or, paid late with its stock gone, the payment goes back in full',
      order?.status === 'EXPIRED' &&
        refunds.length === 1 &&
        refunds[0].reason === 'ORDER_EXPIRED',
    );
  }
  check(
    "Razorpay's webhook for the same payment is taken, and changes nothing",
    webhook.status === 200 &&
      after.body?.status === order?.status &&
      after.body?.payment?.paidAt === order?.payment?.paidAt &&
      after.body?.payment?.refunds?.length === refunds.length,
  );

  const outcome = [
    `Order ${placed.reference}: ${order?.status ?? order?.message}`,
    ...refunds.map(
      (refund) =>
        `Refund of Rs ${refund.amountRupees} (${refund.reason}): ${refund.status}`,
    ),
    failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`,
  ].join('\n');
  console.log(`\n${outcome}`);
  return outcome;
}

main().catch((error) => {
  console.error(`\nPayment test stopped: ${error.message}`);
  console.error(
    'Are the API (pnpm api:dev) and Mailpit (docker compose) running?',
  );
  process.exitCode = 1;
});
