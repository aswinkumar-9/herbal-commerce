// The admin console's security headers (ADR 0031). Vite's preview server
// sends them, the build puts the policy into index.html as well, and the
// host that serves the console in production must send the same.

// Where the shop's images come from: the API's MEDIA_BASE_URL. On a laptop
// that is the API itself; later a CDN. Its characters are limited so that it
// can never change the policy around it.
export const DEFAULT_MEDIA_BASE_URL = 'http://127.0.0.1:3000/media';
const MEDIA_BASE_URL =
  /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._~/-]*)?$/;

export function mediaSource(baseUrl: string): string {
  if (!MEDIA_BASE_URL.test(baseUrl)) {
    throw new Error(
      `ADMIN_MEDIA_BASE_URL must be a plain http or https address, not "${baseUrl}"`,
    );
  }
  // With the final "/", the policy allows that folder and nothing above it.
  return `${baseUrl.replace(/\/+$/, '')}/`;
}

// Everything comes from the console's own origin, except the shop's images.
// No inline script or style, no eval, and no string ever turned into HTML or
// script (Trusted Types). The page cannot be framed, and its form can only
// be sent by the script.
export function contentSecurityPolicy(
  mediaBaseUrl: string,
  { inPage = false } = {},
): string {
  const directives = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    `img-src 'self' ${mediaSource(mediaBaseUrl)}`,
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
    "require-trusted-types-for 'script'",
    "trusted-types 'none'",
  ];
  // Browsers ignore frame-ancestors in a <meta> policy, and warn about it.
  if (!inPage) {
    directives.push("frame-ancestors 'none'");
  }
  return directives.join('; ');
}

// The headers without the policy suit Vite's dev server, whose own scripts
// (hot reload) are inline.
export function securityHeaders(
  mediaBaseUrl: string,
  { withPolicy = true } = {},
): Record<string, string> {
  return {
    ...(withPolicy
      ? { 'Content-Security-Policy': contentSecurityPolicy(mediaBaseUrl) }
      : {}),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy':
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), browsing-topics=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Robots-Tag': 'noindex, nofollow',
  };
}
