import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, RefreshCw, Send, TriangleAlert, Undo2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useDeferredValue, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '../api/api-error';
import { fieldProblems, problemMessage } from '../api/problems';
import { ListLoading, LoadFailed } from '../catalog/list-states';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { TextAreaField } from '../components/Field';
import { useToasts } from '../components/toast-context';
import { useUnsavedChanges } from '../components/unsaved-changes';
import { rise } from '../motion';
import { NotFoundPage } from '../pages/NotFoundPage';
import { usePageTitle } from '../page-title';
import {
  POLICY_MAX_LENGTH,
  discardDraft,
  publishPolicy,
  saveDraft,
} from './policies-api';
import type { PolicyPageDetail } from './policies-api';
import {
  policyChanged,
  policyKeys,
  usePolicyPage,
  usePolicyVersion,
  usePolicyVersions,
} from './policies-queries';
import {
  cleanText,
  draftLine,
  publishedLine,
  whenInIndia,
} from './policy-display';
import { POLICY_PURPOSES, POLICY_TITLES, isPolicyPage } from './policy-pages';
import type { PolicyPageName } from './policy-pages';
import { PolicyText, hasBlocks } from './PolicyText';

// One change at a time on a page, so a second click waits.
const CHANGING = ['policy-change'] as const;

const MARKS_HINT =
  'A blank line starts a new paragraph. Start a line with ## and a space for a heading, or with - and a space for an item of a list.';

// A policy page for a Super User (ADR 0040): the text in a box, how
// customers will see it beside it, then Save draft, Publish or Discard
// draft, and every version customers have been shown.
export function PolicyPage() {
  const { page } = useParams();
  if (!isPolicyPage(page)) {
    return <NotFoundPage />;
  }
  // A fresh editor for each page, so one page's text never carries over.
  return <PolicyLoader key={page} page={page} />;
}

function PolicyLoader({ page }: { page: PolicyPageName }) {
  const title = POLICY_TITLES[page];
  usePageTitle(title);
  const detail = usePolicyPage(page);

  return (
    <section className="max-w-6xl">
      <Link
        to="/policies"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Policy pages
      </Link>
      <h1 className="mt-3 text-2xl font-semibold">{title}</h1>
      <p className="mt-1 max-w-3xl text-ink-muted">{POLICY_PURPOSES[page]}</p>

      {detail.isPending ? (
        <ListLoading label={`Loading the ${title.toLowerCase()}…`} />
      ) : detail.isError && !detail.data ? (
        <LoadFailed
          title="This page could not be loaded"
          message={problemMessage(detail.error)}
          retrying={detail.isFetching}
          onRetry={() => void detail.refetch()}
        />
      ) : (
        <>
          <PolicyEditor page={page} detail={detail.data} />
          <Versions page={page} />
        </>
      )}
    </section>
  );
}

// The text the box starts from: the draft, or else what customers see.
const startingText = (detail: PolicyPageDetail) =>
  detail.draft?.body ?? detail.published?.body ?? '';

type Asking = 'publish' | 'discard' | 'reload' | null;

function PolicyEditor({
  page,
  detail,
}: {
  page: PolicyPageName;
  detail: PolicyPageDetail;
}) {
  const title = POLICY_TITLES[page];
  const queryClient = useQueryClient();
  const toasts = useToasts();

  // The text in the box, what it was last saved as, and the revision it
  // was written on.
  const [text, setText] = useState(() => startingText(detail));
  const [saved, setSaved] = useState(() => startingText(detail));
  const [revision, setRevision] = useState(detail.revision);
  const [seen, setSeen] = useState(detail.revision);
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState<Asking>(null);

  const cleaned = cleanText(text);
  const changed = cleaned !== saved;
  const tooLong = cleaned.length - POLICY_MAX_LENGTH;
  const { prompt } = useUnsavedChanges(changed);

  // The page changed on the server (another Super User, or this one in
  // another tab). An untouched box takes the new text; a box being written
  // in keeps its words, and says so below.
  if (detail.revision !== seen) {
    setSeen(detail.revision);
    if (!changed) {
      setText(startingText(detail));
      setSaved(startingText(detail));
      setRevision(detail.revision);
    }
  }
  const outdated = detail.revision !== revision;

  // The page as the server now has it, in the box too.
  const adopt = (next: PolicyPageDetail) => {
    policyChanged(queryClient, next);
    setSeen(next.revision);
    setRevision(next.revision);
    setSaved(startingText(next));
    setError(null);
    setProblem(null);
  };
  const failed = (failure: unknown) => {
    const fields = fieldProblems(failure);
    if (fields.body) {
      setError(fields.body);
      setProblem(null);
      return;
    }
    setProblem(problemMessage(failure));
    // Changed meanwhile: read the page again, to show what changed.
    if (failure instanceof ApiError && failure.status === 409) {
      void queryClient.invalidateQueries({ queryKey: policyKeys.page(page) });
    }
  };

  const save = useMutation({
    mutationKey: CHANGING,
    mutationFn: () => saveDraft(page, cleaned, revision),
    onSuccess: (next) => {
      adopt(next);
      toasts.show('Draft saved');
    },
    onError: failed,
  });
  const publish = useMutation({
    mutationKey: CHANGING,
    mutationFn: () => publishPolicy(page, revision),
    onSuccess: (next) => {
      adopt(next);
      setText(startingText(next));
      setAsking(null);
      toasts.show(
        `${title} published as version ${next.published?.version ?? ''}`.trim(),
      );
    },
    onError: (failure) => {
      setAsking(null);
      failed(failure);
    },
  });
  const discard = useMutation({
    mutationKey: CHANGING,
    mutationFn: () => discardDraft(page, revision),
    onSuccess: (next) => {
      adopt(next);
      setText(startingText(next));
      setAsking(null);
      toasts.show('Draft discarded');
    },
    onError: (failure) => {
      setAsking(null);
      failed(failure);
    },
  });
  const busy = save.isPending || publish.isPending || discard.isPending;

  // The newest text from the server, in place of the box's.
  const reload = () => {
    setText(startingText(detail));
    setSaved(startingText(detail));
    setRevision(detail.revision);
    setError(null);
    setProblem(null);
    setAsking(null);
  };

  const canSave =
    changed &&
    cleaned.length > 0 &&
    tooLong <= 0 &&
    !publish.isPending &&
    !discard.isPending;
  const shown = useDeferredValue(text);
  const nextVersion = (detail.published?.version ?? 0) + 1;

  return (
    <>
      <div className="mt-4 space-y-1 text-sm">
        {detail.published ? (
          <p>On the website: {publishedLine(detail.published)}</p>
        ) : (
          <p className="text-ink-muted">
            Not on the website yet: customers see a note that it is being
            written.
          </p>
        )}
        {detail.draft ? (
          <p>{draftLine(detail.draft)} Not published yet.</p>
        ) : null}
      </div>

      <AnimatePresence initial={false}>
        {outdated ? (
          <motion.div
            key="outdated"
            variants={rise}
            initial="hidden"
            animate="shown"
            exit="gone"
            role="alert"
            className="mt-6 flex flex-wrap items-start gap-3 rounded-card border border-warning/40 bg-warning-soft p-4 text-sm text-ink shadow-clay inset-shadow-clay"
          >
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-warning"
            />
            <p className="min-w-0 flex-1">
              This page was changed elsewhere since you started writing. Your
              words stay in the box until you load the newest text. Copy
              anything you want to keep first.
            </p>
            <Button
              size="sm"
              icon={RefreshCw}
              onClick={() => (changed ? setAsking('reload') : reload())}
            >
              Load the newest text
            </Button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="text-lg font-semibold">Write the page</h2>
          <TextAreaField
            className="mt-3"
            label="The page’s text"
            rows={22}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setError(null);
            }}
            hint={MARKS_HINT}
            error={
              error ??
              (tooLong > 0
                ? `A page holds at most ${POLICY_MAX_LENGTH.toLocaleString('en-IN')} characters: remove ${tooLong.toLocaleString('en-IN')}.`
                : undefined)
            }
            spellCheck
          />
          <p className="mt-1 text-xs text-ink-muted">
            {cleaned.length.toLocaleString('en-IN')} of{' '}
            {POLICY_MAX_LENGTH.toLocaleString('en-IN')} characters
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              onClick={() => save.mutate()}
              disabled={!canSave}
              busy={save.isPending}
            >
              Save draft
            </Button>
            {detail.draft ? (
              <Button
                icon={Send}
                onClick={() => setAsking('publish')}
                disabled={changed || busy || outdated}
              >
                Publish
              </Button>
            ) : null}
            {changed ? (
              <Button
                variant="ghost"
                icon={Undo2}
                onClick={() => {
                  setText(saved);
                  setError(null);
                }}
                disabled={busy}
              >
                Undo my changes
              </Button>
            ) : null}
            {detail.draft && !changed ? (
              <Button
                variant="ghost"
                onClick={() => setAsking('discard')}
                disabled={busy}
              >
                Discard draft
              </Button>
            ) : null}
          </div>
          {detail.draft && changed ? (
            <p className="mt-2 text-sm text-ink-muted">
              Save the draft first: Publish puts the saved draft on the website.
            </p>
          ) : null}
          {problem ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              {problem}
            </p>
          ) : null}
        </div>

        <div>
          <h2 className="text-lg font-semibold">How customers will see it</h2>
          <section
            aria-label="Preview"
            className="mt-3 rounded-card border border-line bg-surface p-5 shadow-clay inset-shadow-clay"
          >
            {hasBlocks(shown) ? (
              <PolicyText text={shown} headingLevel={3} />
            ) : (
              <p className="text-sm text-ink-muted">
                Nothing to show yet: write the page in the box.
              </p>
            )}
          </section>
        </div>
      </div>

      <Dialog
        open={asking === 'publish'}
        onClose={() => setAsking(null)}
        locked={publish.isPending}
        title={`Publish the ${title.toLowerCase()}?`}
        description={
          <>
            <p>
              Customers see the saved draft within a minute, as version{' '}
              {nextVersion}.
            </p>
            {detail.published ? (
              <p>
                Version {detail.published.version}, on the website now, stays in
                the list of versions.
              </p>
            ) : null}
          </>
        }
        actions={
          <>
            <Button
              onClick={() => setAsking(null)}
              disabled={publish.isPending}
            >
              Not now
            </Button>
            <Button
              variant="primary"
              icon={Send}
              onClick={() => publish.mutate()}
              busy={publish.isPending}
            >
              Publish version {nextVersion}
            </Button>
          </>
        }
      />
      <Dialog
        open={asking === 'discard'}
        onClose={() => setAsking(null)}
        locked={discard.isPending}
        tone="danger"
        title="Discard the draft?"
        description={
          <p>
            {detail.published
              ? `The draft is lost, and the box goes back to version ${detail.published.version}, the text on the website.`
              : 'The draft is lost, and the box is emptied.'}
          </p>
        }
        actions={
          <>
            <Button
              onClick={() => setAsking(null)}
              disabled={discard.isPending}
            >
              Keep the draft
            </Button>
            <Button
              variant="danger"
              onClick={() => discard.mutate()}
              busy={discard.isPending}
            >
              Discard draft
            </Button>
          </>
        }
      />
      <Dialog
        open={asking === 'reload'}
        onClose={() => setAsking(null)}
        tone="danger"
        title="Replace your words?"
        description={
          <p>
            The box takes the newest text saved for this page, and the words you
            have written since are lost.
          </p>
        }
        actions={
          <>
            <Button onClick={() => setAsking(null)}>Keep my words</Button>
            <Button variant="danger" onClick={reload}>
              Replace my words
            </Button>
          </>
        }
      />
      {prompt}
    </>
  );
}

// Every version customers have been shown, newest first, each readable:
// the newest 20, and older ones on asking.
function Versions({ page }: { page: PolicyPageName }) {
  const pages = usePolicyVersions(page);
  const versions = pages.data?.pages.flatMap((one) => one.versions);
  const [reading, setReading] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <section aria-labelledby="versions-heading" className="mt-10 max-w-3xl">
      <h2 id="versions-heading" className="text-lg font-semibold">
        Versions
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        Every text customers have been shown, kept as it was.
      </p>
      {pages.isPending ? (
        <ListLoading label="Loading the versions…" />
      ) : !versions ? (
        <LoadFailed
          title="The versions could not be loaded"
          message={problemMessage(pages.error)}
          retrying={pages.isFetching}
          onRetry={() => void pages.refetch()}
        />
      ) : versions.length === 0 ? (
        <p className="mt-4 text-sm">
          None yet: the first appears here once you publish.
        </p>
      ) : (
        <ul
          aria-label="Versions"
          className="mt-4 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-clay inset-shadow-clay"
        >
          {versions.map((version, index) => (
            <li
              key={version.version}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <p>
                <span className="font-semibold">Version {version.version}</span>
                {index === 0 ? (
                  <span className="text-ink-muted"> · on the website</span>
                ) : null}
                <br />
                Published {whenInIndia(version.publishedAt)} by{' '}
                {version.publishedBy.fullName}
              </p>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Read version ${version.version}`}
                onClick={() => {
                  setReading(version.version);
                  setOpen(true);
                }}
              >
                Read
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ShowOlderVersions pages={pages} />
      {reading !== null ? (
        <VersionDialog
          page={page}
          version={reading}
          open={open}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  );
}

// The next, older versions, while there are any. A failure says so beside
// the button, and the button tries again.
function ShowOlderVersions({
  pages,
}: {
  pages: ReturnType<typeof usePolicyVersions>;
}) {
  if (!pages.hasNextPage) {
    return null;
  }
  return (
    <div className="mt-4 flex flex-col items-center gap-2">
      {pages.isFetchNextPageError ? (
        <p role="alert" className="text-sm text-danger">
          Older versions could not be loaded. {problemMessage(pages.error)}
        </p>
      ) : null}
      <Button
        onClick={() => void pages.fetchNextPage()}
        busy={pages.isFetchingNextPage}
        busyLabel="Loading…"
      >
        Show older versions
      </Button>
    </div>
  );
}

function VersionDialog({
  page,
  version,
  open,
  onClose,
}: {
  page: PolicyPageName;
  version: number;
  open: boolean;
  onClose: () => void;
}) {
  const found = usePolicyVersion(page, version);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      title={`${POLICY_TITLES[page]}, version ${version}`}
      description={
        found.data ? (
          <p>
            Published {whenInIndia(found.data.publishedAt)} by{' '}
            {found.data.publishedBy.fullName}.
          </p>
        ) : null
      }
      actions={<Button onClick={onClose}>Close</Button>}
    >
      <div className="mt-4">
        {found.isPending ? (
          <p className="text-sm text-ink-muted">Loading the version…</p>
        ) : found.isError ? (
          <p role="alert" className="text-sm text-danger">
            {problemMessage(found.error)}
          </p>
        ) : (
          <PolicyText text={found.data.body} headingLevel={3} />
        )}
      </div>
    </Dialog>
  );
}
