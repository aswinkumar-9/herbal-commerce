import { redirect } from 'react-router';
import { z } from 'zod';
import { apiSend } from '../api.server.ts';
import { sessionOf } from '../session.server.ts';
import type { Route } from './+types/sign-out';

// Signing out (part 14B, ADR 0041): only by the form's POST, never by
// opening an address, so no other page or link can sign a customer out.
export function loader() {
  throw redirect('/');
}

export async function action({ request, context }: Route.ActionArgs) {
  const handle = sessionOf(context);
  const session = handle.current;
  if (session) {
    // The API ends the session too, so its tokens stop working everywhere.
    // The cookie goes whatever the API says: signing out always works.
    await apiSend(
      request,
      {
        method: 'POST',
        path: 'auth/logout',
        body: { refreshToken: session.refreshToken },
      },
      z.undefined(),
    );
    handle.signOut();
  }
  throw redirect('/');
}
