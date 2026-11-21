import { motion } from 'motion/react';
import { Link } from 'react-router';
import { problemMessage } from '../api/problems';
import { ListLoading, LoadFailed } from '../catalog/list-states';
import { buttonClass } from '../components/Button';
import { STAGGER, transition } from '../motion';
import { usePageTitle } from '../page-title';
import type { PolicyPageSummary } from './policies-api';
import { usePolicyPages } from './policies-queries';
import {
  POLICY_STATE_NAMES,
  POLICY_STATE_STYLES,
  draftLine,
  policyState,
  publishedLine,
} from './policy-display';
import { POLICY_PURPOSES, POLICY_TITLES } from './policy-pages';

const TAG =
  'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold shadow-chip inset-shadow-clay';

// The website's policy pages, for Super Users only (ADR 0040): what
// customers read in the footer. Each is written here as a draft, then
// published.
export function PoliciesPage() {
  usePageTitle('Policy pages');
  const pages = usePolicyPages();

  return (
    <section className="max-w-4xl">
      <header>
        <h1 className="text-2xl font-semibold">Policy pages</h1>
        <p className="mt-1 text-ink-muted">
          What customers read in the website’s footer. Write a page as a draft,
          see it as customers will, then publish it. Every published version is
          kept.
        </p>
      </header>

      {pages.isPending ? (
        <ListLoading label="Loading the policy pages…" />
      ) : pages.isError && !pages.data ? (
        <LoadFailed
          title="The policy pages could not be loaded"
          message={problemMessage(pages.error)}
          retrying={pages.isFetching}
          onRetry={() => void pages.refetch()}
        />
      ) : (
        <ul
          aria-label="Policy pages"
          className="mt-6 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-clay inset-shadow-clay"
        >
          {pages.data.map((summary, index) => (
            <motion.li
              key={summary.page}
              initial={{ opacity: 0, y: 6 }}
              animate={{
                opacity: 1,
                y: 0,
                transition: { ...transition, delay: index * STAGGER },
              }}
              className="px-4 py-3"
            >
              <PolicyRow summary={summary} />
            </motion.li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PolicyRow({ summary }: { summary: PolicyPageSummary }) {
  const state = policyState(summary);
  const title = POLICY_TITLES[summary.page];
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold">{title}</span>
          <span className={`${TAG} ${POLICY_STATE_STYLES[state]}`}>
            {POLICY_STATE_NAMES[state]}
          </span>
        </p>
        <p className="text-sm text-ink-muted">
          {POLICY_PURPOSES[summary.page]}
        </p>
        {summary.published ? (
          <p className="mt-1 text-sm">{publishedLine(summary.published)}</p>
        ) : null}
        {summary.draft ? (
          <p className="mt-1 text-sm">{draftLine(summary.draft)}</p>
        ) : null}
      </div>
      <Link
        to={`/policies/${summary.page}`}
        className={buttonClass('secondary', 'sm')}
      >
        {state === 'NOT_WRITTEN' ? 'Write' : 'Edit'}
        <span className="sr-only">: {title}</span>
      </Link>
    </div>
  );
}
