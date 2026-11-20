import type { ReactNode } from 'react';

// A page that says what happened and offers one way on: "not found", the
// shop resting, or a failure.
export function StatusPage({
  heading,
  body,
  action,
}: {
  heading: string;
  body: string;
  action: ReactNode;
}) {
  return (
    <section className="mx-auto flex max-w-2xl flex-col items-start gap-6 px-6 pt-40 pb-24">
      <h1 className="heading-3 text-ink">{heading}</h1>
      <p className="body-3 text-ink-muted">{body}</p>
      {action}
    </section>
  );
}

// The page's one button, as a link: a pill, like every main button.
export const PILL =
  'button-md inline-flex items-center rounded-full bg-primary px-6 py-3 text-on-primary transition-colors hover:bg-primary-strong';
