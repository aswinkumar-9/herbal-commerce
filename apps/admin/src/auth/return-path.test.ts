import { describe, expect, it } from 'vitest';
import { returnPath } from './return-path';

describe('the page to return to after signing in', () => {
  it('is the console page staff asked for, with its query', () => {
    expect(returnPath('/orders')).toBe('/orders');
    expect(returnPath('/catalog?page=2')).toBe('/catalog?page=2');
  });

  it.each([
    '//elsewhere.example/phish',
    '/\\elsewhere.example/phish',
    'https://elsewhere.example/phish',
    // oxlint-disable-next-line no-script-url -- checks such a link is refused
    'javascript:alert(1)',
    'orders',
    '/sign-in',
    '/sign-in?again=1',
    '',
  ])('is the overview instead of %j', (wanted) => {
    expect(returnPath(wanted)).toBe('/');
  });

  it('is the overview when nothing was asked for', () => {
    expect(returnPath(undefined)).toBe('/');
    expect(returnPath(null)).toBe('/');
    expect(returnPath({ pathname: '/orders' })).toBe('/');
  });
});
