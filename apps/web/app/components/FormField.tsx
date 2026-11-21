import { useState, useSyncExternalStore } from 'react';
import type { ComponentProps } from 'react';

// The website's form fields (part 14B): a label above, the box, then what
// is wrong with it, read out with the box. Pills, like the shop's search.
const FIELD =
  'body-3 w-full rounded-full border border-line-strong bg-surface px-4 py-3 text-ink placeholder:text-ink-muted aria-invalid:border-danger';

type FieldProps = Omit<ComponentProps<'input'>, 'id' | 'name' | 'className'> & {
  name: string;
  label: string;
  problem?: string | undefined;
};

export function TextField({ name, label, problem, ...input }: FieldProps) {
  const problemId = `${name}-problem`;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={name} className="caption-1 text-ink-muted">
        {label}
      </label>
      <input
        id={name}
        name={name}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? problemId : undefined}
        className={FIELD}
        {...input}
      />
      <Problem id={problemId} message={problem} />
    </div>
  );
}

// False while the server makes the page, true once its script runs.
const never = () => () => undefined;
const useRunning = (): boolean =>
  useSyncExternalStore(
    never,
    () => true,
    () => false,
  );

// A password box. Once the page's script runs, a switch shows the password
// as typed; without the script there is no switch, rather than one that
// does nothing.
export function PasswordField({
  showLabel,
  ...field
}: Omit<FieldProps, 'type'> & { showLabel: string }) {
  const running = useRunning();
  const [shown, setShown] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <TextField {...field} type={shown ? 'text' : 'password'} />
      {running ? (
        <label className="caption-2 flex cursor-pointer items-center gap-2 self-start px-4 text-ink-muted">
          <input
            type="checkbox"
            checked={shown}
            onChange={(event) => setShown(event.target.checked)}
            className="size-4 accent-primary"
          />
          {showLabel}
        </label>
      ) : null}
    </div>
  );
}

export function Problem({
  id,
  message,
}: {
  id: string;
  message?: string | undefined;
}) {
  return message ? (
    <p id={id} className="caption-2 px-4 text-danger">
      {message}
    </p>
  ) : null;
}
