import { vi } from 'vitest';

export interface SentRequest {
  method: string;
  path: string;
  authorization: string | null;
  // JSON, parsed; an upload's file as it was sent.
  body: unknown;
  init: RequestInit;
}

// One answer, made fresh each time (a Response can be read only once). An
// Error stands for a request that never reached the server. A promise lets
// a test hold the answer back.
type Answer = () => Response | Error | Promise<Response | Error>;

export function json(
  status: number,
  body?: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export const tokens = (accessToken: string) => ({
  accessToken,
  tokenType: 'Bearer',
  expiresIn: 900,
});

export const ASHA = {
  id: 'staff-1',
  email: 'asha@example.com',
  fullName: 'Asha Verma',
  role: 'ADMIN',
  mfaEnabledAt: '2026-11-01T10:00:00.000Z',
  createdAt: '2026-11-01T09:00:00.000Z',
} as const;

export const RAVI = {
  ...ASHA,
  id: 'staff-2',
  email: 'ravi@example.com',
  fullName: 'Ravi Kumar',
  role: 'SUPER_USER',
} as const;

// A stand-in for the API: each "METHOD /path" answers with its list in turn,
// and keeps giving the last answer. Anything else fails the test. It stands
// in for fetch, and for XMLHttpRequest, which uploads go through.
export function fakeApi(routes: Record<string, Answer | Answer[]>) {
  const sent: SentRequest[] = [];
  const unexpected: string[] = [];
  const asked = new Map<string, number>();

  // The answer to a request, or an Error when it never reached the server.
  async function respond(init: RequestInit, path: string) {
    const method = init.method ?? 'GET';
    const key = `${method} ${path}`;
    sent.push({
      method,
      path,
      authorization: new Headers(init.headers).get('Authorization'),
      body:
        typeof init.body === 'string'
          ? JSON.parse(init.body)
          : (init.body ?? undefined),
      init,
    });
    const route = routes[key];
    if (!route) {
      unexpected.push(key);
      return new Error(`The fake API has no answer for ${key}`);
    }
    const answers = Array.isArray(route) ? route : [route];
    const turn = asked.get(key) ?? 0;
    asked.set(key, turn + 1);
    const answer = answers[Math.min(turn, answers.length - 1)];
    return (await answer?.()) ?? new Error('No answer');
  }

  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const result = await respond(init, String(input));
      if (result instanceof Error) {
        throw new TypeError('Failed to fetch');
      }
      return result;
    },
  );
  vi.stubGlobal('fetch', fetchMock);
  const sending = new Set<() => void>();
  vi.stubGlobal('XMLHttpRequest', fakeXhr(respond, sending));

  return {
    sent,
    // Every upload still waiting for its answer has sent all its file: the
    // server is checking it.
    allSent: () => {
      for (const finish of sending) {
        finish();
      }
    },
    // Requests the test did not expect (the console turns them into
    // "can't reach the server", so they would otherwise go unnoticed).
    unexpected,
    to: (method: string, path: string) =>
      sent.filter(
        (request) => request.method === method && request.path === path,
      ),
  };
}

export const offline = () => new Error('offline');

// The part of XMLHttpRequest the console uses, for one upload at a time.
// Half the file has gone as soon as it is sent; the rest goes when the
// answer comes, so a test that holds the answer back sees the upload half
// way (allSent sends the rest before the answer). abort() calls it off at
// any point.
function fakeXhr(
  respond: (init: RequestInit, path: string) => Promise<Response | Error>,
  sending: Set<() => void>,
) {
  return class FakeXMLHttpRequest {
    readonly upload: {
      onprogress: ((event: ProgressEvent) => void) | null;
    } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    responseType = '';
    status = 0;
    responseText = '';
    private method = 'GET';
    private path = '';
    private readonly headers = new Headers();
    private answer: Response | null = null;
    private done = false;

    open(method: string, path: string) {
      this.method = method;
      this.path = path;
    }

    setRequestHeader(name: string, value: string) {
      this.headers.set(name, value);
    }

    getResponseHeader(name: string) {
      return this.answer?.headers.get(name) ?? null;
    }

    abort() {
      if (!this.done) {
        this.done = true;
        this.onabort?.();
      }
    }

    send(body: Blob) {
      const init: RequestInit = {
        method: this.method,
        headers: this.headers,
        body,
      };
      const total = body.size;
      const progress = (loaded: number) =>
        this.upload.onprogress?.(
          new ProgressEvent('progress', {
            lengthComputable: true,
            loaded,
            total,
          }),
        );
      const sendRest = () => progress(total);
      queueMicrotask(() => {
        if (this.done) {
          return;
        }
        progress(Math.floor(total / 2));
        sending.add(sendRest);
        void respond(init, this.path).then(async (result) => {
          sending.delete(sendRest);
          if (this.done) {
            return;
          }
          this.done = true;
          if (result instanceof Error) {
            this.onerror?.();
            return;
          }
          progress(total);
          this.answer = result;
          this.status = result.status;
          this.responseText = await result.text();
          this.onload?.();
        });
      });
    }
  };
}
