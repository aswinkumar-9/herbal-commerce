import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Form, Link, data, redirect, useNavigation } from 'react-router';
import { z } from 'zod';
import {
  ADDRESS_ID,
  addressesSchema,
  askAsCustomer,
  dataOrUnavailable,
  meSchema,
} from '../account.server.ts';
import { phoneShown } from '../address.ts';
import type { Address } from '../address.ts';
import { segment } from '../api.server.ts';
import { getConfig } from '../config.server.ts';
import { BusyButton as Busy } from '../components/BusyButton.tsx';
import { TextField } from '../components/FormField.tsx';
import { FormAlert } from '../components/FormPage.tsx';
import { OUTLINE_PILL, PILL } from '../components/pills.ts';
import { given, nameProblem } from '../form-checks.server.ts';
import { pageTitle } from '../page-title.ts';
import { pageMeta } from '../seo.ts';
import { sessionOf } from '../session.server.ts';
import { text } from '../text/en.ts';
import type { Route } from './+types/account';

// The customer's own page (part 14B, ADR 0041): their name, their delivery
// addresses, the way to a new password, and signing out, here or
// everywhere. Only for a signed-in customer; anyone else signs in first.
const words = text.account;

type Saved = keyof typeof words.saved;
const isSaved = (value: string | null): value is Saved =>
  value !== null && Object.hasOwn(words.saved, value);

export async function loader({ request, context }: Route.LoaderArgs) {
  const [me, addresses] = await Promise.all([
    askAsCustomer(request, context, { method: 'GET', path: 'me' }, meSchema),
    askAsCustomer(
      request,
      context,
      { method: 'GET', path: 'me/addresses' },
      addressesSchema,
    ),
  ]);
  const { fullName, email } = dataOrUnavailable(me);
  // Coming back from an address page: what was done there.
  const saved = new URL(request.url).searchParams.get('saved');
  return {
    fullName,
    email,
    addresses: dataOrUnavailable(addresses),
    saved: isSaved(saved) ? saved : null,
    origin: getConfig().origin,
  };
}

export type AccountProblems = { fullName?: string; form?: string };

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  switch (given(form, 'intent')) {
    case 'name':
      return changeName(request, context, given(form, 'fullName').trim());
    case 'default':
      return makeDefault(request, context, given(form, 'id'));
    case 'everywhere':
      return signOutEverywhere(request, context);
    default:
      return refuse({}, 400);
  }
}

type Args = Route.ActionArgs;

async function changeName(
  request: Request,
  context: Args['context'],
  fullName: string,
) {
  const problem = nameProblem(fullName);
  if (problem) {
    return refuse({ fullName: problem }, 400, fullName);
  }
  const answer = await askAsCustomer(
    request,
    context,
    { method: 'PATCH', path: 'me', body: { fullName } },
    z.unknown(),
  );
  if (answer.ok) {
    return done('name');
  }
  if (answer.status === 400 && answer.fields['fullName']) {
    return refuse({ fullName: text.forms.nameMissing }, 400, fullName);
  }
  return refuse({ form: words.problems.name }, 503, fullName);
}

async function makeDefault(
  request: Request,
  context: Args['context'],
  id: string,
) {
  if (!ADDRESS_ID.test(id)) {
    return refuse({ form: words.problems.gone }, 404);
  }
  const answer = await askAsCustomer(
    request,
    context,
    {
      method: 'PATCH',
      path: `me/addresses/${segment(id)}`,
      body: { isDefault: true },
    },
    z.unknown(),
  );
  if (answer.ok) {
    return done('default');
  }
  return answer.status === 404
    ? refuse({ form: words.problems.gone }, 404)
    : refuse({ form: words.problems.default }, 503);
}

// Every session ends at the API, this one too, so every device signs in
// again. Only when the API has done it does this one sign out: otherwise
// the customer is told, and stays signed in to try again.
async function signOutEverywhere(request: Request, context: Args['context']) {
  const answer = await askAsCustomer(
    request,
    context,
    { method: 'DELETE', path: 'me/sessions' },
    z.undefined(),
  );
  if (!answer.ok) {
    return refuse({ form: words.problems.everywhere }, 503);
  }
  sessionOf(context).signOut();
  throw redirect('/sign-in?ended=everywhere');
}

// What came of a form: what was done, or what went wrong, with the name
// as typed. One shape for every answer.
type Outcome = {
  saved: Saved | null;
  problems: AccountProblems;
  fullName: string | null;
};

const done = (saved: Saved): Outcome => ({
  saved,
  problems: {},
  fullName: null,
});

function refuse(
  problems: AccountProblems,
  status: number,
  fullName: string | null = null,
) {
  return data<Outcome>({ saved: null, problems, fullName }, { status });
}

export const meta: Route.MetaFunction = ({ loaderData }) =>
  loaderData
    ? pageMeta({
        title: pageTitle(words.title),
        description: words.description,
        origin: loaderData.origin,
        path: '/account',
        noindex: true,
      })
    : [];

export default function Account({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const problems: AccountProblems = actionData?.problems ?? {};
  // What was just done here, else on an address page before coming back.
  const saved: Saved | null = actionData ? actionData.saved : loaderData.saved;

  // The keyboard goes to what came of it: the name to fix, the problem,
  // or what was done.
  const status = useRef<HTMLOutputElement>(null);
  const alert = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (problems.fullName) {
      document.getElementById('fullName')?.focus();
    } else if (problems.form) {
      alert.current?.focus();
    } else if (saved) {
      status.current?.focus();
    }
  }, [actionData, saved, problems.fullName, problems.form]);

  const navigation = useNavigation();
  const sending =
    navigation.state !== 'idle' && navigation.formMethod === 'POST'
      ? navigation.formData
      : undefined;
  const leaving =
    navigation.state !== 'idle' && navigation.formAction === '/sign-out';
  const { addresses } = loaderData;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 pt-32 pb-24">
      <h1 className="heading-4 text-balance text-ink md:heading-3">
        {words.title}
      </h1>

      {saved ? (
        <output
          ref={status}
          tabIndex={-1}
          className="body-4 block rounded-3xl bg-primary-soft p-6 text-ink outline-none"
        >
          {words.saved[saved]}
        </output>
      ) : null}
      {problems.form ? (
        <FormAlert alertRef={alert}>
          <p className="body-4 text-ink">{problems.form}</p>
        </FormAlert>
      ) : null}

      <Section id="orders" title={words.orders.title}>
        <p className="body-6 text-ink-muted">{words.orders.intro}</p>
        <Link
          prefetch="intent"
          to="/orders"
          className={`${OUTLINE_PILL} self-start`}
        >
          {words.orders.see}
        </Link>
      </Section>

      <Section id="details" title={words.details.title}>
        <Form method="post" replace className="flex flex-col gap-6">
          <input type="hidden" name="intent" value="name" />
          <TextField
            name="fullName"
            label={words.details.name}
            autoComplete="name"
            required
            maxLength={100}
            defaultValue={actionData?.fullName ?? loaderData.fullName}
            problem={problems.fullName}
          />
          <div className="flex flex-col gap-2">
            <p className="caption-1 text-ink-muted">{words.details.email}</p>
            <p className="body-3 px-4 break-all text-ink">{loaderData.email}</p>
          </div>
          <Busy
            busy={sending?.get('intent') === 'name'}
            label={words.details.save}
            busyLabel={words.details.saving}
            className={`${OUTLINE_PILL} self-start`}
          />
        </Form>
      </Section>

      <Section id="addresses" title={words.addresses.title}>
        <p className="body-6 text-ink-muted">{words.addresses.intro}</p>
        {addresses.length > 0 ? (
          <ul className="flex flex-col gap-4">
            {addresses.map((address) => (
              <AddressCard
                key={address.id}
                address={address}
                busy={
                  sending?.get('intent') === 'default' &&
                  sending.get('id') === address.id
                }
              />
            ))}
          </ul>
        ) : (
          <p className="body-3 text-ink">{words.addresses.none}</p>
        )}
        {addresses.length < 10 ? (
          <Link
            prefetch="intent"
            to="/account/addresses/new"
            className={`${PILL} self-start`}
          >
            {words.addresses.add}
          </Link>
        ) : (
          <p className="body-6 text-ink-muted">{words.addresses.full}</p>
        )}
      </Section>

      <Section id="password" title={words.password.title}>
        <p className="body-6 text-ink-muted">{words.password.intro}</p>
        <Link
          prefetch="intent"
          to="/account/password"
          className={`${OUTLINE_PILL} self-start`}
        >
          {words.password.change}
        </Link>
      </Section>

      <Section id="signing-out" title={words.signingOut.title}>
        <p className="body-6 text-ink-muted">{words.signingOut.intro}</p>
        <div className="flex flex-wrap gap-3">
          <Form method="post" action="/sign-out">
            <Busy
              busy={leaving}
              label={words.signingOut.signOut}
              busyLabel={words.signingOut.signingOut}
              className={OUTLINE_PILL}
            />
          </Form>
          <Form method="post" replace>
            <input type="hidden" name="intent" value="everywhere" />
            <Busy
              busy={sending?.get('intent') === 'everywhere'}
              label={words.signingOut.everywhere}
              busyLabel={words.signingOut.signingOut}
              className={OUTLINE_PILL}
            />
          </Form>
        </div>
      </Section>
    </div>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-6 rounded-3xl bg-surface p-8"
    >
      <h2 id={`${id}-title`} className="heading-6 text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

// One saved address: who receives it, where, and the phone for the
// courier; then changing it, or making it the default. Each button says
// which address it is for, as there may be several alike, starting with
// the words it shows (so it can be asked for by voice).
function AddressCard({ address, busy }: { address: Address; busy: boolean }) {
  const which = `${address.fullName}, ${address.line1}`;
  return (
    <li className="flex flex-col gap-4 rounded-2xl border border-line p-6">
      <div className="flex flex-wrap items-center gap-2">
        <p className="title-3 break-words text-ink">{address.fullName}</p>
        {address.isDefault ? (
          <span className="caption-3 rounded-full bg-primary-soft px-3 py-1 text-primary">
            {words.addresses.isDefault}
          </span>
        ) : null}
      </div>
      <address className="body-6 break-words text-ink-muted not-italic">
        {address.line1}
        <br />
        {address.line2 ? (
          <>
            {address.line2}
            <br />
          </>
        ) : null}
        {address.city}, {address.state} {address.pincode}
        <br />
        {words.addresses.phone(phoneShown(address.phone))}
      </address>
      <div className="flex flex-wrap gap-3">
        <Link
          prefetch="intent"
          to={`/account/addresses/${address.id}`}
          aria-label={words.addresses.editFor(which)}
          className={OUTLINE_PILL}
        >
          {words.addresses.edit}
        </Link>
        {address.isDefault ? null : (
          <Form method="post" replace>
            <input type="hidden" name="intent" value="default" />
            <input type="hidden" name="id" value={address.id} />
            <Busy
              busy={busy}
              label={words.addresses.makeDefault}
              busyLabel={words.details.saving}
              className={OUTLINE_PILL}
              fullLabel={words.addresses.makeDefaultFor(which)}
            />
          </Form>
        )}
      </div>
    </li>
  );
}
