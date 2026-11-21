// Where to go after signing in (part 14B): a page of this website only.
// Anything else, such as another site ("//evil.example", "/\evil.example",
// "https://…"), a control character or the sign-in page itself, goes to
// the account.
const HOME = 'http://website.invalid';
export const AFTER_SIGN_IN = '/account';

export function safeNext(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 512 ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    // oxlint-disable-next-line no-control-regex -- finding them is the point
    /[\u0000-\u001f\u007f\\]/.test(value)
  ) {
    return AFTER_SIGN_IN;
  }
  const url = new URL(value, HOME);
  if (
    url.origin !== HOME ||
    url.pathname === '/sign-in' ||
    url.pathname === '/sign-out'
  ) {
    return AFTER_SIGN_IN;
  }
  return `${url.pathname}${url.search}`;
}
