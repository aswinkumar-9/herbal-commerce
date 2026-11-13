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
  const response = await authorised(options.anonymous, (token) =>
    send(path, options, token),
  );
  if (!response.ok) {
    throw await failure(response);
  }
  return options.schema ? read(response, options.schema) : undefined;
}

export interface UploadOptions<T> {
  schema: z.ZodType<T>;
  // How much of the file has gone, from 0 to 1.
  onProgress?: (sent: number) => void;
  signal?: AbortSignal;
}

// Sends a file as the request body, with its own type as the Content-Type,
// and says how much of it has gone. fetch cannot tell, so uploads go through
// XMLHttpRequest, with the same rules as every other request: the API's own
// origin only, the access token renewed once, the answer checked.
export async function apiUpload<T>(
  path: string,
  file: Blob,
  options: UploadOptions<T>,
): Promise<T> {
  const response = await authorised(false, (token) =>
    upload(path, file, options, token),
  );
  if (!response.ok) {
    throw await failure(response);
  }
  return read(response, options.schema);
}

// Sends with the access token. When the API says it ran out (it lives 15
// minutes), renews it once through the cookie and sends again; when the
// cookie cannot renew it, the session is over.
async function authorised(
  anonymous: boolean | undefined,
  sendWith: (token: string | null) => Promise<Response>,
): Promise<Response> {
  const token = anonymous ? null : accessToken();
  const response = await sendWith(token);
  if (response.status !== 401 || token === null) {
    return response;
  }
  if (!(await renewSession())) {
    for (const listener of sessionLostListeners) {
      listener();
    }
    throw await failure(response);
  }
  return sendWith(accessToken());
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
  checkPath(path);
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

// One upload, answered as a Response, so it is read like any other answer.
// The answer's only header the console reads is Retry-After.
function upload(
  path: string,
  file: Blob,
  { onProgress, signal }: Omit<UploadOptions<unknown>, 'schema'>,
  token: string | null,
): Promise<Response> {
  checkPath(path);
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(stopped());
      return;
    }
    const request = new XMLHttpRequest();
    request.open('POST', path);
    request.setRequestHeader('Accept', 'application/json');
    request.setRequestHeader('Content-Type', file.type);
    if (token !== null) {
      request.setRequestHeader('Authorization', `Bearer ${token}`);
    }
    request.responseType = 'text';
    const stop = () => request.abort();
    signal?.addEventListener('abort', stop, { once: true });

    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(Math.min(1, event.loaded / event.total));
      }
    };
    request.onload = () => {
      signal?.removeEventListener('abort', stop);
      const { status } = request;
      if (status < 200 || status > 599) {
        reject(new ApiError(0, UNREACHABLE));
        return;
      }
      const headers = new Headers();
      const retryAfter = request.getResponseHeader('Retry-After');
      if (retryAfter !== null) {
        headers.set('Retry-After', retryAfter);
      }
      // A 204 has no body; any other answer's body is its JSON.
      const body =
        status === 204 || !request.responseText ? null : request.responseText;
      resolve(new Response(body, { status, headers }));
    };
    request.onerror = () => {
      signal?.removeEventListener('abort', stop);
      reject(new ApiError(0, UNREACHABLE));
    };
    request.onabort = () => {
      signal?.removeEventListener('abort', stop);
      reject(stopped());
    };
    request.send(file);
  });
}

// The same error fetch gives for a request that was called off.
function stopped(): DOMException {
  return new DOMException('The upload was stopped.', 'AbortError');
}

// The console talks only to its own API (see API_PREFIX).
function checkPath(path: string): void {
  if (!path.startsWith(API_PREFIX)) {
    throw new Error(`Not an API path: ${path}`);
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
