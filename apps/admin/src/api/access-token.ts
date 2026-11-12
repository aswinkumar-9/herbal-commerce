// The staff access token lives here, in memory only: never in localStorage,
// sessionStorage or a cookie the page can read. A reload starts without it,
// and the session comes back through the HttpOnly refresh cookie, which no
// script can read (ADR 0031).
let current: string | null = null;

export function accessToken(): string | null {
  return current;
}

export function setAccessToken(token: string | null): void {
  current = token;
}
