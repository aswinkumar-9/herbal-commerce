import { describe, expect, it } from 'vitest';
import {
  FILE_POLICY,
  baseHeaders,
  documentPolicy,
  mediaSource,
} from './security-headers.ts';

const NONCE = 'KKVeEsZizFbpt8YuGiMR4Q==';
const MEDIA = 'http://127.0.0.1:3000/media';

const directives = (policy: string): Map<string, string> =>
  new Map(
    policy.split('; ').map((directive) => {
      const [name = '', ...values] = directive.split(' ');
      return [name, values.join(' ')];
    }),
  );

describe('a page’s security policy', () => {
  const policy = directives(
    documentPolicy({ nonce: NONCE, mediaBaseUrl: MEDIA }),
  );

  it('allows scripts from the website and inline ones with this page’s nonce only', () => {
    expect(policy.get('script-src')).toBe(`'self' 'nonce-${NONCE}'`);
  });

  it('allows nothing it doesn’t name, and nothing inline but nonced scripts', () => {
    expect(policy.get('default-src')).toBe("'none'");
    expect(policy.get('style-src')).toBe("'self'");
    expect(policy.get('font-src')).toBe("'self'");
    expect(policy.get('connect-src')).toBe("'self'");
    expect(policy.get('object-src')).toBe("'none'");
    expect(policy.get('base-uri')).toBe("'none'");
    const text = documentPolicy({ nonce: NONCE, mediaBaseUrl: MEDIA });
    for (const loose of [
      "'unsafe-inline'",
      "'unsafe-eval'",
      "'unsafe-hashes'",
      "'strict-dynamic'",
      'data:',
      ' * ',
    ]) {
      expect(text).not.toContain(loose);
    }
  });

  it('shows pictures from the website and the product photos’ folder only', () => {
    expect(policy.get('img-src')).toBe(`'self' ${MEDIA}/`);
  });

  it('turns no string into HTML or script (Trusted Types)', () => {
    expect(policy.get('require-trusted-types-for')).toBe("'script'");
    expect(policy.get('trusted-types')).toBe("'none'");
  });

  it('sends forms only to the website, and can’t be framed', () => {
    expect(policy.get('form-action')).toBe("'self'");
    expect(policy.get('frame-ancestors')).toBe("'none'");
  });

  it('refuses a nonce that isn’t base64, so nothing can be slipped into the policy', () => {
    for (const nonce of [
      '',
      'short',
      "abc'; script-src *",
      'KKVeEsZizFbpt8YuGiMR4Q== x',
    ]) {
      expect(() => documentPolicy({ nonce, mediaBaseUrl: MEDIA })).toThrow(
        'base64 nonce',
      );
    }
  });
});

describe('the product photos’ folder', () => {
  it('ends in one "/", so nothing above the folder is allowed', () => {
    expect(mediaSource(MEDIA)).toBe(`${MEDIA}/`);
    expect(mediaSource(`${MEDIA}//`)).toBe(`${MEDIA}/`);
  });
});

describe('the policy for everything that is not a page', () => {
  it('lets nothing run, and nobody frame it', () => {
    expect(FILE_POLICY).toBe("default-src 'none'; frame-ancestors 'none'");
  });
});

describe('the headers on every answer', () => {
  it('keeps browsers from guessing types, framing, sending the address on, or using devices', () => {
    const headers = baseHeaders({ indexing: false, https: false });
    expect(headers).toMatchObject({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    expect(headers['Permissions-Policy']).toContain('camera=()');
    expect(headers['Permissions-Policy']).toContain('geolocation=()');
  });

  it('asks search engines to stay away until the live shop turns indexing on', () => {
    expect(baseHeaders({ indexing: false, https: false })['X-Robots-Tag']).toBe(
      'noindex, nofollow',
    );
    expect(baseHeaders({ indexing: true, https: false })).not.toHaveProperty(
      'X-Robots-Tag',
    );
  });

  it('keeps browsers on https once the website is on https', () => {
    expect(baseHeaders({ indexing: false, https: false })).not.toHaveProperty(
      'Strict-Transport-Security',
    );
    expect(
      baseHeaders({ indexing: false, https: true })[
        'Strict-Transport-Security'
      ],
    ).toBe('max-age=31536000; includeSubDomains');
  });
});
