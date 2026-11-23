import { Link, data, redirect } from 'react-router';
import { z } from 'zod';
import {
  ADDRESS_ID,
  addressesSchema,
  askAsCustomer,
  dataOrUnavailable,
} from '../account.server.ts';
import {
  addressProblems,
  forApi,
  readAddress,
  refusedByApi,
} from '../address-checks.server.ts';
import { ADDRESS_FIELDS } from '../address.ts';
import type { AddressProblems, AddressTyped } from '../address.ts';
import { getConfig } from '../config.server.ts';
import { AddressForm } from '../components/AddressForm.tsx';
import {
  FormAlert,
  FormPage,
  TEXT_LINK,
  useAfterSending,
} from '../components/FormPage.tsx';
import { given } from '../form-checks.server.ts';
import { pageTitle } from '../page-title.ts';
import { pageMeta } from '../seo.ts';
import { text } from '../text/en.ts';
import type { Route } from './+types/address-new';

// Adding a delivery address (part 14B). The first one is the default; a
// later one when the customer ticks it. The API keeps at most 10. From
// checkout (?then=checkout, part 14C), it goes back there with the new
// address chosen.
const words = text.address;
const MOST = 10;
const fromCheckout = (request: Request): boolean =>
  new URL(request.url).searchParams.get('then') === 'checkout';
const savedSchema = z.object({ id: z.string().regex(ADDRESS_ID) });

export async function loader({ request, context }: Route.LoaderArgs) {
  const addresses = dataOrUnavailable(
    await askAsCustomer(
      request,
      context,
      { method: 'GET', path: 'me/addresses' },
      addressesSchema,
    ),
  );
  return {
    count: addresses.length,
    fromCheckout: fromCheckout(request),
    origin: getConfig().origin,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const typed = readAddress(form);
  const isDefault = given(form, 'isDefault') === 'yes';
  const problems = addressProblems(typed);
  if (Object.keys(problems).length > 0) {
    return refuse(typed, isDefault, problems, 400);
  }
  const answer = await askAsCustomer(
    request,
    context,
    {
      method: 'POST',
      path: 'me/addresses',
      body: { ...forApi(typed), ...(isDefault ? { isDefault: true } : {}) },
    },
    savedSchema,
  );
  if (answer.ok) {
    throw redirect(
      fromCheckout(request)
        ? `/checkout?address=${answer.data.id}`
        : '/account?saved=added',
    );
  }
  if (answer.status === 409) {
    return refuse(typed, isDefault, { form: words.full }, 409);
  }
  if (answer.status === 400) {
    const refused = refusedByApi(answer.fields);
    if (Object.keys(refused).length > 0) {
      return refuse(typed, isDefault, refused, 400);
    }
  }
  return refuse(typed, isDefault, { form: words.problems.resting }, 503);
}

// The form again, saying what to fix, with what was typed.
function refuse(
  typed: AddressTyped,
  isDefault: boolean,
  problems: AddressProblems,
  status: number,
) {
  return data({ typed, isDefault, problems }, { status });
}

export const meta: Route.MetaFunction = ({ loaderData }) =>
  loaderData
    ? pageMeta({
        title: pageTitle(words.newTitle),
        description: words.description,
        origin: loaderData.origin,
        path: '/account/addresses/new',
        noindex: true,
      })
    : [];

export default function NewAddress({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const problems: AddressProblems = actionData?.problems ?? {};
  const { alert } = useAfterSending(actionData, ADDRESS_FIELDS);
  const full = loaderData.count >= MOST;
  return (
    <FormPage title={words.newTitle} intro={full ? undefined : words.intro}>
      {problems.form ? (
        <FormAlert alertRef={alert}>
          <p className="body-4 text-ink">{problems.form}</p>
        </FormAlert>
      ) : null}
      {full && !actionData ? (
        <p className="body-3 text-ink">{words.full}</p>
      ) : (
        <AddressForm
          typed={actionData?.typed}
          problems={problems}
          defaultChoice={loaderData.count === 0 ? 'first' : 'choose'}
          defaultTicked={actionData?.isDefault ?? false}
          submit={words.add}
          submitting={words.adding}
        />
      )}
      <p className="body-6">
        <Link
          prefetch="intent"
          to={loaderData.fromCheckout ? '/checkout' : '/account'}
          className={TEXT_LINK}
        >
          {loaderData.fromCheckout ? text.checkout.backToCheckout : words.back}
        </Link>
      </p>
    </FormPage>
  );
}
