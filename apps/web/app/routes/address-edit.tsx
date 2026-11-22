import { useEffect, useRef } from 'react';
import { Form, Link, data, redirect, useNavigation } from 'react-router';
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
import { ADDRESS_FIELDS, typedFrom } from '../address.ts';
import type { AddressProblems, AddressTyped } from '../address.ts';
import { segment } from '../api.server.ts';
import { getConfig } from '../config.server.ts';
import { AddressForm } from '../components/AddressForm.tsx';
import {
  FormAlert,
  FormPage,
  TEXT_LINK,
  useAfterSending,
} from '../components/FormPage.tsx';
import { DANGER_PILL, OUTLINE_PILL } from '../components/pills.ts';
import { given } from '../form-checks.server.ts';
import { pageTitle } from '../page-title.ts';
import { pageMeta } from '../seo.ts';
import { text } from '../text/en.ts';
import type { Route } from './+types/address-edit';

// Changing or removing one of the customer's delivery addresses (part
// 14B). Only their own: the API answers 404 for anyone else's, as for one
// that was never there. Removing asks once more first, the same with or
// without the page's script.
const words = text.address;

const notFound = () => data(null, { status: 404 });

export async function loader({ request, context, params }: Route.LoaderArgs) {
  if (!ADDRESS_ID.test(params.id)) {
    throw notFound();
  }
  const addresses = dataOrUnavailable(
    await askAsCustomer(
      request,
      context,
      { method: 'GET', path: 'me/addresses' },
      addressesSchema,
    ),
  );
  const address = addresses.find((one) => one.id === params.id);
  if (!address) {
    throw notFound();
  }
  return {
    address,
    others: addresses.length - 1,
    origin: getConfig().origin,
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  if (!ADDRESS_ID.test(params.id)) {
    throw notFound();
  }
  const path = `me/addresses/${segment(params.id)}`;
  const form = await request.formData();
  switch (given(form, 'intent')) {
    case 'save': {
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
          method: 'PATCH',
          path,
          body: { ...forApi(typed), ...(isDefault ? { isDefault: true } : {}) },
        },
        z.unknown(),
      );
      if (answer.ok) {
        throw redirect('/account?saved=address');
      }
      if (answer.status === 404) {
        throw notFound();
      }
      if (answer.status === 400) {
        const refused = refusedByApi(answer.fields);
        if (Object.keys(refused).length > 0) {
          return refuse(typed, isDefault, refused, 400);
        }
      }
      return refuse(typed, isDefault, { form: words.problems.resting }, 503);
    }
    case 'remove':
      // Asked once more first.
      return asking({});
    case 'removeConfirmed': {
      const answer = await askAsCustomer(
        request,
        context,
        { method: 'DELETE', path },
        z.undefined(),
      );
      // Gone already is gone all the same.
      if (answer.ok || answer.status === 404) {
        throw redirect('/account?saved=removed');
      }
      return asking({ form: words.problems.removing }, 503);
    }
    default:
      return data<Outcome>(
        { typed: null, isDefault: false, problems: {}, confirming: false },
        { status: 400 },
      );
  }
}

// What came of a form, in one shape: the address form again with what was
// typed and what to fix, or the question whether to remove it.
type Outcome = {
  typed: AddressTyped | null;
  isDefault: boolean;
  problems: AddressProblems;
  confirming: boolean;
};

function refuse(
  typed: AddressTyped,
  isDefault: boolean,
  problems: AddressProblems,
  status: number,
) {
  return data<Outcome>(
    { typed, isDefault, problems, confirming: false },
    { status },
  );
}

const asking = (problems: AddressProblems, status = 200) =>
  data<Outcome>(
    { typed: null, isDefault: false, problems, confirming: true },
    { status },
  );

export const meta: Route.MetaFunction = ({ loaderData, params }) =>
  loaderData
    ? pageMeta({
        title: pageTitle(words.editTitle),
        description: words.description,
        origin: loaderData.origin,
        path: `/account/addresses/${params.id}`,
        noindex: true,
      })
    : [];

export default function EditAddress({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { address, others } = loaderData;
  const problems: AddressProblems = actionData?.problems ?? {};
  const { alert } = useAfterSending(actionData, ADDRESS_FIELDS);
  const confirming = actionData?.confirming ?? false;

  // Asked once more: the keyboard goes to the question.
  const question = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (confirming && !problems.form) {
      question.current?.focus();
    }
  }, [actionData, confirming, problems.form]);

  const navigation = useNavigation();
  const removing =
    navigation.state !== 'idle' &&
    navigation.formData?.get('intent') === 'removeConfirmed';

  return (
    <FormPage title={words.editTitle}>
      {problems.form ? (
        <FormAlert alertRef={alert}>
          <p className="body-4 text-ink">{problems.form}</p>
        </FormAlert>
      ) : null}

      {confirming ? (
        <section
          aria-labelledby="remove-title"
          className="flex flex-col gap-6 rounded-3xl bg-surface p-8"
        >
          <h2
            id="remove-title"
            ref={question}
            tabIndex={-1}
            className="heading-6 text-ink outline-none"
          >
            {words.remove.title}
          </h2>
          <div className="flex flex-col gap-2">
            <p className="body-3 break-words text-ink">
              {words.remove.body(address.fullName, address.line1)}
            </p>
            {address.isDefault && others > 0 ? (
              <p className="body-6 text-ink-muted">
                {words.remove.nextDefault}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3">
            <Form method="post" replace>
              <input type="hidden" name="intent" value="removeConfirmed" />
              <button
                type="submit"
                aria-disabled={removing || undefined}
                onClick={(event) => {
                  if (removing) {
                    event.preventDefault();
                  }
                }}
                className={`${DANGER_PILL} aria-disabled:opacity-80`}
              >
                {removing ? `${words.remove.removing}…` : words.remove.confirm}
              </button>
            </Form>
            <Link
              prefetch="intent"
              to={`/account/addresses/${address.id}`}
              replace
              className={OUTLINE_PILL}
            >
              {words.remove.keep}
            </Link>
          </div>
        </section>
      ) : (
        <>
          <AddressForm
            typed={actionData?.typed ?? typedFrom(address)}
            problems={problems}
            defaultChoice={address.isDefault ? 'already' : 'choose'}
            defaultTicked={actionData?.isDefault ?? false}
            submit={words.save}
            submitting={words.saving}
          />
          <Form method="post" replace>
            <input type="hidden" name="intent" value="remove" />
            <button type="submit" className={OUTLINE_PILL}>
              {words.remove.ask}
            </button>
          </Form>
        </>
      )}

      <p className="body-6">
        <Link prefetch="intent" to="/account" className={TEXT_LINK}>
          {words.back}
        </Link>
      </p>
    </FormPage>
  );
}
