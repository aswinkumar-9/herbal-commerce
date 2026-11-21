import { useEffect, useRef } from 'react';
import { Form, data, redirect, useNavigation } from 'react-router';
import { apiSend } from '../api.server.ts';
import { getConfig } from '../config.server.ts';
import { PasswordField, TextField } from '../components/FormField.tsx';
import { GOLD_PILL } from '../components/pills.ts';
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
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export interface SignInProblems {
  email?: string;
  password?: string;
  // About the whole form, with a hint when it may help.
  form?: string;
  hint?: string;
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const given = (name: string): string => {
    const value = form.get(name);
    return typeof value === 'string' ? value : '';
  };
  const email = given('email').trim();
  const password = given('password');
  const next = safeNext(form.get('next'));

  const problems: SignInProblems = {};
  if (!email) {
    problems.email = words.problems.emailMissing;
  } else if (email.length > 254 || !EMAIL.test(email)) {
    problems.email = words.problems.emailWrong;
  }
  if (!password) {
    problems.password = words.problems.passwordMissing;
  } else if (password.length > 128) {
    problems.password = words.problems.passwordLong;
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
    const wait = waitFor(answer.retryAfter ?? 60);
    return refuse(email, { form: words.problems.tooMany(wait) }, 429);
  }
  if (answer.status === 400) {
    const refused: SignInProblems = {};
    if (answer.fields['email']) {
      refused.email = words.problems.emailWrong;
    }
    if (answer.fields['password']) {
      refused.password = words.problems.passwordLong;
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

export function waitFor(seconds: number): string {
  return seconds >= 120
    ? words.minutes(Math.ceil(seconds / 60))
    : words.seconds(Math.max(1, seconds));
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
  const navigation = useNavigation();
  const sending =
    navigation.state !== 'idle' && navigation.formMethod === 'POST';
  const problems: SignInProblems = actionData?.problems ?? {};
  const message = useRef<HTMLDivElement>(null);

  // After a refused try, the keyboard goes to what needs fixing.
  useEffect(() => {
    if (!actionData) {
      return;
    }
    const { problems: found } = actionData;
    // The password goes, as it does when the page comes back without its
    // script: it is never kept on the page after a refused try.
    const password = document.getElementById('password');
    if (password instanceof HTMLInputElement) {
      password.value = '';
    }
    if (found.email) {
      document.getElementById('email')?.focus();
    } else if (found.password) {
      document.getElementById('password')?.focus();
    } else {
      message.current?.focus();
    }
  }, [actionData]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-8 px-6 pt-32 pb-24">
      <header className="flex flex-col gap-3">
        <h1 className="heading-4 text-balance text-ink">{words.title}</h1>
        <p className="body-3 text-pretty text-ink-muted">
          {loaderData.next ? words.forPage : words.intro}
        </p>
      </header>

      {problems.form ? (
        <div
          ref={message}
          tabIndex={-1}
          role="alert"
          className="flex flex-col gap-2 rounded-3xl bg-danger-soft p-6 outline-none"
        >
          <p className="body-4 text-ink">{problems.form}</p>
          {problems.hint ? (
            <p className="body-6 text-ink">{problems.hint}</p>
          ) : null}
        </div>
      ) : null}

      <Form method="post" replace className="flex flex-col gap-6">
        {loaderData.next ? (
          <input type="hidden" name="next" value={loaderData.next} />
        ) : null}
        <TextField
          name="email"
          label={words.email}
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
          autoComplete="current-password"
          required
          maxLength={128}
          showLabel={words.showPassword}
          problem={problems.password}
        />
        <button
          type="submit"
          aria-disabled={sending || undefined}
          onClick={(event) => {
            // One sign-in at a time; a second click waits.
            if (sending) {
              event.preventDefault();
            }
          }}
          className={`${GOLD_PILL} w-full aria-disabled:opacity-80`}
        >
          {sending ? `${words.submitting}…` : words.submit}
        </button>
      </Form>
    </div>
  );
}
