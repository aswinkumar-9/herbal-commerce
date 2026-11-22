import { Form, Link, data } from 'react-router';
import { z } from 'zod';
import { apiSend } from '../api.server.ts';
import { getConfig } from '../config.server.ts';
import { TextField } from '../components/FormField.tsx';
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
import { text } from '../text/en.ts';
import type { Route } from './+types/forgot-password';

// Forgot password (part 14B, ADR 0041): the API emails a link to choose a
// new one. The page says the same whether or not the address has an
// account, as the API does (ADR 0007).
const words = text.forgotPassword;
const FIELDS = ['email'] as const;

export function loader() {
  return { origin: getConfig().origin };
}

export type ForgotProblems = { email?: string; form?: string };

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const email = given(form, 'email').trim();
  const wrong = emailProblem(email);
  if (wrong) {
    return refuse(email, { email: wrong }, 400);
  }
  const answer = await apiSend(
    request,
    { method: 'POST', path: 'auth/forgot-password', body: { email } },
    z.object({ message: z.string() }),
  );
  if (answer.ok) {
    return { done: true as const, email };
  }
  if (answer.status === 429) {
    return refuse(email, { form: tooMany(answer.retryAfter) }, 429);
  }
  if (answer.status === 400 && answer.fields['email']) {
    return refuse(email, { email: text.forms.emailWrong }, 400);
  }
  return refuse(email, { form: words.problems.resting }, 503);
}

function refuse(email: string, problems: ForgotProblems, status: number) {
  return data({ email, problems }, { status });
}

export const meta: Route.MetaFunction = ({ loaderData }) =>
  loaderData
    ? pageMeta({
        title: pageTitle(words.title),
        description: words.description,
        origin: loaderData.origin,
        path: '/forgot-password',
        noindex: true,
      })
    : [];

export default function ForgotPassword({ actionData }: Route.ComponentProps) {
  const { alert, title } = useAfterSending(actionData, FIELDS);
  const back = (
    <p className="body-6">
      <Link to="/sign-in" className={TEXT_LINK}>
        {words.back}
      </Link>
    </p>
  );

  if (actionData && 'done' in actionData) {
    return (
      <FormPage title={words.sent.title} titleRef={title}>
        <div className="flex flex-col gap-3">
          <p className="body-3 break-words text-ink">
            {words.sent.body(actionData.email)}
          </p>
          <p className="body-6 text-ink-muted">{words.sent.lasts}</p>
        </div>
        {back}
      </FormPage>
    );
  }

  const problems: ForgotProblems = actionData?.problems ?? {};
  return (
    <FormPage title={words.title} intro={words.intro} titleRef={title}>
      {problems.form ? (
        <FormAlert alertRef={alert}>
          <p className="body-4 text-ink">{problems.form}</p>
        </FormAlert>
      ) : null}
      <Form method="post" replace className="flex flex-col gap-6">
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
        <SendButton label={words.submit} sendingLabel={words.submitting} />
      </Form>
      {back}
    </FormPage>
  );
}
