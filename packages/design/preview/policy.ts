// The preview's security policy: the same rules the shop will keep (ADR
// 0031, ADR 0036). Everything comes from the page's own origin. No inline
// script or style, no eval, and no string ever turned into HTML or script
// (Trusted Types). Nothing is sent anywhere.
export function contentSecurityPolicy({ inPage = false } = {}): string {
  const directives = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    "font-src 'self'",
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
export function securityHeaders({ withPolicy = true } = {}): Record<
  string,
  string
> {
  return {
    ...(withPolicy
      ? { 'Content-Security-Policy': contentSecurityPolicy() }
      : {}),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Robots-Tag': 'noindex, nofollow',
  };
}
