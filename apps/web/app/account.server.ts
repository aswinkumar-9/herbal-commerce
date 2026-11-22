import { redirect } from 'react-router';
import type { RouterContextProvider } from 'react-router';
import { z } from 'zod';
import { apiSend, unavailable } from './api.server.ts';
import type { ApiAnswer } from './api.server.ts';
import type { Address } from './address.ts';
import { requireCustomer, sessionOf, signInHref } from './session.server.ts';

// Asking the API on the signed-in customer's behalf (part 14B): only for a
// signed-in customer (anyone else goes to sign in, and comes back after),
// with the session's token. When the API no longer knows the session (it
// ended elsewhere, say by a password change on another device), the
// customer is signed out here too, and goes to sign in.
export async function askAsCustomer<T>(
  request: Request,
  context: Readonly<RouterContextProvider>,
  call: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    path: string;
    body?: unknown;
  },
  schema: z.ZodType<T>,
): Promise<ApiAnswer<T>> {
  const session = requireCustomer(request, context);
  const answer = await apiSend(
    request,
    { ...call, accessToken: session.accessToken },
    schema,
  );
  if (!answer.ok && answer.status === 401) {
    sessionOf(context).signOut();
    throw redirect(signInHref(request));
  }
  return answer;
}

// For a page's loader: what the API gave, or the page that says the shop
// is taking a short break.
export function dataOrUnavailable<T>(answer: ApiAnswer<T>): T {
  if (answer.ok) {
    return answer.data;
  }
  throw unavailable(
    answer.retryAfter === undefined ? null : String(answer.retryAfter),
  );
}

export const meSchema = z.object({
  fullName: z.string().min(1).max(100),
  email: z.string().min(3).max(254),
});

// An address's ID goes into the API's address: only an ID's own letters.
export const ADDRESS_ID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

const addressSchema: z.ZodType<Address> = z.object({
  id: z.string().regex(ADDRESS_ID),
  fullName: z.string().max(100),
  phone: z.string().max(20),
  line1: z.string().max(200),
  line2: z.string().max(200).nullable(),
  city: z.string().max(100),
  state: z.string().max(60),
  pincode: z.string().max(10),
  isDefault: z.boolean(),
});

// The API keeps at most 10; a few more are read, never refused.
export const addressesSchema = z.array(addressSchema).max(50);
