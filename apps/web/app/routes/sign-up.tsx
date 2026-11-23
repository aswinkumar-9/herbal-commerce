import { Form, Link, data, redirect } from 'react-router';
import { z } from 'zod';
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
import {
  emailProblem,
  given,
  nameProblem,
  newPasswordProblem,
  tooMany,
} from '../form-checks.server.ts';
import { pageTitle } from '../page-title.ts';
import { pageMeta } from '../seo.ts';
import { sessionOf } from '../session.server.ts';
import { text } from '../text/en.ts';
import type { Route } from './+types/sign-up';

// Creating an account (part 14B, ADR 0041): a name, an email address and a
// password. The API emails a link to confirm the address; until then the
// account can't sign in. The page says the same whether or not the address
// has an account already, as the API does (ADR 0007): the API emails the
// owner of an existing account instead.
const words = text.signUp;
const FIELDS = ['fullName', 'email', 'password'] as const;
const SECRETS = ['password'] as const;

export function loader({ context }: Route.LoaderArgs) {
  // Signed in already: there is an account.
  if (sessionOf(context).current) {
    throw redirect('/account');
  }
  return { origin: getConfig().origin };
}

export type SignUpProblems = {
  fullName?: string;
  email?: string;
  password?: string;
  form?: string;
};

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const fullName = given(form, 'fullName').trim();
  const email = given(form, 'email').trim();
  const password = given(form, 'password');

  const problems: SignUpProblems = {};
  const found = {
    fullName: nameProblem(fullName),
    email: emailProblem(email),
    password: newPasswordProblem(password),
  };
  for (const [field, problem] of Object.entries(found)) {
    if (problem) {
      problems[field as keyof typeof found] = problem;
    }
  }
  if (problems.fullName || problems.email || problems.password) {
    return refuse({ fullName, email }, problems, 400);
  }

  const answer = await apiSend(
    request,
    {
      method: 'POST',
      path: 'auth/register',
      body: { email, password, fullName },
    },
    z.object({ message: z.string() }),
  );
  if (answer.ok) {
    return { done: true as const, email };
  }
  if (answer.status === 429) {
    return refuse(
      { fullName, email },
      { form: tooMany(answer.retryAfter) },
      429,
    );
  }
  if (answer.status === 400) {
    // The API's rules may grow; its refusal goes beside the field.
    const refused: SignUpProblems = {};
    if (answer.fields['fullName']) {
      refused.fullName = text.forms.nameMissing;
    }
    if (answer.fields['email']) {
      refused.email = text.forms.emailWrong;
    }
    if (answer.fields['password']) {
      refused.password = text.forms.newPasswordShort;
    }
    if (refused.fullName || refused.email || refused.password) {
      return refuse({ fullName, email }, refused, 400);
    }
  }
  return refuse({ fullName, email }, { form: words.problems.resting }, 503);
}

// The form again, saying what to fix, with the name and the address kept;
// never the password.
function refuse(
  kept: { fullName: string; email: string },
  problems: SignUpProblems,
  status: number,
) {
  return data({ ...kept, problems }, { status });
}

export const meta: Route.MetaFunction = ({ loaderData }) =>
  loaderData
    ? pageMeta({
        title: pageTitle(words.title),
        description: words.description,
        origin: loaderData.origin,
        path: '/sign-up',
        noindex: true,
      })
    : [];

export default function SignUp({ actionData }: Route.ComponentProps) {
  const { alert, title } = useAfterSending(actionData, FIELDS, SECRETS);

  if (actionData && 'done' in actionData) {
    return (
      <FormPage title={words.sent.title} titleRef={title}>
        <div className="flex flex-col gap-3">
          <p className="body-3 break-words text-ink">
            {words.sent.body(actionData.email)}
          </p>
          <p className="body-6 text-ink-muted">{words.sent.lasts}</p>
        </div>
        <p className="body-6 text-ink-muted">
          {words.sent.nothing}{' '}
          <Link prefetch="intent" to="/verify-email" className={TEXT_LINK}>
            {words.sent.sendAgain}
          </Link>
          .
        </p>
      </FormPage>
    );
  }

  const problems: SignUpProblems = actionData?.problems ?? {};
  return (
    <FormPage title={words.title} intro={words.intro} titleRef={title}>
      {problems.form ? (
        <FormAlert alertRef={alert}>
          <p className="body-4 text-ink">{problems.form}</p>
        </FormAlert>
      ) : null}

      <Form method="post" replace className="flex flex-col gap-6">
        <TextField
          name="fullName"
          label={words.name}
          autoComplete="name"
          required
          maxLength={100}
          defaultValue={actionData?.fullName ?? ''}
          problem={problems.fullName}
        />
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
        <p className="body-6 text-pretty text-ink-muted">
          {words.agree.before}
          <Link prefetch="intent" to="/terms" className={TEXT_LINK}>
            {text.policies.pages.terms.title}
          </Link>
          {words.agree.between}
          <Link prefetch="intent" to="/privacy" className={TEXT_LINK}>
            {text.policies.pages.privacy.title}
          </Link>
          {words.agree.after}
        </p>
        <SendButton label={words.submit} sendingLabel={words.submitting} />
      </Form>

      <p className="body-6 text-ink-muted">
        {words.haveOne}{' '}
        <Link prefetch="intent" to="/sign-in" className={TEXT_LINK}>
          {words.signIn}
        </Link>
      </p>
    </FormPage>
  );
}
