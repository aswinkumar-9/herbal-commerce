import { CircleAlert, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { ApiError } from '../api/api-error';
import { returnPath } from '../auth/return-path';
import { useSession } from '../auth/session-context';
import type { SignedOutNotice } from '../auth/session-context';
import { signInSchema } from '../auth/staff-api';
import type { SignInInput } from '../auth/staff-api';
import { Brand } from '../components/Brand';
import { Field } from '../components/Field';
import { LoadingScreen } from '../components/StatusScreens';
import { DURATION, EASE_OUT, rise } from '../motion';
import { usePageTitle } from '../page-title';

type Values = SignInInput;
type FieldName = keyof Values;
type FieldErrors = Partial<Record<FieldName, string>>;

const FIELDS: FieldName[] = ['email', 'password', 'code'];
const EMPTY: Values = { email: '', password: '', code: '' };

const NOTICES: Record<SignedOutNotice, string> = {
  expired: 'Your session ended. Please sign in again.',
  elsewhere: 'You signed out in another tab.',
};

export function SignInPage() {
  usePageTitle('Sign in');
  const { state, signIn } = useSession();
  const location = useLocation();
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [passwordShown, setPasswordShown] = useState(false);
  const inputs = useRef<Partial<Record<FieldName, HTMLInputElement | null>>>(
    {},
  );

  if (state.status === 'checking') {
    return <LoadingScreen />;
  }
  if (state.status === 'signed-in') {
    const wanted = (location.state as { from?: unknown } | null)?.from;
    return <Navigate to={returnPath(wanted)} replace />;
  }
  const notice =
    state.status === 'signed-out' && state.notice && !problem
      ? NOTICES[state.notice]
      : null;

  function change(field: FieldName, value: string) {
    setValues((now) => ({ ...now, [field]: value }));
    if (errors[field]) {
      setErrors((now) => ({ ...now, [field]: undefined }));
    }
  }

  function focusFirst(found: FieldErrors) {
    const first = FIELDS.find((field) => found[field]);
    if (first) {
      inputs.current[first]?.focus();
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) {
      return;
    }
    const parsed = signInSchema.safeParse(values);
    if (!parsed.success) {
      const found: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as FieldName;
        found[field] ??= issue.message;
      }
      setErrors(found);
      setProblem(null);
      focusFirst(found);
      return;
    }

    setErrors({});
    setProblem(null);
    setBusy(true);
    try {
      // On success the session changes, and this page sends staff on.
      await signIn(parsed.data);
    } catch (error) {
      const outcome = explain(error);
      setProblem(outcome.problem);
      setErrors(outcome.fields);
      // A code works once and only for a moment: the next try needs a new
      // one. After wrong details, the password is not kept on the page.
      setValues((now) => ({
        ...now,
        code: '',
        password: outcome.clearPassword ? '' : now.password,
      }));
      inputs.current[outcome.clearPassword ? 'password' : 'code']?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <motion.section
        variants={rise}
        initial="hidden"
        animate="shown"
        aria-labelledby="sign-in-title"
        className="w-full max-w-sm rounded-card border border-line bg-surface p-8 shadow-soft"
      >
        <Brand />
        <h1 id="sign-in-title" className="mt-8 text-xl font-semibold">
          Sign in
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          For Herbal Commerce staff only.
        </p>

        <AnimatePresence initial={false} mode="wait">
          {problem || notice ? (
            <motion.div
              key={problem ?? notice}
              role={problem ? 'alert' : 'status'}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DURATION.fast, ease: EASE_OUT }}
              className={`mt-6 flex gap-2 rounded-lg p-3 text-sm ${
                problem
                  ? 'bg-danger-soft text-danger'
                  : 'bg-primary-soft text-primary-strong'
              }`}
            >
              <CircleAlert
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0"
              />
              <span>{problem ?? notice}</span>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <form noValidate onSubmit={submit} className="mt-6 space-y-4">
          <Field
            ref={(element) => {
              inputs.current.email = element;
            }}
            label="Email"
            type="email"
            name="email"
            autoComplete="username"
            spellCheck={false}
            value={values.email}
            onChange={(event) => change('email', event.target.value)}
            error={errors.email}
          />
          <Field
            ref={(element) => {
              inputs.current.password = element;
            }}
            label="Password"
            type={passwordShown ? 'text' : 'password'}
            name="password"
            autoComplete="current-password"
            value={values.password}
            onChange={(event) => change('password', event.target.value)}
            error={errors.password}
            trailing={
              <button
                type="button"
                onClick={() => setPasswordShown((shown) => !shown)}
                aria-pressed={passwordShown}
                aria-label={passwordShown ? 'Hide password' : 'Show password'}
                className="grid size-9 place-items-center rounded-md text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
              >
                {passwordShown ? (
                  <EyeOff aria-hidden="true" className="size-4" />
                ) : (
                  <Eye aria-hidden="true" className="size-4" />
                )}
              </button>
            }
          />
          <Field
            ref={(element) => {
              inputs.current.code = element;
            }}
            label="Authenticator code"
            hint="The 6 digits your authenticator app shows now."
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
          <motion.button
            type="submit"
            disabled={busy}
            whileTap={busy ? undefined : { scale: 0.98 }}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary font-medium text-on-primary transition-colors hover:bg-primary-strong disabled:cursor-wait disabled:opacity-80"
          >
            {busy ? (
              <>
                <LoaderCircle
                  aria-hidden="true"
                  className="size-4 animate-spin"
                />
                Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </motion.button>
        </form>
      </motion.section>
    </main>
  );
}

interface Outcome {
  problem: string | null;
  fields: FieldErrors;
  clearPassword: boolean;
}

// Wrong details get one answer that never says which part was wrong.
function explain(error: unknown): Outcome {
  if (!(error instanceof ApiError)) {
    return {
      problem: 'Signing in did not work. Please try again.',
      fields: {},
      clearPassword: false,
    };
  }
  switch (error.status) {
    case 401:
      return {
        problem: 'The email, password or code is not right.',
        fields: {},
        clearPassword: true,
      };
    case 429:
      return {
        problem: `Too many attempts. Try again in ${waitFor(error.retryAfterSeconds)}.`,
        fields: {},
        clearPassword: false,
      };
    case 400: {
      const fields: FieldErrors = {};
      for (const { field, message } of error.fieldErrors) {
        if ((FIELDS as string[]).includes(field)) {
          fields[field as FieldName] ??= message;
        }
      }
      return {
        problem: Object.keys(fields).length ? null : error.message,
        fields,
        clearPassword: false,
      };
    }
    default:
      return {
        problem:
          error.status === 0
            ? error.message
            : 'Signing in did not work. Please try again.',
        fields: {},
        clearPassword: false,
      };
  }
}

export function waitFor(seconds: number | undefined): string {
  if (!seconds) {
    return 'a few minutes';
  }
  if (seconds < 60) {
    return seconds === 1 ? '1 second' : `${seconds} seconds`;
  }
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}
