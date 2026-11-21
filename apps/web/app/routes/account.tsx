import { Form, redirect, useNavigation } from 'react-router';
import { z } from 'zod';
import { apiSend, unavailable } from '../api.server.ts';
import { getConfig } from '../config.server.ts';
import { OUTLINE_PILL } from '../components/pills.ts';
import { pageTitle } from '../page-title.ts';
import { pageMeta } from '../seo.ts';
import { requireCustomer, sessionOf, signInHref } from '../session.server.ts';
import { text } from '../text/en.ts';
import type { Route } from './+types/account';

// The customer's own page (part 14B): who is signed in, and signing out.
// Only for a signed-in customer; anyone else goes to sign in first.
const words = text.account;

const meSchema = z.object({
  fullName: z.string().min(1).max(100),
  email: z.string().min(3).max(254),
});

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = requireCustomer(request, context);
  const answer = await apiSend(
    request,
    { method: 'GET', path: 'me', accessToken: session.accessToken },
    meSchema,
  );
  if (!answer.ok) {
    // The session ended elsewhere: signed out here too, then to sign in.
    if (answer.status === 401) {
      sessionOf(context).signOut();
      throw redirect(signInHref(request));
    }
    throw unavailable(
      answer.retryAfter === undefined ? null : String(answer.retryAfter),
    );
  }
  return {
    fullName: answer.data.fullName,
    email: answer.data.email,
    origin: getConfig().origin,
  };
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

export default function Account({ loaderData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const leaving =
    navigation.state !== 'idle' && navigation.formAction === '/sign-out';
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 pt-32 pb-24">
      <h1 className="heading-4 text-balance text-ink md:heading-3">
        {words.title}
      </h1>
      <section
        aria-label={words.signedInAs}
        className="flex flex-col gap-6 rounded-3xl bg-surface p-8"
      >
        <div className="flex flex-col gap-1">
          <p className="caption-1 text-ink-muted">{words.signedInAs}</p>
          <p className="title-2 break-words text-ink">{loaderData.fullName}</p>
          <p className="body-6 break-all text-ink-muted">{loaderData.email}</p>
        </div>
        <Form method="post" action="/sign-out">
          <button
            type="submit"
            aria-disabled={leaving || undefined}
            onClick={(event) => {
              if (leaving) {
                event.preventDefault();
              }
            }}
            className={`${OUTLINE_PILL} aria-disabled:opacity-80`}
          >
            {leaving ? `${words.signingOut}…` : words.signOut}
          </button>
        </Form>
      </section>
    </div>
  );
}
