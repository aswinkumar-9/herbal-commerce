import { RouterContextProvider } from 'react-router';
import { SessionHandle, sessionContext } from '../session.server.ts';
import type { CustomerSession } from '../session.server.ts';

// Calling a page's loader or action in a test, as React Router would.

// An answer from the stand-in API.
export const answer = (
  status: number,
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

// The request's context, with the session the middleware would have opened.
export function contextWith(session: CustomerSession | null) {
  const context = new RouterContextProvider();
  const handle = new SessionHandle(session);
  context.set(sessionContext, handle);
  return { context, handle };
}

// A form sent to a page.
export const post = (url: string, fields: Record<string, string>) =>
  new Request(url, { method: 'POST', body: new URLSearchParams(fields) });

// What a loader or action threw or gave back, as a status and a value.
export async function outcome(run: () => unknown) {
  try {
    const value = await run();
    const given = value as { data?: unknown; init?: ResponseInit | null };
    return {
      status: given.init?.status ?? 200,
      data: given.data ?? value,
      location: null,
    };
  } catch (thrown) {
    if (thrown instanceof Response) {
      return {
        status: thrown.status,
        data: undefined,
        location: thrown.headers.get('location'),
      };
    }
    const given = thrown as { init?: ResponseInit | null };
    if (given.init) {
      return {
        status: given.init.status ?? 500,
        data: undefined,
        location: null,
      };
    }
    throw thrown;
  }
}
