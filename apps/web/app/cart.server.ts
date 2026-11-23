// The signed-in customer's cart, from the API (docs/api-specification.md,
// "Cart"; ADR 0025). The cart keeps no prices and holds no stock: every
// answer has today's prices and whether each line can be bought now.
import type { RouterContextProvider } from 'react-router';
import { z } from 'zod';
import { askAsCustomer, dataOrUnavailable } from './account.server.ts';
import { apiSend, segment } from './api.server.ts';
import { PACK_UNITS, onMedia } from './catalog.server.ts';
import { MOST_PACKS } from './packs.ts';
import { sessionOf } from './session.server.ts';

// A pack size's SKU, as the API names it: capitals, digits and single
// hyphens, like ASH-CAP-60. Checked before it goes into the API's address.
const SKU = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
export const isSku = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length >= 3 &&
  value.length <= 40 &&
  SKU.test(value);

// 1 to 4 packs, as a form sends it.
export function packsFrom(value: unknown): number | null {
  return typeof value === 'string' && /^[1-4]$/.test(value)
    ? Number(value)
    : null;
}

const rupeesField = z.number().int().min(0);

const lineSchema = z.object({
  product: z.object({
    name: z.string().min(1).max(200),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    imageUrl: z.url({ protocol: /^https?$/ }).nullable(),
  }),
  sku: z.string().min(1).max(40),
  quantity: z.number().int().min(1),
  unit: z.enum(PACK_UNITS),
  mrpRupees: rupeesField,
  priceRupees: rupeesField,
  packs: z.number().int().min(1).max(MOST_PACKS),
  lineTotalRupees: rupeesField,
  status: z.enum(['AVAILABLE', 'OUT_OF_STOCK', 'OFF_SALE']),
});

export const cartSchema = z
  .object({
    items: z.array(lineSchema).max(50),
    packs: z.number().int().min(0),
    subtotalRupees: rupeesField,
    mrpTotalRupees: rupeesField,
  })
  // A line's photo shows only from the shop's media address.
  .transform((cart) => ({
    ...cart,
    items: cart.items.map((line) => ({
      ...line,
      product: {
        ...line.product,
        imageUrl:
          line.product.imageUrl === null
            ? null
            : onMedia(line.product.imageUrl),
      },
    })),
  }));

export type Cart = z.infer<typeof cartSchema>;
export type CartLine = Cart['items'][number];

type Context = Readonly<RouterContextProvider>;

// The cart for its own page: a customer not signed in goes to sign in.
export async function readCart(
  request: Request,
  context: Context,
): Promise<Cart> {
  return dataOrUnavailable(
    await askAsCustomer(
      request,
      context,
      { method: 'GET', path: 'me/cart' },
      cartSchema,
    ),
  );
}

// The cart when someone is signed in and the API answers, else null:
// never a reason to turn a page away (the menu's count, a product page).
async function cartIfAny(
  request: Request,
  context: Context,
): Promise<Cart | null> {
  const session = sessionOf(context).current;
  if (!session) {
    return null;
  }
  const answer = await apiSend(
    request,
    { method: 'GET', path: 'me/cart', accessToken: session.accessToken },
    cartSchema,
  );
  return answer.ok ? answer.data : null;
}

// How many packs the cart holds, for the menu.
export async function cartPacks(
  request: Request,
  context: Context,
): Promise<number | null> {
  const cart = await cartIfAny(request, context);
  return cart ? cart.items.reduce((sum, line) => sum + line.packs, 0) : null;
}

// Why packs could not go in. Only the API's out-of-stock refusal says so
// in its own words (a test compares them with the API's).
export const API_OUT_OF_STOCK = 'This pack size is out of stock.';
export type NotAdded = 'full' | 'stock' | 'gone' | 'resting';
const NOT_ADDED: readonly string[] = ['full', 'stock', 'gone', 'resting'];
const isNotAdded = (value: string | null): value is NotAdded =>
  value !== null && NOT_ADDED.includes(value);

// What came of "Add to cart", as a product page shows it: what went in, or
// why not (or 'choose': no pack size in stock was chosen), and the choice,
// to keep it chosen. One shape for every answer.
export type AddOutcome = {
  added: { sku: string; packs: number } | null;
  notAdded: NotAdded | 'choose' | null;
  // How many more packs of the product may go in.
  room: number;
  choice: { sku: string; packs: number } | null;
};

export type Added =
  | { ok: true; cart: Cart; packs: number }
  | { ok: false; why: NotAdded; room: number };

// Adds packs of one pack size: the cart's packs of it go up by that many,
// as long as the product's packs in all its sizes stay at 4 or fewer.
// The API sets a line's packs, so the cart is read first.
export async function addToCart(
  request: Request,
  context: Context,
  { sku, slug, packs }: { sku: string; slug: string; packs: number },
): Promise<Added> {
  const read = await askAsCustomer(
    request,
    context,
    { method: 'GET', path: 'me/cart' },
    cartSchema,
  );
  if (!read.ok) {
    return { ok: false, why: 'resting', room: MOST_PACKS };
  }
  const cart = read.data;
  const ofProduct = cart.items.filter((line) => line.product.slug === slug);
  const held = ofProduct.reduce((sum, line) => sum + line.packs, 0);
  const room = Math.max(MOST_PACKS - held, 0);
  if (packs > room) {
    return { ok: false, why: 'full', room };
  }
  const current = cart.items.find((line) => line.sku === sku)?.packs ?? 0;
  const answer = await askAsCustomer(
    request,
    context,
    {
      method: 'PUT',
      path: `me/cart/items/${segment(sku)}`,
      body: { packs: current + packs },
    },
    cartSchema,
  );
  if (answer.ok) {
    return { ok: true, cart: answer.data, packs };
  }
  if (answer.status === 404) {
    return { ok: false, why: 'gone', room };
  }
  if (answer.status === 409) {
    return {
      ok: false,
      why: answer.message === API_OUT_OF_STOCK ? 'stock' : 'full',
      room,
    };
  }
  return { ok: false, why: 'resting', room };
}

// A line's packs set to a number from 1 to 4, or the line taken out.
export async function setPacks(
  request: Request,
  context: Context,
  sku: string,
  packs: number,
) {
  return askAsCustomer(
    request,
    context,
    {
      method: 'PUT',
      path: `me/cart/items/${segment(sku)}`,
      body: { packs },
    },
    cartSchema,
  );
}

export async function removeLine(
  request: Request,
  context: Context,
  sku: string,
) {
  return askAsCustomer(
    request,
    context,
    { method: 'DELETE', path: `me/cart/items/${segment(sku)}` },
    z.undefined(),
  );
}

// "Add to cart" from someone not signed in: they sign in first, and come
// back to the product with the pack added (the owner's choice, 2026-11-23).
// The choice travels in the address signing in goes back to.
export const addPath = (slug: string, sku: string, packs: number): string =>
  `/products/${slug}?add=${encodeURIComponent(sku)}&packs=${packs}`;

type AddIntent = { slug: string; sku: string; packs: number };

export function addIntent(next: string): AddIntent | null {
  const url = new URL(next, 'http://website.invalid');
  const slug = /^\/products\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(
    url.pathname,
  )?.[1];
  const sku = url.searchParams.get('add');
  const packs = packsFrom(url.searchParams.get('packs'));
  return slug && isSku(sku) && packs !== null ? { slug, sku, packs } : null;
}

// Just signed in (sign-in.tsx): the pack goes in, then back to the product,
// which says what came of it. Signing in is a form from this website, so a
// link alone can never add anything.
export async function addAfterSignIn(
  request: Request,
  context: Context,
  intent: AddIntent,
): Promise<string> {
  const result = await addToCart(request, context, intent);
  return result.ok
    ? `/products/${intent.slug}?added=${encodeURIComponent(intent.sku)}&packs=${intent.packs}`
    : `${addPath(intent.slug, intent.sku, intent.packs)}&why=${result.why}&room=${result.room}`;
}

// Back on the product from signing in: what came of adding, from the
// address. "Added" is said only when the cart holds it, so an address alone
// can't claim it.
export async function returnedFromSignIn(
  request: Request,
  context: Context,
  search: URLSearchParams,
  skus: readonly string[],
): Promise<AddOutcome | null> {
  const packs = packsFrom(search.get('packs'));
  const added = search.get('added');
  if (isSku(added) && skus.includes(added) && packs !== null) {
    const cart = await cartIfAny(request, context);
    const held = cart?.items.find((line) => line.sku === added);
    return held && held.packs >= packs
      ? {
          added: { sku: added, packs },
          notAdded: null,
          room: 0,
          choice: { sku: added, packs },
        }
      : null;
  }
  const add = search.get('add');
  if (isSku(add) && skus.includes(add) && packs !== null) {
    const why = search.get('why');
    const room = search.get('room');
    return {
      added: null,
      notAdded: isNotAdded(why) ? why : null,
      room: room && /^[0-4]$/.test(room) ? Number(room) : MOST_PACKS,
      choice: { sku: add, packs },
    };
  }
  return null;
}
