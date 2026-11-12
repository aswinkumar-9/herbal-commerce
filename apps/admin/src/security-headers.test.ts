import { describe, expect, it } from 'vitest';
import {
  contentSecurityPolicy,
  mediaSource,
  securityHeaders,
} from './security-headers';

const MEDIA = 'http://127.0.0.1:3000/media';

describe("the console's Content Security Policy", () => {
  const policy = contentSecurityPolicy(MEDIA);

  it('allows only the console itself, and the shop images folder', () => {
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("script-src 'self';");
    expect(policy).toContain("style-src 'self';");
    expect(policy).toContain("connect-src 'self';");
    expect(policy).toContain("img-src 'self' http://127.0.0.1:3000/media/;");
  });

  it('allows no inline code, no eval, and no strings made into script', () => {
    expect(policy).not.toMatch(/unsafe-|data:|\*/);
    expect(policy).toContain("require-trusted-types-for 'script'");
    expect(policy).toContain("trusted-types 'none'");
  });

  it('lets no other site frame the console, and no form be sent without the script', () => {
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("object-src 'none'");
  });

  it('leaves frame-ancestors out of the page, where browsers ignore it', () => {
    expect(contentSecurityPolicy(MEDIA, { inPage: true })).not.toContain(
      'frame-ancestors',
    );
  });
});

describe('the images folder in the policy', () => {
  it('is the folder alone, for a laptop or a CDN', () => {
    expect(mediaSource('https://cdn.example.com/media/')).toBe(
      'https://cdn.example.com/media/',
    );
    expect(mediaSource('https://cdn.example.com')).toBe(
      'https://cdn.example.com/',
    );
  });

  it.each([
    "http://127.0.0.1:3000/media; script-src 'unsafe-inline'",
    "https://cdn.example.com/media'",
    'https://cdn.example.com/media *',
    'https://cdn.example.com/media,https://elsewhere.example',
    'ftp://cdn.example.com/media',
    '//cdn.example.com/media',
    '',
  ])('refuses %j, which could change the policy', (url) => {
    expect(() => mediaSource(url)).toThrow('ADMIN_MEDIA_BASE_URL');
  });
});

describe('the security headers', () => {
  it('stop sniffing, framing, referrers, unused browser features and indexing', () => {
    expect(securityHeaders(MEDIA)).toEqual({
      'Content-Security-Policy': contentSecurityPolicy(MEDIA),
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': expect.stringContaining('camera=()'),
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Robots-Tag': 'noindex, nofollow',
    });
  });

  it('leave the policy out for the dev server, whose hot reload is inline', () => {
    const headers = securityHeaders(MEDIA, { withPolicy: false });
    expect(headers).not.toHaveProperty('Content-Security-Policy');
    expect(headers['X-Frame-Options']).toBe('DENY');
  });
});
