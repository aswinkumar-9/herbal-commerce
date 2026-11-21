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
