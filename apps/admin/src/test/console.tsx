import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { routes } from '../App';
import { ASHA, RAVI, fakeApi, json, tokens } from './fake-api';

type Answers = Parameters<typeof fakeApi>[0];
type Staff = typeof ASHA | typeof RAVI;

// The whole console at a page, already signed in (the cookie still holds a
// session), with the fake API answering the rest.
export function openSignedIn(
  path: string,
  { staff = ASHA, answers = {} }: { staff?: Staff; answers?: Answers } = {},
) {
  const api = fakeApi({
    'POST /v1/staff/auth/refresh': () => json(200, tokens('t1')),
    'GET /v1/staff/me': () => json(200, staff),
    ...answers,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { api, router, queryClient, user: userEvent.setup() };
}

// An answer the test sends when it chooses (for one request only: a
// Response can be read once).
export function heldBack() {
  let release: (response: Response) => void = () => undefined;
  const answer = new Promise<Response>((resolve) => {
    release = resolve;
  });
  return {
    answer: () => answer,
    release: (response: Response) => release(response),
  };
}
