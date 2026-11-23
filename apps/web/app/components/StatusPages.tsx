import { Link, isRouteErrorResponse, useLocation } from 'react-router';
import { text } from '../text/en.ts';
import { pageTitle } from '../page-title.ts';
import { GOLD_PILL } from './pills.ts';
import { StatusPage } from './StatusPage.tsx';

export function NotFoundPage() {
  return (
    <>
      <title>{pageTitle(text.notFound.title)}</title>
      <StatusPage
        heading={text.notFound.heading}
        body={text.notFound.body}
        action={
          <Link prefetch="intent" to="/" className={GOLD_PILL}>
            {text.notFound.home}
          </Link>
        }
      />
    </>
  );
}

// The API is resting or busy: the same page, a moment later, usually
// works. "Try again" loads the page afresh.
export function UnavailablePage() {
  return (
    <>
      <title>{pageTitle(text.unavailable.title)}</title>
      <StatusPage
        heading={text.unavailable.heading}
        body={text.unavailable.body}
        action={<Again label={text.unavailable.retry} />}
      />
    </>
  );
}

export function FailedPage() {
  return (
    <>
      <title>{pageTitle(text.failed.title)}</title>
      <StatusPage
        heading={text.failed.heading}
        body={text.failed.body}
        action={<Again label={text.failed.retry} />}
      />
    </>
  );
}

// A page that could not be made: unknown (404), the API resting or busy
// (503), or a failure. Never the failure's details.
export function ErrorPage({ error }: { error: unknown }) {
  const status = isRouteErrorResponse(error) ? error.status : 500;
  return status === 404 ? (
    <NotFoundPage />
  ) : status === 503 ? (
    <UnavailablePage />
  ) : (
    <FailedPage />
  );
}

function Again({ label }: { label: string }) {
  const { pathname, search } = useLocation();
  return (
    <a href={`${pathname}${search}`} className={GOLD_PILL}>
      {label}
    </a>
  );
}
