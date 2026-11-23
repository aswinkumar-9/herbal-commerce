// A customer's sign-in on the website (part 14B, ADR 0041). The website
// server keeps the API's tokens; the browser only holds them sealed in a
// cookie its scripts can't read:
// - sealed with AES-256-GCM under a key made from WEB_SESSION_SECRET, so it
//   can be neither read nor changed without that key;
// - HttpOnly, SameSite=Lax, for the whole site, and in production Secure,
//   named __Host-, so no other site or subdomain can set it;
// - lasting the API's session, 30 days from signing in, the owner's choice.
// Every page and data request passes through this middleware first: it
// opens the cookie, renews the 15 minute access token a minute before it
// ends, and after the page writes the cookie again when it changed.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import { createContext, redirect } from 'react-router';
import type { MiddlewareFunction, RouterContextProvider } from 'react-router';
import { z } from 'zod';
import { apiSend } from './api.server.ts';
import { getConfig } from './config.server.ts';

// The API's session lasts 30 days from signing in (ADR 0007).
export const SESSION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
// An access token this close to its end is renewed first.
const RENEW_BEFORE_MS = 60_000;
// A renewal is shared with requests that come with the same old cookie
// this long after it, such as a second tab, so the API never sees the old
// refresh token twice (it would end the session, thinking it stolen).
const SHARE_RENEWAL_MS = 60_000;
// Browsers keep cookies up to 4 kB.
const MAX_COOKIE = 4000;

export interface CustomerSession {
  accessToken: string;
  refreshToken: string;
  // When the access token ends, and when the whole session does (ms).
  accessEndsAt: number;
  endsAt: number;
}

const sealedSchema = z.object({
  v: z.literal(1),
  a: z.string().min(1).max(2000),
  r: z.string().min(20).max(200),
  ax: z.number().int().positive(),
  e: z.number().int().positive(),
});

// The API's answer to signing in and to a renewal.
export const tokenSchema = z.object({
  accessToken: z.string().min(1).max(2000),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int().positive().max(86_400),
  refreshToken: z.string().min(20).max(200),
});
export type Tokens = z.infer<typeof tokenSchema>;

export function cookieName(origin: string): string {
  return origin.startsWith('https://')
    ? '__Host-herbal_session'
    : 'herbal_session';
}

function keyOf(secret: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', secret, '', 'herbal web session v1', 32),
  );
}

// "v1.<iv>.<sealed>", base64url. The cookie's name is part of what is
// sealed, so a value can't be moved to another cookie.
export function seal(
  session: CustomerSession,
  secret: string,
  name: string,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyOf(secret), iv);
  cipher.setAAD(Buffer.from(name));
  const plain = JSON.stringify({
    v: 1,
    a: session.accessToken,
    r: session.refreshToken,
    ax: session.accessEndsAt,
    e: session.endsAt,
  });
  const sealed = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return `v1.${iv.toString('base64url')}.${sealed.toString('base64url')}`;
}

// The session in a sealed value, or null for anything else: changed,
// sealed under another key or for another cookie, or not a session.
export function unseal(
  value: string,
  secret: string,
  name: string,
): CustomerSession | null {
  const parts = value.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || value.length > MAX_COOKIE) {
    return null;
  }
  try {
    const iv = Buffer.from(parts[1] ?? '', 'base64url');
    const sealed = Buffer.from(parts[2] ?? '', 'base64url');
    if (iv.length !== 12 || sealed.length <= 16) {
      return null;
    }
    const decipher = createDecipheriv('aes-256-gcm', keyOf(secret), iv);
    decipher.setAAD(Buffer.from(name));
    decipher.setAuthTag(sealed.subarray(-16));
    const plain = Buffer.concat([
      decipher.update(sealed.subarray(0, -16)),
      decipher.final(),
    ]).toString('utf8');
    const parsed = sealedSchema.safeParse(JSON.parse(plain));
    if (!parsed.success) {
      return null;
    }
    return {
      accessToken: parsed.data.a,
      refreshToken: parsed.data.r,
      accessEndsAt: parsed.data.ax,
      endsAt: parsed.data.e,
    };
  } catch {
    return null;
  }
}

// One cookie's value from a Cookie header, by its exact name.
export function readCookie(header: string | null, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) {
      return part.slice(at + 1).trim();
    }
  }
  return null;
}

export function cookieHeader(
  name: string,
  value: string,
  maxAge: number,
): string {
  const secure = name.startsWith('__Host-') ? '; Secure' : '';
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

// A session from the API's tokens, as signing in makes it.
export function sessionFrom(
  tokens: Tokens,
  now: number,
  endsAt = now + SESSION_DAYS * DAY_MS,
): CustomerSession {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessEndsAt: now + tokens.expiresIn * 1000,
    endsAt,
  };
}

// The request's session, for loaders and actions, which sign in and out
// through it; the middleware writes the cookie afterwards.
export class SessionHandle {
  #session: CustomerSession | null;
  #changed: boolean;

  constructor(session: CustomerSession | null, changed = false) {
    this.#session = session;
    this.#changed = changed;
  }

  get current(): CustomerSession | null {
    return this.#session;
  }

  get changed(): boolean {
    return this.#changed;
  }

  signIn(tokens: Tokens, now = Date.now()): void {
    this.#session = sessionFrom(tokens, now);
    this.#changed = true;
  }

  signOut(): void {
    this.#session = null;
    this.#changed = true;
  }
}

// Set by the middleware for each request; never one shared default, which
// one request could sign in for another.
export const sessionContext = createContext<SessionHandle | null>(null);

export function sessionOf(
  context: Readonly<RouterContextProvider>,
): SessionHandle {
  const handle = context.get(sessionContext);
  if (!handle) {
    throw new Error('The session middleware did not run for this request');
  }
  return handle;
}

// A page only for a signed-in customer: the session, or off to sign in,
// coming back here afterwards.
export function requireCustomer(
  request: Request,
  context: Readonly<RouterContextProvider>,
): CustomerSession {
  const session = sessionOf(context).current;
  if (!session) {
    throw redirect(signInHref(request));
  }
  return session;
}

export function signInHref(request: Request): string {
  const url = new URL(request.url);
  // A data request's address ends in .data: the page is without it.
  const path = url.pathname.replace(/\.data$/, '') || '/';
  return `/sign-in?next=${encodeURIComponent(`${path}${url.search}`)}`;
}

type Renewal =
  | { kind: 'renewed'; session: CustomerSession }
  | { kind: 'refused' }
  | { kind: 'unreachable' };

const renewals = new Map<
  string,
  { renewal: Promise<Renewal>; settledAt?: number }
>();

// For the tests: forget every shared renewal.
export function forgetRenewals(): void {
  renewals.clear();
}

// Renews a session's tokens with the API, once for any number of requests
// that come with the same old refresh token at about the same time. This
// holds for one website server; more than one would share it through a
// store such as Valkey (ADR 0041).
function renew(request: Request, session: CustomerSession): Promise<Renewal> {
  const now = Date.now();
  for (const [key, entry] of renewals) {
    if (
      entry.settledAt !== undefined &&
      now - entry.settledAt > SHARE_RENEWAL_MS
    ) {
      renewals.delete(key);
    }
  }
  const key = createHash('sha256').update(session.refreshToken).digest('hex');
  const shared = renewals.get(key);
  if (shared) {
    return shared.renewal;
  }
  const entry: { renewal: Promise<Renewal>; settledAt?: number } = {
    renewal: (async (): Promise<Renewal> => {
      const answer = await apiSend(
        request,
        {
          method: 'POST',
          path: 'auth/refresh',
          body: { refreshToken: session.refreshToken },
        },
        tokenSchema,
      );
      if (answer.ok) {
        return {
          kind: 'renewed',
          session: sessionFrom(answer.data, Date.now(), session.endsAt),
        };
      }
      return answer.status === 401
        ? { kind: 'refused' }
        : { kind: 'unreachable' };
    })(),
  };
  renewals.set(key, entry);
  void entry.renewal.then((renewal) => {
    // A renewal that could not reach the API is tried again next time.
    if (renewal.kind === 'unreachable') {
      renewals.delete(key);
    } else {
      entry.settledAt = Date.now();
    }
  });
  return entry.renewal;
}

// Runs before every page and data request (root.tsx).
export const sessionMiddleware: MiddlewareFunction<Response> = async (
  { request, context },
  next,
) => {
  const { origin, sessionSecret } = getConfig();
  const name = cookieName(origin);
  const sealed = readCookie(request.headers.get('cookie'), name);
  let session = sealed ? unseal(sealed, sessionSecret, name) : null;
  // A cookie that doesn't open is cleared.
  let changed = sealed !== null && session === null;
  const now = Date.now();
  if (session && session.endsAt <= now) {
    session = null;
    changed = true;
  }
  if (session && session.accessEndsAt - now < RENEW_BEFORE_MS) {
    const renewal = await renew(request, session);
    if (renewal.kind === 'renewed') {
      session = renewal.session;
      changed = true;
    } else if (renewal.kind === 'refused') {
      // Signed out elsewhere, ended, or the account closed.
      session = null;
      changed = true;
    }
    // Unreachable: the page asks the API itself, and says it is resting.
  }
  const handle = new SessionHandle(session, changed);
  context.set(sessionContext, handle);

  const response = await next();

  if (handle.changed) {
    const current = handle.current;
    response.headers.append(
      'Set-Cookie',
      current
        ? cookieHeader(
            name,
            seal(current, sessionSecret, name),
            Math.max(0, Math.round((current.endsAt - Date.now()) / 1000)),
          )
        : cookieHeader(name, '', 0),
    );
  }
  // A signed-in page is the customer's own: never kept by any cache, or
  // shown again from the browser's history after signing out.
  if (handle.current) {
    response.headers.set('Cache-Control', 'private, no-store');
  }
  return response;
};
