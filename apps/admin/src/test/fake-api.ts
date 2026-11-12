import { vi } from 'vitest';

export interface SentRequest {
  method: string;
  path: string;
  authorization: string | null;
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
// and keeps giving the last answer. Anything else fails the test.
export function fakeApi(routes: Record<string, Answer | Answer[]>) {
  const sent: SentRequest[] = [];
  const unexpected: string[] = [];
  const asked = new Map<string, number>();

  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const path = String(input);
      const key = `${method} ${path}`;
      sent.push({
        method,
        path,
        authorization: new Headers(init.headers).get('Authorization'),
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
        init,
      });
      const route = routes[key];
      if (!route) {
        unexpected.push(key);
        throw new Error(`The fake API has no answer for ${key}`);
      }
      const answers = Array.isArray(route) ? route : [route];
      const turn = asked.get(key) ?? 0;
      asked.set(key, turn + 1);
      const answer = answers[Math.min(turn, answers.length - 1)];
      const result = await answer?.();
      if (!result || result instanceof Error) {
        throw new TypeError('Failed to fetch');
      }
      return result;
    },
  );
  vi.stubGlobal('fetch', fetchMock);

  return {
    sent,
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
