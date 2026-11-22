// Where to go after signing in (part 14B): a page of this website only.
// Anything else, such as another site ("//evil.example", "/\evil.example",
// "https://…"), a control character or one of the account's own forms,
// goes to the account. Never a form from an emailed link: a link that
// leads there through signing in could carry someone else's token.
const HOME = 'http://website.invalid';
export const AFTER_SIGN_IN = '/account';
const ACCOUNT_FORMS = new Set([
  '/sign-in',
  '/sign-out',
  '/sign-up',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
]);

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
  if (url.origin !== HOME || ACCOUNT_FORMS.has(url.pathname)) {
    return AFTER_SIGN_IN;
  }
  return `${url.pathname}${url.search}`;
}
