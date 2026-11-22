import { Form, Link, data, redirect } from 'react-router';
import { z } from 'zod';
import {
  askAsCustomer,
  dataOrUnavailable,
  meSchema,
} from '../account.server.ts';
import { getConfig } from '../config.server.ts';
import { PasswordField } from '../components/FormField.tsx';
import {
  FormAlert,
  FormPage,
  SendButton,
  TEXT_LINK,
  useAfterSending,
} from '../components/FormPage.tsx';
import { given, newPasswordProblem, tooMany } from '../form-checks.server.ts';
import { pageTitle } from '../page-title.ts';
import { pageMeta } from '../seo.ts';
import { sessionOf } from '../session.server.ts';
import { text } from '../text/en.ts';
import type { Route } from './+types/account-password';

// Changing the password while signed in (part 14B, ADR 0041): the current
// one as proof, then the new one. The API then ends every session, this
// one too, so the customer signs in again with the new password.
const words = text.changePassword;
const FIELDS = ['currentPassword', 'newPassword'] as const;
const SECRETS = ['currentPassword', 'newPassword'] as const;

export async function loader({ request, context }: Route.LoaderArgs) {
  // The address, for the password manager to file the new password under.
  const { email } = dataOrUnavailable(
    await askAsCustomer(
      request,
      context,
      { method: 'GET', path: 'me' },
      meSchema,
    ),
  );
  return { email, origin: getConfig().origin };
}

export type ChangePasswordProblems = {
  currentPassword?: string;
  newPassword?: string;
  form?: string;
};

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const currentPassword = given(form, 'currentPassword');
  const newPassword = given(form, 'newPassword');

  const problems: ChangePasswordProblems = {};
  if (!currentPassword) {
    problems.currentPassword = words.problems.currentMissing;
  } else if (currentPassword.length > 128) {
    problems.currentPassword = text.forms.passwordLong;
  }
  const newProblem = newPasswordProblem(newPassword);
  if (newProblem) {
    problems.newPassword = newProblem;
  } else if (newPassword === currentPassword) {
    problems.newPassword = words.problems.same;
  }
  if (problems.currentPassword || problems.newPassword) {
    return refuse(problems, 400);
  }

  const answer = await askAsCustomer(
    request,
    context,
    {
      method: 'POST',
      path: 'me/password',
      body: { currentPassword, newPassword },
    },
    z.unknown(),
  );
  if (answer.ok) {
    // The API has ended every session; this one ends here too.
    sessionOf(context).signOut();
    throw redirect('/sign-in?ended=password');
  }
  if (answer.status === 429) {
    return refuse({ form: tooMany(answer.retryAfter) }, 429);
  }
  if (answer.status === 400) {
    // A field refused: the new password. Else the current one is wrong.
    return answer.fields['newPassword']
      ? refuse({ newPassword: text.forms.newPasswordShort }, 400)
      : refuse({ currentPassword: words.problems.currentWrong }, 400);
  }
  return refuse({ form: words.problems.resting }, 503);
}

// The form again, saying what to fix; never a password.
function refuse(problems: ChangePasswordProblems, status: number) {
  return data({ problems }, { status });
}

export const meta: Route.MetaFunction = ({ loaderData }) =>
  loaderData
    ? pageMeta({
        title: pageTitle(words.title),
        description: words.description,
        origin: loaderData.origin,
        path: '/account/password',
        noindex: true,
      })
    : [];

export default function ChangePassword({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const problems: ChangePasswordProblems = actionData?.problems ?? {};
  const { alert } = useAfterSending(actionData, FIELDS, SECRETS);
  return (
    <FormPage title={words.title} intro={words.intro}>
      {problems.form ? (
        <FormAlert alertRef={alert}>
          <p className="body-4 text-ink">{problems.form}</p>
        </FormAlert>
      ) : null}

      <Form method="post" replace className="flex flex-col gap-6">
        {/* Whose password it is, for the password manager; never shown. */}
        <input
          type="email"
          name="username"
          autoComplete="username"
          value={loaderData.email}
          readOnly
          hidden
        />
        <PasswordField
          name="currentPassword"
          label={words.current}
          autoComplete="current-password"
          required
          maxLength={128}
          showLabel={text.forms.showPassword}
          problem={problems.currentPassword}
        />
        <PasswordField
          name="newPassword"
          label={words.new}
          autoComplete="new-password"
          required
          minLength={10}
          maxLength={128}
          hint={text.forms.newPasswordHint}
          showLabel={text.forms.showPassword}
          problem={problems.newPassword}
        />
        <SendButton label={words.submit} sendingLabel={words.submitting} />
      </Form>

      <p className="body-6">
        <Link prefetch="intent" to="/account" className={TEXT_LINK}>
          {words.back}
        </Link>
      </p>
    </FormPage>
  );
}
