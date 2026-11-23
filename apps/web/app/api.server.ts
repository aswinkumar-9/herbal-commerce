// How the website server asks the API (ADR 0039). Only the server does:
// the browser never calls the API for a page. Every answer is checked
// against what the page expects before it is used.
// - On behalf of a customer: their IP goes along, for the API's rate limits
//   (it counts only from a proxy its TRUST_PROXY names).
// - Not found (404): the page is "not found" too, unless the page asks with
//   apiFind, for an answer that may rightly be missing.
// - Busy, resting, unreachable or slow, or an answer that isn't as
//   expected: the page says the shop is taking a short break (503). The
//   reason goes to the server's log, never to the page.
// - Answers every visitor gets alike (the catalog and the policy pages,
//   asked with no customer's token) are kept for a short while: see below.
import { data } from 'react-router';
import { z } from 'zod';
import { getConfig } from './config.server.ts';
import { CLIENT_IP_HEADER } from './security-headers.ts';

// How long a page waits for the API.
export const API_TIMEOUT_MS = 8_000;

// One part of an address, such as a slug, made safe to put in a path.
export const segment = (value: string): string => encodeURIComponent(value);

export async function apiGet<T>(
  request: Request,
  path: string,
  schema: z.ZodType<T>,
  query?: URLSearchParams,
): Promise<T> {
  const found = await ask(request, path, schema, query);
  if (found === MISSING) {
    throw data(null, { status: 404 });
  }
  return found;
}

// For an answer that may rightly be missing, such as a policy page not
// published yet: null, where apiGet would make the page "not found".
export async function apiFind<T>(
  request: Request,
  path: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const found = await ask(request, path, schema);
  return found === MISSING ? null : found;
}

const MISSING = Symbol('missing');

async function ask<T>(
  request: Request,
  path: string,
  schema: z.ZodType<T>,
  query?: URLSearchParams,
): Promise<T | typeof MISSING> {
  const config = getConfig();
  const url = new URL(`${config.apiUrl}/v1/${path}`);
  if (query) {
    url.search = query.toString();
  }
  const found =
    config.apiCacheSeconds > 0
      ? await askShared(request, url, config.apiCacheSeconds)
      : await askApi(
          url,
          request.headers.get(CLIENT_IP_HEADER),
          request.signal,
        );
  if (found === MISSING) {
    return MISSING;
  }
  const parsed = schema.safeParse(found);
  if (!parsed.success) {
    kept.delete(url.href);
    console.error(`The API's answer to GET ${url.pathname} is not as expected`);
    throw unavailable();
  }
  return parsed.data;
}

// The kept answers (part 14B, after the Lighthouse audit). A built website
// keeps each for WEB_API_CACHE_SECONDS (60 by default), so the API is asked
// at most once a minute for each address, however many customers come, and
// customers asking at the same moment share one question. A failure is
// never kept. Prices and stock may lag the console by that long; an order
// always reads them afresh from the API (part 14C). At most KEEP_AT_MOST
// addresses are kept, the least recently used going first, so searches
// with ever new words can't fill the memory.
type Kept = { found: unknown; until: number };
const kept = new Map<string, Kept>();
const asking = new Map<string, Promise<unknown>>();
export const KEEP_AT_MOST = 500;

// For tests: start with nothing kept.
export function forgetKeptAnswers(): void {
  kept.clear();
  asking.clear();
}

async function askShared(
  request: Request,
  url: URL,
  seconds: number,
): Promise<unknown> {
  const key = url.href;
  const hit = kept.get(key);
  if (hit && hit.until > Date.now()) {
    kept.delete(key);
    kept.set(key, hit);
    return hit.found;
  }
  let shared = asking.get(key);
  if (!shared) {
    // Not tied to the first customer's request: others may be waiting on
    // it, so their leaving must not stop it. The API's own time limit does.
    shared = askApi(url, request.headers.get(CLIENT_IP_HEADER))
      .then((found) => {
        kept.delete(key);
        kept.set(key, { found, until: Date.now() + seconds * 1000 });
        for (const oldest of kept.keys()) {
          if (kept.size <= KEEP_AT_MOST) {
            break;
          }
          kept.delete(oldest);
        }
        return found;
      })
      .finally(() => asking.delete(key));
    // Handled even when every customer waiting on it has left already:
    // each who stays gets the failure their own way.
    shared.catch(() => undefined);
    asking.set(key, shared);
  }
  return whileWaiting(shared, request.signal);
}

// What a customer waits for, unless they leave first.
function whileWaiting<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const leave = (): void => reject(signal.reason);
    signal.addEventListener('abort', leave, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', leave));
  });
}

// One question to the API: its answer as it came, MISSING for not found.
async function askApi(
  url: URL,
  ip: string | null,
  signal?: AbortSignal,
): Promise<unknown> {
  const headers = new Headers({ accept: 'application/json' });
  if (ip) {
    headers.set('x-forwarded-for', ip);
  }
  // The log names the path only: search words stay out of it.
  const what = `GET ${url.pathname}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers,
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(API_TIMEOUT_MS)])
        : AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    console.error(`The API did not answer ${what}:`, error);
    throw unavailable();
  }

  if (response.status === 404) {
    await response.body?.cancel();
    return MISSING;
  }
  if (!response.ok) {
    await response.body?.cancel();
    console.error(`The API answered ${what} with ${response.status}`);
    throw unavailable(response.headers.get('retry-after'));
  }
  return response.json().catch(() => undefined);
}

// What the API said to a form or a signed-in page (part 14B): an answer, or
// its refusal for the page to explain beside the form. Never thrown. Status
// 0: the API could not be reached, was too slow, or answered unexpectedly.
export type ApiAnswer<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      status: number;
      code: string | undefined;
      message: string | undefined;
      // The API's word for each field it refused, first message only.
      fields: Record<string, string>;
      // From Retry-After, in seconds, when the API says how long to wait.
      retryAfter: number | undefined;
    };

const refusalSchema = z.object({
  message: z.union([z.string(), z.array(z.string())]).optional(),
  code: z.string().optional(),
  errors: z
    .array(z.object({ field: z.string(), message: z.string() }))
    .optional(),
});

const failed = (status: number): ApiAnswer<never> => ({
  ok: false,
  status,
  code: undefined,
  message: undefined,
  fields: {},
  retryAfter: undefined,
});

// Sends a form's words, or asks on a signed-in customer's behalf. The log
// names the method and path only: never a password, a token or an address.
export async function apiSend<T>(
  request: Request,
  {
    method,
    path,
    body,
    accessToken,
  }: {
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    path: string;
    body?: unknown;
    accessToken?: string | undefined;
  },
  schema: z.ZodType<T>,
): Promise<ApiAnswer<T>> {
  const url = new URL(`${getConfig().apiUrl}/v1/${path}`);
  const headers = new Headers({ accept: 'application/json' });
  if (body !== undefined) {
    headers.set('content-type', 'application/json');
  }
  if (accessToken) {
    headers.set('authorization', `Bearer ${accessToken}`);
  }
  const ip = request.headers.get(CLIENT_IP_HEADER);
  if (ip) {
    headers.set('x-forwarded-for', ip);
  }
  const what = `${method} ${url.pathname}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.any([
        request.signal,
        AbortSignal.timeout(API_TIMEOUT_MS),
      ]),
    });
  } catch (error) {
    if (request.signal.aborted) {
      throw error;
    }
    console.error(`The API did not answer ${what}:`, error);
    return failed(0);
  }

  if (response.ok) {
    const answer: unknown =
      response.status === 204
        ? undefined
        : await response.json().catch(() => undefined);
    const parsed = schema.safeParse(answer);
    if (!parsed.success) {
      console.error(`The API's answer to ${what} is not as expected`);
      return failed(0);
    }
    return { ok: true, data: parsed.data };
  }

  if (response.status >= 500) {
    console.error(`The API answered ${what} with ${response.status}`);
  }
  const refusal = refusalSchema.safeParse(
    await response.json().catch(() => undefined),
  );
  const said = refusal.success ? refusal.data : {};
  const fields: Record<string, string> = {};
  for (const { field, message } of said.errors ?? []) {
    if (!Object.hasOwn(fields, field)) {
      Object.defineProperty(fields, field, {
        value: message,
        enumerable: true,
      });
    }
  }
  const wait = response.headers.get('retry-after');
  return {
    ok: false,
    status: response.status,
    code: said.code,
    message: Array.isArray(said.message) ? said.message[0] : said.message,
    fields,
    retryAfter: wait && /^\d{1,5}$/.test(wait) ? Number(wait) : undefined,
  };
}

// "Try again later", with how long to wait: the API's own figure when it
// gave a plain one, else a minute.
export function unavailable(retryAfter?: string | null) {
  const wait = retryAfter && /^\d{1,4}$/.test(retryAfter) ? retryAfter : '60';
  return data(null, { status: 503, headers: { 'Retry-After': wait } });
}
