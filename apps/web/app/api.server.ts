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
import { data } from 'react-router';
import type { z } from 'zod';
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
  const url = new URL(`${getConfig().apiUrl}/v1/${path}`);
  if (query) {
    url.search = query.toString();
  }
  const headers = new Headers({ accept: 'application/json' });
  const ip = request.headers.get(CLIENT_IP_HEADER);
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
  const body: unknown = await response.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    console.error(`The API's answer to ${what} is not as expected`);
    throw unavailable();
  }
  return parsed.data;
}

// "Try again later", with how long to wait: the API's own figure when it
// gave a plain one, else a minute.
function unavailable(retryAfter?: string | null) {
  const wait = retryAfter && /^\d{1,4}$/.test(retryAfter) ? retryAfter : '60';
  return data(null, { status: 503, headers: { 'Retry-After': wait } });
}
