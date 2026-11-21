// The website's security headers (ADR 0039). The website server sends the
// headers below with every answer. A page made on the server also gets its
// own Content Security Policy, with a nonce: a new random key for that page
// alone, which only the page's own inline scripts carry (entry.server.tsx).

// The one header the website server writes for the page code: the
// customer's IP, as the server saw it, for the API's rate limits. The
// server removes any copy a visitor sent before writing its own.
export const CLIENT_IP_HEADER = 'x-herbal-client-ip';

// A nonce is base64: 16 random bytes make 24 characters.
const NONCE = /^[A-Za-z0-9+/]{22,}={0,2}$/;

// The folder the product photos come from, closed with "/" so the policy
// allows that folder and nothing above it. config.server.ts has checked it
// is a plain address.
export function mediaSource(mediaBaseUrl: string): string {
  return `${mediaBaseUrl.replace(/\/+$/, '')}/`;
}

// A page's policy. Everything comes from the website itself, except the
// product photos. Scripts: the website's files, and inline only with this
// page's nonce (React Router's start-up data). No inline style, no eval,
// and no string ever turned into HTML or script (Trusted Types). Forms
// may only go to the website. Nobody may frame the page.
export function documentPolicy({
  nonce,
  mediaBaseUrl,
}: {
  nonce: string;
  mediaBaseUrl: string;
}): string {
  if (!NONCE.test(nonce)) {
    throw new Error('A page policy needs a base64 nonce');
  }
  return [
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self'",
    `img-src 'self' ${mediaSource(mediaBaseUrl)}`,
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "require-trusted-types-for 'script'",
    "trusted-types 'none'",
  ].join('; ');
}

// For everything that is not a page (the website's files, the data a page
// asks for as the customer moves on): nothing may run in it if it is ever
// opened on its own.
export const FILE_POLICY = "default-src 'none'; frame-ancestors 'none'";

// Sent with every answer.
export function baseHeaders({
  indexing,
  https,
}: {
  indexing: boolean;
  https: boolean;
}): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    // No other site learns which page a customer came from. Within the
    // website, a form keeps its real Origin: under no-referrer, a browser
    // sends a form without the page's script with Origin "null", which
    // the form check rightly refuses (ADR 0041).
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy':
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), browsing-topics=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    ...(indexing ? {} : { 'X-Robots-Tag': 'noindex, nofollow' }),
    ...(https
      ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }
      : {}),
  };
}
