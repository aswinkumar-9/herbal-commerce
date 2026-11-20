import { ScrollText, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useId } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { useAdmins } from '../admins/admins-queries';
import { problemMessage } from '../api/problems';
import { useSession } from '../auth/session-context';
import { EmptyList, ListLoading, LoadFailed } from '../catalog/list-states';
import { isId } from '../catalog/catalog-api';
import { Button } from '../components/Button';
import { STAGGER, transition } from '../motion';
import { usePageTitle } from '../page-title';
import { dayName } from '../stock/stock-display';
import { AUDIT_KINDS } from './audit-api';
import type { AuditEntry, AuditKind } from './audit-api';
import {
  KIND_NAMES,
  changedFields,
  indiaDay,
  indiaTime,
  pieces,
  tell,
} from './audit-display';
import { useAuditPages } from './audit-queries';

// The audit log, for Super Users only (ADR 0017, ADR 0038): who did what,
// and when, in sentences, newest first, with what changed on request. It
// narrows to one kind of change, one person (an Admin's "What they did"),
// or one thing (an order's "History"). The filters live in the address,
// so those links lead straight to them.

function kindIn(value: string | null): AuditKind | undefined {
  return (AUDIT_KINDS as readonly string[]).includes(value ?? '')
    ? (value as AuditKind)
    : undefined;
}

export function AuditLogPage() {
  usePageTitle('Audit log');
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const kind = kindIn(params.get('kind'));
  const actor = params.get('actor');
  const target = params.get('target');
  const actorId = isId(actor) ? actor : undefined;
  const targetId = isId(target) ? target : undefined;
  // What the link that led here called the thing, such as an order.
  const label = (location.state as { label?: unknown } | null)?.label;

  const pages = useAuditPages({
    ...(kind ? { kind } : {}),
    ...(actorId ? { actorId } : {}),
    ...(targetId ? { targetId } : {}),
  });
  const entries = pages.data?.pages.flatMap((page) => page.entries) ?? [];
  const filtered = Boolean(kind ?? actorId ?? targetId);

  function filter(name: 'kind' | 'actor' | 'target', value: string | null) {
    const next = new URLSearchParams(params);
    if (value) {
      next.set(name, value);
    } else {
      next.delete(name);
    }
    void setParams(next, { replace: true, state: location.state });
  }

  return (
    <section className="max-w-4xl">
      <header>
        <h1 className="text-2xl font-semibold">Audit log</h1>
        <p className="mt-1 text-ink-muted">
          Who did what, and when. Every change staff make is written here, and
          nothing in it can be changed or deleted.
        </p>
      </header>

      <div className="mt-6 grid items-start gap-4 lg:grid-cols-[1fr_16rem]">
        <KindChips kind={kind} onKind={(next) => filter('kind', next)} />
        <PersonFilter
          actorId={actorId}
          someone={entries.find((entry) => entry.actorId === actorId)?.actor}
          onPerson={(next) => filter('actor', next)}
        />
      </div>
      {targetId ? (
        <p className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-primary-soft px-3 py-1 font-medium text-primary-strong shadow-chip">
            Only{' '}
            {typeof label === 'string'
              ? label
              : (entries[0]?.subject?.name ?? 'one thing')}
          </span>
          <Button
            size="sm"
            variant="ghost"
            icon={X}
            onClick={() => filter('target', null)}
          >
            Show everything
          </Button>
        </p>
      ) : null}

      {pages.isPending ? (
        <ListLoading label="Loading the audit log…" />
      ) : pages.isError && !pages.data ? (
        <LoadFailed
          title="The audit log could not be loaded"
          message={problemMessage(pages.error)}
          retrying={pages.isFetching}
          onRetry={() => void pages.refetch()}
        />
      ) : entries.length === 0 ? (
        <EmptyList
          icon={ScrollText}
          title={filtered ? 'Nothing matches' : 'Nothing yet'}
          action={
            filtered ? (
              <Button onClick={() => void setParams({}, { replace: true })}>
                Show everything
              </Button>
            ) : null
          }
        >
          {filtered
            ? 'No entry fits all of these. Try fewer filters.'
            : 'Changes staff make will be written here.'}
        </EmptyList>
      ) : (
        <div
          aria-busy={pages.isPlaceholderData || undefined}
          className={`transition-opacity duration-150 ${
            pages.isPlaceholderData ? 'opacity-60' : ''
          }`}
        >
          <Days entries={entries} />
          <ShowOlder pages={pages} />
        </div>
      )}
    </section>
  );
}

function KindChips({
  kind,
  onKind,
}: {
  kind: AuditKind | undefined;
  onKind: (kind: AuditKind | null) => void;
}) {
  const chips: { value: AuditKind | null; label: string }[] = [
    { value: null, label: 'Everything' },
    ...AUDIT_KINDS.map((value) => ({ value, label: KIND_NAMES[value] })),
  ];
  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-medium">Show</legend>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {chips.map((chip) => {
          const pressed = (chip.value ?? undefined) === kind;
          return (
            <button
              key={chip.label}
              type="button"
              aria-pressed={pressed}
              onClick={() => onKind(chip.value)}
              className={`relative h-11 rounded-full px-4 text-sm font-medium transition-[color,background-color,box-shadow] duration-150 ${
                pressed
                  ? 'text-primary-strong'
                  : 'border border-line bg-surface text-ink-muted shadow-clay-sm inset-shadow-clay hover:bg-surface-muted hover:text-ink'
              }`}
            >
              {pressed ? (
                <motion.span
                  layoutId="audit-kind"
                  transition={transition}
                  aria-hidden="true"
                  className="absolute inset-0 rounded-full border border-primary/50 bg-primary-soft inset-shadow-pressed"
                />
              ) : null}
              <span className="relative">{chip.label}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

// Everyone, the Super User reading it, or one Admin. Someone else, such as
// another Super User, can still be shown from a link.
function PersonFilter({
  actorId,
  someone,
  onPerson,
}: {
  actorId: string | undefined;
  someone: AuditEntry['actor'] | undefined;
  onPerson: (id: string | null) => void;
}) {
  const id = useId();
  const { state } = useSession();
  const admins = useAdmins();
  const me = state.status === 'signed-in' ? state.staff : null;
  const options = [
    ...(me ? [{ id: me.id, name: `You (${me.fullName})` }] : []),
    ...[...(admins.data ?? [])]
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .map((admin) => ({ id: admin.id, name: admin.fullName })),
  ];
  if (actorId && !options.some((option) => option.id === actorId)) {
    options.push({ id: actorId, name: someone?.fullName ?? 'Someone else' });
  }
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        Done by
      </label>
      <select
        id={id}
        value={actorId ?? ''}
        onChange={(event) => onPerson(event.target.value || null)}
        className="mt-1.5 h-11 w-full rounded-control border border-line-strong bg-surface px-3 text-ink inset-shadow-well outline-none focus:border-primary focus:ring-3 focus:ring-primary/15"
      >
        <option value="">Everyone</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </div>
  );
}

// The entries of each day, under the day, newest first.
function Days({ entries }: { entries: AuditEntry[] }) {
  const days: { day: string; entries: AuditEntry[] }[] = [];
  for (const entry of entries) {
    const day = indiaDay(entry.createdAt);
    const last = days[days.length - 1];
    if (last?.day === day) {
      last.entries.push(entry);
    } else {
      days.push({ day, entries: [entry] });
    }
  }
  let shown = 0;
  return (
    <div className="mt-6 space-y-6">
      {days.map(({ day, entries: ofDay }) => (
        <section key={day} aria-labelledby={`day-${day}`}>
          <h2
            id={`day-${day}`}
            className="text-sm font-semibold text-ink-muted"
          >
            {dayName(day)}
          </h2>
          <ul
            aria-label={`Entries on ${dayName(day)}`}
            className="mt-2 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-clay inset-shadow-clay"
          >
            {ofDay.map((entry) => {
              const delay = Math.min(shown, 10) * STAGGER;
              shown += 1;
              return (
                <motion.li
                  key={entry.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    transition: { ...transition, delay },
                  }}
                  className="px-4 py-3"
                >
                  <Entry entry={entry} />
                </motion.li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

// One entry: when, the sentence, and what changed on request.
function Entry({ entry }: { entry: AuditEntry }) {
  const fields = changedFields(entry);
  return (
    <div className="flex gap-3">
      <time
        dateTime={entry.createdAt}
        className="w-12 shrink-0 pt-px text-sm text-ink-muted tabular-nums"
      >
        {indiaTime(entry.createdAt)}
      </time>
      <div className="min-w-0 flex-1">
        <p>
          {pieces(tell(entry)).map((piece, index) =>
            typeof piece === 'string' ? (
              index === 0 ? (
                <strong key={index} className="font-semibold">
                  {piece}
                </strong>
              ) : (
                piece
              )
            ) : piece.to ? (
              <Link
                key={index}
                to={piece.to}
                className="font-medium text-primary hover:underline"
              >
                {piece.text}
              </Link>
            ) : (
              <span key={index} className="font-medium">
                {piece.text}
              </span>
            ),
          )}
        </p>
        <details className="group mt-1 text-sm">
          <summary className="inline-flex min-h-8 cursor-pointer items-center rounded-md text-ink-muted hover:text-ink">
            {fields.length > 0 ? 'What changed' : 'Details'}
          </summary>
          {fields.length > 0 ? <ChangedTable entry={entry} /> : null}
          <p className="mt-2 text-xs text-ink-muted">
            {entry.ip ? `From ${entry.ip}.` : 'From a developer command.'}
            {entry.requestId ? (
              <>
                {' '}
                Request <span className="font-mono">{entry.requestId}</span>.
              </>
            ) : null}
          </p>
        </details>
      </div>
    </div>
  );
}

function ChangedTable({ entry }: { entry: AuditEntry }) {
  const fields = changedFields(entry);
  const before = entry.before !== null;
  const after = entry.after !== null;
  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">What changed</caption>
        <thead className="bg-surface-muted text-xs text-ink-muted">
          <tr>
            <th scope="col" className="px-3 py-1.5 font-medium">
              Field
            </th>
            {before ? (
              <th scope="col" className="px-3 py-1.5 font-medium">
                Before
              </th>
            ) : null}
            {after ? (
              <th scope="col" className="px-3 py-1.5 font-medium">
                After
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {fields.map((field) => (
            <tr key={field.key}>
              <th scope="row" className="px-3 py-1.5 align-top font-medium">
                {field.label}
              </th>
              {before ? (
                <td className="px-3 py-1.5 align-top break-words text-ink-muted">
                  {field.before ?? '—'}
                </td>
              ) : null}
              {after ? (
                <td className="px-3 py-1.5 align-top break-words">
                  {field.after ?? '—'}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ShowOlder({ pages }: { pages: ReturnType<typeof useAuditPages> }) {
  if (!pages.hasNextPage) {
    return null;
  }
  return (
    <div className="mt-6 flex flex-col items-center gap-2">
      {pages.isFetchNextPageError ? (
        <p role="alert" className="text-sm text-danger">
          Older entries could not be loaded. {problemMessage(pages.error)}
        </p>
      ) : null}
      <Button
        onClick={() => void pages.fetchNextPage()}
        busy={pages.isFetchingNextPage}
        busyLabel="Loading…"
      >
        Show older entries
      </Button>
    </div>
  );
}
