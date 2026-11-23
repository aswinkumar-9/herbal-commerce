import { useEffect, useRef } from 'react';
import type { ReactNode, Ref } from 'react';
import { useNavigation } from 'react-router';
import { GOLD_PILL } from './pills.ts';

// The frame of the account forms (part 14B): sign in, sign up, the emailed
// links. A narrow column, the heading, a line about it, then the form or
// what came of it.
export function FormPage({
  title,
  intro,
  titleRef,
  children,
}: {
  title: string;
  intro?: string | undefined;
  titleRef?: Ref<HTMLHeadingElement>;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-8 px-6 pt-32 pb-24">
      <header className="flex flex-col gap-3">
        <h1
          ref={titleRef}
          tabIndex={-1}
          className="heading-4 text-balance text-ink outline-none"
        >
          {title}
        </h1>
        {intro ? (
          <p className="body-3 text-pretty text-ink-muted">{intro}</p>
        ) : null}
      </header>
      {children}
    </div>
  );
}

// What went wrong with the whole form: read out at once, and the keyboard
// goes to it.
export function FormAlert({
  alertRef,
  children,
}: {
  alertRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <div
      ref={alertRef}
      tabIndex={-1}
      role="alert"
      className="flex flex-col gap-2 rounded-3xl bg-danger-soft p-6 outline-none"
    >
      {children}
    </div>
  );
}

// A link inside a sentence.
export const TEXT_LINK =
  'text-primary underline underline-offset-4 transition-colors duration-300 ease-settle hover:text-ink';

// While the form is on its way, the button says so, and a second click
// waits rather than sending it twice.
export function SendButton({
  label,
  sendingLabel,
}: {
  label: string;
  sendingLabel: string;
}) {
  const navigation = useNavigation();
  const sending =
    navigation.state !== 'idle' && navigation.formMethod === 'POST';
  return (
    <button
      type="submit"
      aria-disabled={sending || undefined}
      onClick={(event) => {
        if (sending) {
          event.preventDefault();
        }
      }}
      className={`${GOLD_PILL} w-full aria-disabled:opacity-80`}
    >
      {sending ? `${sendingLabel}…` : label}
    </button>
  );
}

export type FormProblems = Partial<Record<string, string>>;

const NO_SECRETS: readonly string[] = [];

// After the form comes back. Password boxes are emptied: a password is
// never kept on the page, as when the page comes back without its script.
// Then the keyboard goes to what needs fixing: the first field with a
// problem, else the message about the whole form; or, when it worked, to
// the heading that now says so.
export function useAfterSending(
  answer: { problems?: FormProblems; done?: boolean } | undefined,
  fields: readonly string[],
  secrets: readonly string[] = NO_SECRETS,
) {
  const alert = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!answer) {
      return;
    }
    for (const id of secrets) {
      const box = document.getElementById(id);
      if (box instanceof HTMLInputElement) {
        box.value = '';
      }
    }
    if (answer.done) {
      title.current?.focus();
      return;
    }
    const problems = answer.problems ?? {};
    const first = fields.find((name) => problems[name]);
    if (first) {
      document.getElementById(first)?.focus();
    } else {
      alert.current?.focus();
    }
  }, [answer, fields, secrets]);
  return { alert, title };
}
