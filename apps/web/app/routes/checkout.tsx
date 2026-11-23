import { useEffect, useId, useRef } from 'react';
import { Form, Link, data, redirect, useNavigation } from 'react-router';
import type { ShouldRevalidateFunctionArgs } from 'react-router';
import {
  ADDRESS_ID,
  addressesSchema,
  askAsCustomer,
  dataOrUnavailable,
} from '../account.server.ts';
import { phoneShown } from '../address.ts';
import type { Address } from '../address.ts';
import { getConfig } from '../config.server.ts';
import { BusyButton } from '../components/BusyButton.tsx';
import { FormAlert, TEXT_LINK } from '../components/FormPage.tsx';
import { OrderSummary } from '../components/OrderSummary.tsx';
import { GOLD_PILL_LARGE, OUTLINE_PILL } from '../components/pills.ts';
import { given, tooMany } from '../form-checks.server.ts';
import {
  UUID,
  notOrderable,
  placeOrder,
  readCheckout,
} from '../orders.server.ts';
import type { NotOrderable } from '../orders.server.ts';
import { pageTitle } from '../page-title.ts';
import { pageMeta } from '../seo.ts';
import { text } from '../text/en.ts';
import type { Route } from './+types/checkout';

// Checkout (part 14C, ADR 0042): one of the customer's saved addresses, the
// cart as the API prices it as an order now, and placing it. Only for a
// signed-in customer; anyone else signs in first.
const words = text.checkout;

export async function loader({ request, context }: Route.LoaderArgs) {
  const [priced, saved] = await Promise.all([
    readCheckout(request, context),
    askAsCustomer(
      request,
      context,
      { method: 'GET', path: 'me/addresses' },
      addressesSchema,
    ),
  ]);
  const addresses = dataOrUnavailable(saved);
  // The cart can't be ordered as it is: the page says why, and leads back.
  const problem: NotOrderable | null =
    !priced.ok && priced.status === 409 ? notOrderable(priced.message) : null;
  const checkout = problem ? null : dataOrUnavailable(priced);
  // Back from adding an address here: that one, else the default.
  const asked = new URL(request.url).searchParams.get('address');
  const chosen =
    addresses.find((address) => address.id === asked)?.id ??
    addresses.find((address) => address.isDefault)?.id ??
    addresses[0]?.id ??
    null;
  return {
    checkout,
    problem,
    addresses,
    chosen,
    // A new key for each order the customer means to place.
    key: crypto.randomUUID(),
    origin: getConfig().origin,
  };
}

type Problem = keyof typeof words.problems;
// What came of "Place order" when it didn't go: why, how long to wait, and
// the key to send again when it is not known whether it went through.
type Outcome = { problem: Problem; wait: string | null; key: string | null };

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const addressId = given(form, 'addressId');
  const total = given(form, 'total');
  const key = given(form, 'key');
  if (given(form, 'intent') !== 'place' || !UUID.test(key)) {
    return refuse('changed', 400);
  }
  if (!ADDRESS_ID.test(addressId)) {
    return refuse('address', 400);
  }
  if (!/^[1-9]\d{0,6}$/.test(total)) {
    return refuse('changed', 400);
  }
  const placed = await placeOrder(request, context, {
    addressId,
    totalRupees: Number(total),
    key,
  });
  if (placed.ok) {
    throw redirect(`/orders/${placed.data.id}`);
  }
  if (placed.status === 404) {
    return refuse('address', 404);
  }
  if (placed.status === 409) {
    return refuse(notOrderable(placed.message), 409);
  }
  if (placed.status === 429) {
    return data<Outcome>(
      { problem: 'resting', wait: tooMany(placed.retryAfter), key: null },
      { status: 429 },
    );
  }
  if (placed.status === 400) {
    return refuse('changed', 400);
  }
  // Not known whether it was placed: trying again sends the same key, so
  // it is placed once at most.
  return data<Outcome>(
    { problem: 'resting', wait: null, key },
    { status: 503 },
  );
}

function refuse(problem: Problem, status: number) {
  return data<Outcome>({ problem, wait: null, key: null }, { status });
}

// After "Place order", even refused, the page asks again: React Router
// otherwise keeps what it had after a refusal (4xx), and the customer
// would see the old total, and send it again.
export function shouldRevalidate({
  actionStatus,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  return actionStatus === undefined ? defaultShouldRevalidate : true;
}

export const meta: Route.MetaFunction = ({ loaderData }) =>
  loaderData
    ? pageMeta({
        title: pageTitle(words.title),
        description: words.description,
        origin: loaderData.origin,
        path: '/checkout',
        noindex: true,
      })
    : [];

// Problems that only the cart can put right.
const FIX_IN_CART: readonly Problem[] = ['empty', 'unavailable', 'stock'];

export default function CheckoutPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { checkout, addresses, chosen } = loaderData;
  const outcome: Outcome | undefined = actionData;
  const problem: Problem | null = outcome?.problem ?? loaderData.problem;
  const said = outcome?.wait ?? (problem ? words.problems[problem] : null);
  const navigation = useNavigation();
  const placing =
    navigation.state !== 'idle' && navigation.formMethod === 'POST';

  const alert = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (outcome) {
      alert.current?.focus();
    }
  }, [outcome]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 pt-32 pb-24">
      <h1 className="heading-4 text-balance text-ink md:heading-3">
        {words.title}
      </h1>
      {said ? (
        <FormAlert alertRef={alert}>
          <p className="body-4 text-ink">{said}</p>
          {problem && FIX_IN_CART.includes(problem) ? (
            <Link prefetch="intent" to="/cart" className={TEXT_LINK}>
              {words.back}
            </Link>
          ) : null}
        </FormAlert>
      ) : null}

      {checkout ? (
        <Form method="post" className="grid gap-8 lg:grid-cols-2">
          <input type="hidden" name="intent" value="place" />
          <input
            type="hidden"
            name="key"
            value={outcome?.key ?? loaderData.key}
          />
          <input
            type="hidden"
            name="total"
            value={String(checkout.totalRupees)}
          />
          <fieldset className="flex flex-col gap-4">
            <legend className="title-1 mb-4 text-ink">
              {words.address.title}
            </legend>
            {addresses.length === 0 ? (
              <p className="body-3 rounded-3xl bg-surface p-6 text-ink">
                {words.address.none}
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {addresses.map((address) => (
                  <AddressChoice
                    key={address.id}
                    address={address}
                    chosen={address.id === chosen}
                  />
                ))}
              </ul>
            )}
            <Link
              prefetch="intent"
              to="/account/addresses/new?then=checkout"
              className={`${OUTLINE_PILL} self-start`}
            >
              {words.address.add}
            </Link>
          </fieldset>
          <div className="flex flex-col gap-6">
            <OrderSummary
              headingId="order-heading"
              heading={words.order.title}
              {...checkout}
            />
            {addresses.length > 0 ? (
              <div className="flex flex-col gap-3">
                <BusyButton
                  busy={placing}
                  label={words.place}
                  busyLabel={words.placing}
                  className={`${GOLD_PILL_LARGE} w-full`}
                />
                <p className="caption-2 text-ink-muted">{words.hold}</p>
              </div>
            ) : null}
          </div>
        </Form>
      ) : null}

      <p className="body-6">
        <Link prefetch="intent" to="/cart" className={TEXT_LINK}>
          {words.back}
        </Link>
      </p>
    </div>
  );
}

// One saved address to send the order to, chosen with its whole card. Read
// out by who receives it and where; the rest is its description.
function AddressChoice({
  address,
  chosen,
}: {
  address: Address;
  chosen: boolean;
}) {
  const id = useId();
  return (
    <li className="flex">
      <label className="flex w-full cursor-pointer items-start gap-3 rounded-3xl bg-surface p-6 ring-2 ring-transparent transition-colors duration-300 ease-settle has-checked:ring-primary">
        <input
          type="radio"
          name="addressId"
          value={address.id}
          defaultChecked={chosen}
          required
          aria-labelledby={`${id}-name`}
          aria-describedby={`${id}-where`}
          className="mt-1 size-5 shrink-0 accent-primary"
        />
        <span className="flex min-w-0 flex-col gap-1">
          <span id={`${id}-name`} className="title-3 break-words text-ink">
            {address.fullName}, {address.line1}
          </span>
          <span
            id={`${id}-where`}
            className="body-6 break-words text-ink-muted"
          >
            {address.line2 ? `${address.line2}, ` : ''}
            {address.city}, {address.state} {address.pincode}.{' '}
            {words.address.phone(phoneShown(address.phone))}
          </span>
        </span>
      </label>
    </li>
  );
}
