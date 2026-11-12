// Where to go after signing in: the console page staff asked for, never
// another site (an open redirect), and never back to the sign-in page.
export function returnPath(wanted: unknown): string {
  if (typeof wanted !== 'string' || !wanted.startsWith('/')) {
    return '/';
  }
  const origin = window.location.origin;
  let url: URL;
  try {
    url = new URL(wanted, origin);
  } catch {
    return '/';
  }
  // "//elsewhere.example" and "/\elsewhere.example" leave the origin.
  if (url.origin !== origin || url.pathname.startsWith('/sign-in')) {
    return '/';
  }
  return `${url.pathname}${url.search}`;
}
