import { Form, Link, data } from 'react-router';
import { z } from 'zod';
import { apiSend } from '../api.server.ts';
import { getConfig } from '../config.server.ts';
import { TextField } from '../components/FormField.tsx';
import {
  FormAlert,
  FormPage,
  SendButton,
  useAfterSending,
} from '../components/FormPage.tsx';
import { GOLD_PILL } from '../components/pills.ts';
import {
  emailProblem,
  given,
  looksLikeEmailedToken,
  tooMany,
} from '../form-checks.server.ts';
import { keepOutOfCaches } from '../no-store.server.ts';
import { pageTitle } from '../page-title.ts';
import { pageMeta } from '../seo.ts';
import { text } from '../text/en.ts';
import type { Route } from './+types/verify-email';

// Confirming the email address (part 14B, ADR 0041), from the link the API
// emails: /verify-email?token=…. Opening the link only shows a button, and
// the button sends the token: mail scanners open every link in an email,
// and would use the link up before its owner could.
// Without a token, or once the link has failed, the page sends a new link.
const words = text.verifyEmail;
const FIELDS = ['email'] as const;
const told = z.object({ message: z.string() });

export const middleware: Route.MiddlewareFunction[] = [keepOutOfCaches];

export function loader({ request }: Route.LoaderArgs) {
  const token = new URL(request.url).searchParams.get('token');
  const usable = looksLikeEmailedToken(token);
  return {
    token: usable ? token : null,
    // Cut short, say, when the email's line was broken.
    broken: token !== null && !usable,
    origin: getConfig().origin,
  };
}

export type VerifyProblems = { email?: string; form?: string };

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  return given(form, 'intent') === 'resend'
    ? resend(request, given(form, 'email').trim())
    : confirm(request, form.get('token'));
}

async function confirm(request: Request, token: unknown) {
  if (!looksLikeEmailedToken(token)) {
    return refuse('confirm', { form: words.broken }, 400, true);
  }
  const answer = await apiSend(
    request,
    { method: 'POST', path: 'auth/verify-email', body: { token } },
    told,
  );
  if (answer.ok) {
    return { done: true as const, sentTo: null };
  }
  // Expired, used already, or never made: the API says only that.
  if (answer.status === 400) {
    return refuse('confirm', { form: words.failed }, 400, true);
  }
  if (answer.status === 429) {
    return refuse('confirm', { form: tooMany(answer.retryAfter) }, 429);
  }
  return refuse('confirm', { form: words.problems.resting }, 503);
}

async function resend(request: Request, email: string) {
  const wrong = emailProblem(email);
  if (wrong) {
    return refuse('resend', { email: wrong }, 400, false, email);
  }
  const answer = await apiSend(
    request,
    { method: 'POST', path: 'auth/resend-verification', body: { email } },
    told,
  );
  if (answer.ok) {
    return { done: true as const, sentTo: email };
  }
  if (answer.status === 429) {
    return refuse(
      'resend',
      { form: tooMany(answer.retryAfter) },
      429,
      false,
      email,
    );
  }
  if (answer.status === 400 && answer.fields['email']) {
    return refuse(
      'resend',
      { email: text.forms.emailWrong },
      400,
      false,
      email,
    );
  }
  return refuse('resend', { form: words.problems.resting }, 503, false, email);
}

function refuse(
  intent: 'confirm' | 'resend',
  problems: VerifyProblems,
  status: number,
  linkFailed = false,
  email = '',
) {
  return data({ intent, problems, linkFailed, email }, { status });
}

export const meta: Route.MetaFunction = ({ loaderData }) =>
  loaderData
    ? pageMeta({
        title: pageTitle(words.title),
        description: words.description,
        origin: loaderData.origin,
        path: '/verify-email',
        noindex: true,
      })
    : [];

export default function VerifyEmail({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { alert, title } = useAfterSending(actionData, FIELDS);

  if (actionData && 'done' in actionData) {
    return actionData.sentTo === null ? (
      <FormPage
        title={words.confirmed.title}
        intro={words.confirmed.body}
        titleRef={title}
      >
        <Link to="/sign-in" className={`${GOLD_PILL} w-full`}>
          {words.confirmed.signIn}
        </Link>
      </FormPage>
    ) : (
      <FormPage title={text.signUp.sent.title} titleRef={title}>
        <p className="body-3 break-words text-ink">
          {words.resend.sent(actionData.sentTo)}
        </p>
      </FormPage>
    );
  }

  const problems: VerifyProblems = actionData?.problems ?? {};
  const resending =
    loaderData.token === null ||
    actionData?.intent === 'resend' ||
    actionData?.linkFailed === true;
  // One message at a time: the latest answer's, else a link cut short.
  const notice =
    problems.form ?? (loaderData.broken ? words.broken : undefined);

  return (
    <FormPage
      title={resending ? words.resend.title : words.title}
      intro={resending ? words.resend.intro : words.intro}
      titleRef={title}
    >
      {notice ? (
        <FormAlert alertRef={alert}>
          <p className="body-4 text-ink">{notice}</p>
        </FormAlert>
      ) : null}

      {resending ? (
        <Form method="post" replace className="flex flex-col gap-6">
          <input type="hidden" name="intent" value="resend" />
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
          <SendButton
            label={words.resend.submit}
            sendingLabel={words.resend.submitting}
          />
        </Form>
      ) : (
        <Form method="post" replace className="flex flex-col gap-6">
          <input type="hidden" name="intent" value="confirm" />
          <input type="hidden" name="token" value={loaderData.token ?? ''} />
          <SendButton label={words.confirm} sendingLabel={words.confirming} />
        </Form>
      )}
    </FormPage>
  );
}
