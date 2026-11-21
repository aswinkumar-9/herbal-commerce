import { Link, data } from 'react-router';
import previewHome from '../art/preview-home.jpg';
import { getConfig } from '../config.server.ts';
import { EmptyState } from '../components/EmptyState.tsx';
import { PolicyText } from '../components/PolicyText.tsx';
import { Trail } from '../components/Trail.tsx';
import { PILL } from '../components/pills.ts';
import { pageTitle } from '../page-title.ts';
import { getPolicy } from '../policies.server.ts';
import { isPolicyPage } from '../policy-pages.ts';
import { pageMeta } from '../seo.ts';
import { text } from '../text/en.ts';
import type { Route } from './+types/policy';

// A policy page (part 14B, ADR 0040): privacy, terms, refunds, shipping or
// contact, as the Super User published it in the console, with the day it
// was last updated. One not published yet says it is still being written.
const words = text.policies;

export async function loader({ request, params }: Route.LoaderArgs) {
  // Any other single word is not a page: the API is not asked.
  if (!isPolicyPage(params.page)) {
    throw data(null, { status: 404 });
  }
  const policy = await getPolicy(request, params.page);
  return { page: params.page, policy, origin: getConfig().origin };
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
  // A page that could not be made: the status page names itself.
  if (!loaderData) {
    return [];
  }
  const { page, policy, origin } = loaderData;
  return pageMeta({
    title: pageTitle(words.pages[page].title),
    description: words.pages[page].description,
    origin,
    path: `/${page}`,
    image: {
      src: previewHome,
      alt: text.home.previewAlt,
      width: 1200,
      height: 630,
    },
    // Nothing to read yet: not to be listed.
    noindex: policy === null,
  });
};

export default function PolicyPage({ loaderData }: Route.ComponentProps) {
  const { page, policy } = loaderData;
  const title = words.pages[page].title;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 pt-24 pb-24">
      <Trail here={title} inShop={false} />
      <article aria-labelledby="policy-heading" className="flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          <h1
            id="policy-heading"
            className="heading-4 text-balance text-ink md:heading-3"
          >
            {title}
          </h1>
          {policy ? (
            <p className="caption-2 text-ink-muted">
              {words.updated}{' '}
              <time dateTime={policy.publishedAt}>{policy.publishedOn}</time>
            </p>
          ) : null}
        </header>
        {policy ? (
          <PolicyText text={policy.body} />
        ) : (
          <EmptyState title={words.pending} hint={words.pendingHint}>
            <Link to="/shop" className={PILL}>
              {text.shopPage.seeAll}
            </Link>
          </EmptyState>
        )}
      </article>
    </div>
  );
}
