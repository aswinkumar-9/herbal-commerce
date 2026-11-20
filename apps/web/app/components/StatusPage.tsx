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
    <section className="mx-auto w-full max-w-2xl px-6 py-24">
      {/* Clear of the floating menu bar. */}
      <div className="mt-16 flex flex-col items-start gap-6">
        <h1 className="heading-3 text-ink">{heading}</h1>
        <p className="body-3 text-ink-muted">{body}</p>
        {action}
      </div>
    </section>
  );
}
