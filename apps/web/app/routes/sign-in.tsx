import { Form, Link, data, redirect } from 'react-router';
import { apiSend } from '../api.server.ts';
import { getConfig } from '../config.server.ts';
import { PasswordField, TextField } from '../components/FormField.tsx';
import {
  FormAlert,
  FormPage,
  SendButton,
  TEXT_LINK,
  useAfterSending,
} from '../components/FormPage.tsx';
import { emailProblem, given, tooMany } from '../form-checks.server.ts';
import { pageTitle } from '../page-title.ts';
import { pageMeta } from '../seo.ts';
import { sessionOf, tokenSchema } from '../session.server.ts';
import { safeNext } from '../sign-in-next.ts';
import { text } from '../text/en.ts';
import type { Route } from './+types/sign-in';

// Signing in (part 14B, ADR 0041): an email address and a password. The
// website server signs in with the API and keeps the tokens sealed in the
// customer's cookie; the page never sees them.
const words = text.signIn;
const FIELDS = ['email', 'password'] as const;
const SECRETS = ['password'] as const;

export function loader({ request, context }: Route.LoaderArgs) {
  const asked = new URL(request.url).searchParams.get('next');
  // Signed in already: on to where they were going.
  if (sessionOf(context).current) {
    throw redirect(safeNext(asked));
  }
  return {
    next: asked === null ? null : safeNext(asked),
    origin: getConfig().origin,
  };
}

export type SignInProblems = {
  email?: string;
  password?: string;
  // About the whole form, with a hint when it may help.
  form?: string;
  hint?: string;
};

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const email = given(form, 'email').trim();
  const password = given(form, 'password');
  const next = safeNext(form.get('next'));

  const problems: SignInProblems = {};
  const emailWrong = emailProblem(email);
  if (emailWrong) {
    problems.email = emailWrong;
  }
  if (!password) {
    problems.password = text.forms.passwordMissing;
  } else if (password.length > 128) {
    problems.password = text.forms.passwordLong;
  }
  if (problems.email || problems.password) {
    return refuse(email, problems, 400);
  }

  const answer = await apiSend(
    request,
    { method: 'POST', path: 'auth/login', body: { email, password } },
    tokenSchema,
  );
  if (answer.ok) {
    sessionOf(context).signIn(answer.data);
    throw redirect(next);
  }
  if (answer.status === 401) {
    return refuse(
      email,
      { form: words.problems.wrong, hint: words.problems.unconfirmed },
      401,
    );
  }
  // Only someone with the right password learns this (ADR 0007).
  if (answer.status === 403 && answer.code === 'ACCOUNT_DISABLED') {
    return refuse(email, { form: words.problems.closed }, 403);
  }
  if (answer.status === 429) {
    return refuse(email, { form: tooMany(answer.retryAfter) }, 429);
  }
  if (answer.status === 400) {
    const refused: SignInProblems = {};
    if (answer.fields['email']) {
      refused.email = text.forms.emailWrong;
    }
    if (answer.fields['password']) {
      refused.password = text.forms.passwordLong;
    }
    return refuse(email, refused, 400);
  }
  return refuse(email, { form: words.problems.resting }, 503);
}

// The form again, saying what to fix. The password is never sent back to
// the page; the email address is, to spare typing it again.
function refuse(email: string, problems: SignInProblems, status: number) {
  return data({ email, problems }, { status });
}

export const meta: Route.MetaFunction = ({ loaderData }) =>
  loaderData
    ? pageMeta({
        title: pageTitle(words.title),
        description: words.description,
        origin: loaderData.origin,
        path: '/sign-in',
        // A form, not a page to find through a search engine.
        noindex: true,
      })
    : [];

export default function SignIn({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const problems: SignInProblems = actionData?.problems ?? {};
  const { alert } = useAfterSending(actionData, FIELDS, SECRETS);

  return (
    <FormPage
      title={words.title}
      intro={loaderData.next ? words.forPage : words.intro}
    >
      {problems.form ? (
        <FormAlert alertRef={alert}>
          <p className="body-4 text-ink">{problems.form}</p>
          {problems.hint ? (
            <p className="body-6 text-ink">
              {problems.hint}{' '}
              <Link prefetch="intent" to="/verify-email" className={TEXT_LINK}>
                {words.sendAgain}
              </Link>
            </p>
          ) : null}
        </FormAlert>
      ) : null}

      <Form method="post" replace className="flex flex-col gap-6">
        {loaderData.next ? (
          <input type="hidden" name="next" value={loaderData.next} />
        ) : null}
        <TextField
          name="email"
          label={text.forms.email}
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          maxLength={254}
          defaultValue={actionData?.email ?? ''}
          problem={problems.email}
        />
        <div className="flex flex-col gap-2">
          <PasswordField
            name="password"
            label={words.password}
            autoComplete="current-password"
            required
            maxLength={128}
            showLabel={text.forms.showPassword}
            problem={problems.password}
          />
          <Link
            prefetch="intent"
            to="/forgot-password"
            className={`${TEXT_LINK} body-6 self-start px-4 py-2`}
          >
            {words.forgot}
          </Link>
        </div>
        <SendButton label={words.submit} sendingLabel={words.submitting} />
      </Form>

      <p className="body-6 text-ink-muted">
        {words.newHere}{' '}
        <Link prefetch="intent" to="/sign-up" className={TEXT_LINK}>
          {words.createAccount}
        </Link>
      </p>
    </FormPage>
  );
}
