import { Form, Link, data, redirect } from 'react-router';
import { z } from 'zod';
import { apiSend } from '../api.server.ts';
import { getConfig } from '../config.server.ts';
import { PasswordField } from '../components/FormField.tsx';
import {
  FormAlert,
  FormPage,
  SendButton,
  useAfterSending,
} from '../components/FormPage.tsx';
import { GOLD_PILL } from '../components/pills.ts';
import {
  given,
  looksLikeEmailedToken,
  newPasswordProblem,
  tooMany,
} from '../form-checks.server.ts';
import { keepOutOfCaches } from '../no-store.server.ts';
import { pageTitle } from '../page-title.ts';
import { pageMeta } from '../seo.ts';
import { sessionOf } from '../session.server.ts';
import { text } from '../text/en.ts';
import type { Route } from './+types/reset-password';

// Choosing a new password (part 14B, ADR 0041), from the link the API
// emails: /reset-password?token=…. The API ends every session of the
// account; this device signs out too, so the new password is the way in.
const words = text.resetPassword;
const FIELDS = ['password'] as const;
const SECRETS = ['password'] as const;

export const middleware: Route.MiddlewareFunction[] = [keepOutOfCaches];

export function loader({ request }: Route.LoaderArgs) {
  const token = new URL(request.url).searchParams.get('token');
  // Not from a link at all: the way to get one.
  if (token === null) {
    throw redirect('/forgot-password');
  }
  const usable = looksLikeEmailedToken(token);
  return {
    token: usable ? token : null,
    origin: getConfig().origin,
  };
}

export type ResetProblems = { password?: string; form?: string };

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const token = form.get('token');
  const password = given(form, 'password');
  if (!looksLikeEmailedToken(token)) {
    return refuse({ form: words.broken }, 400, true);
  }
  const wrong = newPasswordProblem(password);
  if (wrong) {
    return refuse({ password: wrong }, 400);
  }

  const answer = await apiSend(
    request,
    {
      method: 'POST',
      path: 'auth/reset-password',
      body: { token, newPassword: password },
    },
    z.object({ message: z.string() }),
  );
  if (answer.ok) {
    // Whoever is signed in here signs out, even into another account: the
    // page has just said to sign in with the new password.
    const handle = sessionOf(context);
    if (handle.current) {
      handle.signOut();
    }
    return { done: true as const };
  }
  if (answer.status === 400) {
    if (answer.fields['newPassword']) {
      return refuse({ password: text.forms.newPasswordShort }, 400);
    }
    // Expired, used already, or never made: the API says only that.
    return refuse({ form: words.failed }, 400, true);
  }
  if (answer.status === 429) {
    return refuse({ form: tooMany(answer.retryAfter) }, 429);
  }
  return refuse({ form: words.problems.resting }, 503);
}

// Never the password back to the page.
function refuse(problems: ResetProblems, status: number, linkFailed = false) {
  return data({ problems, linkFailed }, { status });
}

export const meta: Route.MetaFunction = ({ loaderData }) =>
  loaderData
    ? pageMeta({
        title: pageTitle(words.title),
        description: words.description,
        origin: loaderData.origin,
        path: '/reset-password',
        noindex: true,
      })
    : [];

export default function ResetPassword({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { alert, title } = useAfterSending(actionData, FIELDS, SECRETS);

  if (actionData && 'done' in actionData) {
    return (
      <FormPage
        title={words.changed.title}
        intro={words.changed.body}
        titleRef={title}
      >
        <Link prefetch="intent" to="/sign-in" className={`${GOLD_PILL} w-full`}>
          {words.changed.signIn}
        </Link>
      </FormPage>
    );
  }

  const problems: ResetProblems = actionData?.problems ?? {};
  // A link that can't work: say so, and the way to a new one.
  if (loaderData.token === null || actionData?.linkFailed) {
    return (
      <FormPage title={words.title} titleRef={title}>
        <FormAlert alertRef={alert}>
          <p className="body-4 text-ink">{problems.form ?? words.broken}</p>
        </FormAlert>
        <Link
          prefetch="intent"
          to="/forgot-password"
          className={`${GOLD_PILL} w-full`}
        >
          {words.askAgain}
        </Link>
      </FormPage>
    );
  }

  return (
    <FormPage title={words.title} intro={words.intro} titleRef={title}>
      {problems.form ? (
        <FormAlert alertRef={alert}>
          <p className="body-4 text-ink">{problems.form}</p>
        </FormAlert>
      ) : null}
      <Form method="post" replace className="flex flex-col gap-6">
        <input type="hidden" name="token" value={loaderData.token} />
        <PasswordField
          name="password"
          label={words.password}
          autoComplete="new-password"
          required
          minLength={10}
          maxLength={128}
          hint={text.forms.newPasswordHint}
          showLabel={text.forms.showPassword}
          problem={problems.password}
        />
        <SendButton label={words.submit} sendingLabel={words.submitting} />
      </Form>
    </FormPage>
  );
}
