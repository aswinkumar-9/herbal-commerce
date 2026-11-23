import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { useReveal, useTagline } from '../motion.ts';

// A part of the page that rises into view as the customer reaches it.
export function Reveal({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

// The tagline (the website's rule B11): large words, each lighting up in
// turn as the page scrolls. Made on the server fully lit; the script
// quiets the words still to come, to the muted ink: still 4.5:1, so a
// customer who stops scrolling can read them all.
export function Tagline({ lines }: { lines: readonly string[] }) {
  const ref = useTagline<HTMLParagraphElement>();
  return (
    <p ref={ref} className="group heading-4 max-w-170 text-ink md:heading-3">
      {lines.map((line, index) => (
        <Fragment key={line}>
          {index > 0 ? ' ' : null}
          <span className="block text-balance">
            {line.split(' ').map((word, at) => (
              <Fragment key={`${word}-${at}`}>
                {at > 0 ? ' ' : null}
                <span
                  data-word
                  className="transition-colors duration-500 ease-settle group-data-armed:not-data-lit:text-ink-muted"
                >
                  {word}
                </span>
              </Fragment>
            ))}
          </span>
        </Fragment>
      ))}
    </p>
  );
}
