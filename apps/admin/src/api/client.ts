import { z } from 'zod';
import { accessToken, setAccessToken } from './access-token';
import { ApiError, UNREACHABLE } from './api-error';

// The console talks only to its own API, on its own origin: Vite's proxy in
// development, the same host in production. The access token is never sent
// anywhere else, even by mistake.
const API_PREFIX = '/v1/';
const REFRESH_PATH = '/v1/staff/auth/refresh';
const REFRESH_LOCK = 'herbal-staff-refresh';

// What the API answers to a staff sign-in or renewal from the console. The
// refresh token is not in it: it stays in the HttpOnly cookie.
export const tokenSchema = z.object({
  accessToken: z.string().min(1),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int().positive(),
});

const errorBodySchema = z.object({
  message: z.union([z.string(), z.array(z.string())]).optional(),
  code: z.string().optional(),
  errors: z
    .array(z.object({ field: z.string(), message: z.string() }))
    .optional(),
});

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  // Sign-in, renewal and sign-out go without the access token.
  anonymous?: boolean;
}

type Listener = () => void;
const sessionLostListeners = new Set<Listener>();

// Called when the session ends while staff are using the console: the access
// token expired and the cookie could not renew it (the 12 hours ran out, or
// the session was ended elsewhere).
export function onSessionLost(listener: Listener): () => void {
  sessionLostListeners.add(listener);
  return () => {
    sessionLostListeners.delete(listener);
  };
}

// Every answer is checked against the shape the console expects, so a
// surprise from the server is an error, never a half-read page.
export function apiRequest<T>(
  path: string,
  options: RequestOptions & { schema: z.ZodType<T> },
): Promise<T>;
export function apiRequest(
  path: string,
  options?: RequestOptions,
): Promise<void>;
export async function apiRequest(
  path: string,
  options: RequestOptions & { schema?: z.ZodType } = {},
): Promise<unknown> {
  const token = options.anonymous ? null : accessToken();
  let response = await send(path, options, token);

  if (response.status === 401 && token !== null) {
    // The access token ran out (it lives 15 minutes): renew it once through
    // the cookie, and try again.
    if (!(await renewSession())) {
      for (const listener of sessionLostListeners) {
        listener();
      }
      throw await failure(response);
    }
    response = await send(path, options, accessToken());
  }

  if (!response.ok) {
    throw await failure(response);
  }
  return options.schema ? read(response, options.schema) : undefined;
}

let renewing: Promise<boolean> | null = null;

// Swaps the cookie's refresh token for a new pair; false when the API
// refuses it (no session, or an ended one). One renewal at a time: the API
// ends the whole session when a refresh token comes back after it was
// swapped, because that looks stolen. So callers in this tab share one
// renewal, and tabs take turns through the Web Locks API, each sending the
// cookie the previous one set.
export function renewSession(): Promise<boolean> {
  renewing ??= inTurn(swapRefreshToken).finally(() => {
    renewing = null;
  });
  return renewing;
}

async function swapRefreshToken(): Promise<boolean> {
  const response = await send(REFRESH_PATH, { method: 'POST' }, null);
  if (response.status === 401) {
    setAccessToken(null);
    return false;
  }
  if (!response.ok) {
    throw await failure(response);
  }
  const tokens = await read(response, tokenSchema);
  setAccessToken(tokens.accessToken);
  return true;
}

function inTurn<T>(task: () => Promise<T>): Promise<T> {
  // Older browsers and the test runner have no Web Locks.
  const locks: LockManager | undefined = globalThis.navigator?.locks;
  return locks ? locks.request(REFRESH_LOCK, task) : task();
}

async function send(
  path: string,
  options: RequestOptions,
  token: string | null,
): Promise<Response> {
  if (!path.startsWith(API_PREFIX)) {
    throw new Error(`Not an API path: ${path}`);
  }
  const headers = new Headers({ Accept: 'application/json' });
  if (token !== null) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers,
    // The cookie goes to this origin only, and staff data is never kept in
    // the browser's cache.
    credentials: 'same-origin',
    cache: 'no-store',
  };
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    init.body = JSON.stringify(options.body);
  }
  if (options.signal) {
    init.signal = options.signal;
  }
  try {
    return await fetch(path, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new ApiError(0, UNREACHABLE);
  }
}

async function read<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    throw new ApiError(
      response.status,
      'The server sent an answer the console does not understand.',
    );
  }
  return parsed.data;
}

async function failure(response: Response): Promise<ApiError> {
  const parsed = errorBodySchema.safeParse(
    await response.json().catch(() => null),
  );
  const body = parsed.success ? parsed.data : {};
  const message = Array.isArray(body.message)
    ? body.message.join(' ')
    : body.message;
  const retryAfter = Number(response.headers.get('Retry-After'));
  return new ApiError(response.status, message ?? 'The request failed.', {
    code: body.code,
    retryAfterSeconds:
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    fieldErrors: body.errors,
  });
}
