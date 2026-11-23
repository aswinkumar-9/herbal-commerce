// A form's button: while its form is on its way it says so, and a second
// click waits rather than sending it twice. Several on a page (the
// account's, the cart's lines) each say so only for their own form.
export function BusyButton({
  busy,
  label,
  busyLabel,
  className,
  fullLabel,
  name,
  value,
  disabled,
}: {
  busy: boolean;
  label: string;
  busyLabel: string;
  className: string;
  // What it is read out as, when more than its words: it starts with
  // them, so it can be asked for by voice.
  fullLabel?: string | undefined;
  // Sent with the form when this button sends it.
  name?: string | undefined;
  value?: string | undefined;
  // When it can't be used, such as one more pack than allowed.
  disabled?: boolean | undefined;
}) {
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={disabled}
      aria-label={busy ? undefined : fullLabel}
      aria-disabled={busy || undefined}
      onClick={(event) => {
        if (busy) {
          event.preventDefault();
        }
      }}
      className={`${className} aria-disabled:opacity-80 disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {busy ? `${busyLabel}…` : label}
    </button>
  );
}
