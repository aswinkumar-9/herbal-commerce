import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CircleAlert,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  LinkIcon,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ApiError } from '../api/api-error';
import { problemMessage } from '../api/problems';
import { Brand } from '../components/Brand';
import { Button, buttonClass } from '../components/Button';
import { Field } from '../components/Field';
import { DURATION, EASE_OUT, rise } from '../motion';
import { usePageTitle } from '../page-title';
import { momentName } from '../stock/stock-display';
import { QrCode } from './QrCode';
import {
  acceptInvitation,
  keyInGroups,
  linkToken,
  openSetupLink,
  setUpAgain,
} from './setup-api';
import type { LinkPurpose, SetupLink } from './setup-api';

// The pages an Admin opens from an emailed link (ADR 0015, ADR 0038): the
// invitation, where they choose a password and set up an authenticator app,
// and a new start for the app after a Super User reset it. Nobody is signed
// in here: the link's token is the proof. It leaves the address bar at
// once, so it stays out of the history, and lives only in this page.

const TITLES: Record<LinkPurpose, string> = {
  INVITE: 'Accept your invitation',
  AUTHENTICATOR_RESET: 'Set up your authenticator app',
};

// Staff passwords are longer than customers' (ADR 0013).
export const PASSWORD_MIN = 16;
export const PASSWORD_MAX = 128;

const linkKey = (token: string | null) => ['setup-link', token] as const;

export function SetupLinkPage({ purpose }: { purpose: LinkPurpose }) {
  usePageTitle(TITLES[purpose]);
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [token] = useState(() => linkToken(location.search));
  const [outcome, setOutcome] = useState<'open' | 'done' | 'ended'>('open');

  // The token out of the address bar and the history.
  useEffect(() => {
    if (location.search) {
      void navigate({ pathname: location.pathname }, { replace: true });
    }
  }, [location.search, location.pathname, navigate]);

  const link = useQuery({
    queryKey: linkKey(token),
    queryFn: ({ signal }) => openSetupLink(token ?? '', signal),
    enabled: token !== null && outcome === 'open',
    // The key is shown once per visit, and never kept after it.
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  function finish(next: 'done' | 'ended') {
    setOutcome(next);
    queryClient.removeQueries({ queryKey: linkKey(token) });
  }

  let content: ReactNode;
  if (token === null) {
    content = (
      <LinkProblem title="This link is not complete">
        Open the link from your email again: it may have been cut short when it
        was copied. If it still doesn’t work, ask a Super User to send you a new
        one.
      </LinkProblem>
    );
  } else if (outcome === 'done') {
    content = <AllSet purpose={link.data?.purpose ?? purpose} />;
  } else if (
    outcome === 'ended' ||
    (link.error instanceof ApiError && link.error.status === 400)
  ) {
    content = (
      <LinkProblem title="This link no longer works">
        It has been used already, it has ended, or a newer email replaced it.
        Ask a Super User to send you a new one.
      </LinkProblem>
    );
  } else if (link.isPending) {
    content = (
      <div className="mt-8 flex items-center gap-3 text-sm text-ink-muted">
        <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
        <output>Opening your link…</output>
      </div>
    );
  } else if (link.isError) {
    content = (
      <LinkProblem
        title="Your link could not be opened"
        retry={{ busy: link.isFetching, run: () => void link.refetch() }}
      >
        {problemMessage(link.error)}
      </LinkProblem>
    );
  } else {
    content = (
      <SetupForm
        link={link.data}
        token={token}
        onDone={() => finish('done')}
        onEnded={() => finish('ended')}
      />
    );
  }

  return (
    <main className="grid min-h-dvh place-items-center p-4 sm:p-6">
      <motion.section
        variants={rise}
        initial="hidden"
        animate="shown"
        aria-labelledby="setup-title"
        className="w-full max-w-lg rounded-card border border-line bg-surface p-6 shadow-clay-lg inset-shadow-clay sm:p-8"
      >
        <Brand />
        <h1 id="setup-title" className="mt-8 text-xl font-semibold">
          {link.data && outcome === 'open'
            ? link.data.purpose === 'INVITE'
              ? `Welcome, ${link.data.fullName}`
              : 'Set up your authenticator app again'
            : TITLES[purpose]}
        </h1>
        {content}
      </motion.section>
    </main>
  );
}

function LinkProblem({
  title,
  children,
  retry,
}: {
  title: string;
  children: ReactNode;
  retry?: { busy: boolean; run: () => void };
}) {
  return (
    <div role="alert" className="mt-4">
      <div className="flex gap-3 rounded-lg bg-danger-soft p-4 text-sm text-danger">
        <LinkIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <div>
          <p className="font-semibold">{title}</p>
          <p className="mt-1">{children}</p>
        </div>
      </div>
      {retry ? (
        <Button className="mt-4" onClick={retry.run} busy={retry.busy}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

function AllSet({ purpose }: { purpose: LinkPurpose }) {
  return (
    <div className="mt-4">
      <output className="flex gap-3 rounded-lg bg-primary-soft p-4 text-sm text-primary-strong">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <span>
          {purpose === 'INVITE'
            ? 'Your password and authenticator app are set. Sign in with them.'
            : 'Your authenticator app is set. Sign in with your password and a code from it.'}
        </span>
      </output>
      <Link
        to="/sign-in"
        replace
        className={`${buttonClass('primary')} mt-6 w-full`}
      >
        Go to sign in
      </Link>
    </div>
  );
}

type FieldName = 'password' | 'confirm' | 'code';
type FieldErrors = Partial<Record<FieldName, string>>;
const FIELDS: FieldName[] = ['password', 'confirm', 'code'];

function SetupForm({
  link,
  token,
  onDone,
  onEnded,
}: {
  link: SetupLink;
  token: string;
  onDone: () => void;
  onEnded: () => void;
}) {
  const inviting = link.purpose === 'INVITE';
  const [values, setValues] = useState({ password: '', confirm: '', code: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(false);
  const boxes = useRef<Partial<Record<FieldName, HTMLInputElement | null>>>({});

  function change(name: FieldName, value: string) {
    setValues((now) => ({ ...now, [name]: value }));
    if (errors[name]) {
      setErrors((now) => ({ ...now, [name]: undefined }));
    }
  }

  function focusFirst(found: FieldErrors) {
    const first = FIELDS.find((name) => found[name]);
    if (first) {
      boxes.current[first]?.focus();
    }
  }

  // The same checks as the API, so most mistakes are caught before sending.
  function check(): FieldErrors {
    const found: FieldErrors = {};
    if (inviting) {
      if (values.password.length < PASSWORD_MIN) {
        found.password = `Use at least ${PASSWORD_MIN} characters`;
      } else if (values.password.length > PASSWORD_MAX) {
        found.password = `Use at most ${PASSWORD_MAX} characters`;
      } else if (values.confirm !== values.password) {
        found.confirm = 'The two passwords are not the same';
      }
    } else if (!values.password) {
      found.password = 'Enter your password';
    }
    if (!/^\d{6}$/.test(values.code)) {
      found.code = 'Type the 6 digits your app shows now';
    }
    return found;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) {
      return;
    }
    const found = check();
    setErrors(found);
    setProblem(null);
    if (Object.keys(found).length > 0) {
      focusFirst(found);
      return;
    }
    setBusy(true);
    try {
      const fields = { token, password: values.password, code: values.code };
      await (inviting ? acceptInvitation(fields) : setUpAgain(fields));
      onDone();
      return;
    } catch (error) {
      const outcome = explain(error);
      if (outcome === 'ended') {
        onEnded();
        return;
      }
      setProblem(outcome.problem);
      setErrors(outcome.fields);
      // A code works once, and only for a moment: the next try needs a new
      // one. After a wrong password, it is not kept on the page either.
      setValues((now) => ({
        password: outcome.clearPassword ? '' : now.password,
        confirm: outcome.clearPassword ? '' : now.confirm,
        code: '',
      }));
      const first = FIELDS.find((name) => outcome.fields[name]);
      boxes.current[
        first ?? (outcome.clearPassword ? 'password' : 'code')
      ]?.focus();
    } finally {
      setBusy(false);
    }
  }

  const passwordToggle = (
    <button
      type="button"
      onClick={() => setShown((now) => !now)}
      aria-pressed={shown}
      aria-label={shown ? 'Hide password' : 'Show password'}
      className="grid size-9 place-items-center rounded-md text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
    >
      {shown ? (
        <EyeOff aria-hidden="true" className="size-4" />
      ) : (
        <Eye aria-hidden="true" className="size-4" />
      )}
    </button>
  );

  return (
    <>
      <p className="mt-1 text-sm text-ink-muted">
        {inviting
          ? 'Choose your password and set up an authenticator app on your phone to join Herbal Commerce as an Admin.'
          : 'A Super User reset your authenticator app, so the codes from your old phone no longer work. Set it up again on your phone.'}
      </p>

      <AnimatePresence initial={false}>
        {problem ? (
          <motion.p
            key={problem}
            role="alert"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DURATION.fast, ease: EASE_OUT }}
            className="mt-6 flex gap-2 rounded-lg bg-danger-soft p-3 text-sm text-danger"
          >
            <CircleAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
            />
            <span>{problem}</span>
          </motion.p>
        ) : null}
      </AnimatePresence>

      <form method="post" noValidate onSubmit={submit} className="mt-6">
        <Step
          number={1}
          title={inviting ? 'Choose your password' : 'Your password'}
        >
          <Field
            label="Email"
            type="email"
            name="email"
            autoComplete="username"
            value={link.email}
            readOnly
          />
          <Field
            ref={(element) => {
              boxes.current.password = element;
            }}
            label={inviting ? 'New password' : 'Password'}
            type={shown ? 'text' : 'password'}
            name="password"
            autoComplete={inviting ? 'new-password' : 'current-password'}
            maxLength={PASSWORD_MAX}
            hint={
              inviting
                ? `At least ${PASSWORD_MIN} characters. A few unrelated words you can remember work well.`
                : 'The one you sign in with.'
            }
            value={values.password}
            onChange={(event) => change('password', event.target.value)}
            error={errors.password}
            trailing={passwordToggle}
          />
          {inviting ? (
            <Field
              ref={(element) => {
                boxes.current.confirm = element;
              }}
              label="The same password again"
              type={shown ? 'text' : 'password'}
              name="confirm"
              autoComplete="new-password"
              maxLength={PASSWORD_MAX}
              value={values.confirm}
              onChange={(event) => change('confirm', event.target.value)}
              error={errors.confirm}
            />
          ) : null}
        </Step>

        <Step number={2} title="Add Herbal Commerce to your authenticator app">
          <p className="text-sm text-ink-muted">
            Scan this code with an app such as Google Authenticator or Microsoft
            Authenticator.
          </p>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <QrCode
              value={link.uri}
              label={`QR code to add ${link.email} to your authenticator app`}
            />
            <KeyByHand link={link} />
          </div>
        </Step>

        <Step number={3} title="Type the code your app shows">
          <Field
            ref={(element) => {
              boxes.current.code = element;
            }}
            label="Authenticator code"
            hint="The 6 digits under Herbal Commerce in the app. A new one comes every 30 seconds."
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={values.code}
            onChange={(event) =>
              change('code', event.target.value.replace(/\D/g, '').slice(0, 6))
            }
            error={errors.code}
          />
        </Step>

        <Button
          type="submit"
          variant="primary"
          busy={busy}
          busyLabel="Setting up…"
          className="mt-6 h-11 w-full"
        >
          {inviting ? 'Join Herbal Commerce' : 'Set up the app'}
        </Button>
        <p className="mt-4 text-center text-xs text-ink-muted">
          This link works until {momentName(link.expiresAt)}, once.
        </p>
      </form>
    </>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="mt-6 space-y-4 first:mt-0">
      <legend className="mb-4 flex items-center gap-3 font-semibold">
        <span
          aria-hidden="true"
          className="grid size-7 shrink-0 place-items-center rounded-full bg-primary-soft text-sm text-primary-strong shadow-chip"
        >
          {number}
        </span>
        <span>
          {/* The space is outside the hidden words, where it is kept. */}
          <span className="sr-only">Step {number}:</span> {title}
        </span>
      </legend>
      {children}
    </fieldset>
  );
}

// For a phone that can't scan: the key, in groups of four, to type in.
function KeyByHand({ link }: { link: SetupLink }) {
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);

  function copy() {
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard) {
      setCopied('no');
      return;
    }
    clipboard.writeText(link.key).then(
      () => setCopied('yes'),
      () => setCopied('no'),
    );
  }

  return (
    <div className="min-w-0 flex-1 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <KeyRound aria-hidden="true" className="size-4 text-ink-muted" />
        Can’t scan it? Add the key by hand:
      </p>
      <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
        <dt className="text-ink-muted">Account</dt>
        <dd className="break-all">{link.email}</dd>
        <dt className="text-ink-muted">Key</dt>
        <dd className="font-mono break-words select-all">
          {keyInGroups(link.key)}
        </dd>
        <dt className="text-ink-muted">Type</dt>
        <dd>Time based</dd>
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" icon={Copy} onClick={copy}>
          Copy the key
        </Button>
        <output className="text-xs text-ink-muted">
          {copied === 'yes'
            ? 'Copied.'
            : copied === 'no'
              ? 'It could not be copied: select it and copy it.'
              : ''}
        </output>
      </div>
    </div>
  );
}

type Explained =
  | 'ended'
  | { problem: string | null; fields: FieldErrors; clearPassword: boolean };

function explain(error: unknown): Explained {
  if (error instanceof ApiError && error.status === 400) {
    const fields: FieldErrors = {};
    for (const { field, message } of error.fieldErrors) {
      if ((FIELDS as string[]).includes(field)) {
        fields[field as FieldName] ??= message;
      }
    }
    // Refused without a field to blame: the link itself no longer works
    // (used meanwhile, ended, or replaced by a newer email).
    if (Object.keys(fields).length === 0) {
      return 'ended';
    }
    return { problem: null, fields, clearPassword: false };
  }
  if (error instanceof ApiError && error.status === 401) {
    // One answer for both, as at sign-in: it never says which was wrong.
    return {
      problem: 'The password or the code is not right.',
      fields: {},
      clearPassword: true,
    };
  }
  return { problem: problemMessage(error), fields: {}, clearPassword: false };
}
