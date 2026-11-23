import { readMarks } from '@herbal/design/text-marks';
import { useMemo } from 'react';

// A policy page's text as customers will read it (ADR 0040): headings,
// paragraphs that keep their line breaks, and lists, read from the simple
// marks the same way the website reads them. Every word is shown as text,
// never as code.
export function PolicyText({
  text,
  headingLevel,
}: {
  text: string;
  // The page's own headings sit under this level.
  headingLevel: 2 | 3;
}) {
  const blocks = useMemo(() => readMarks(text), [text]);
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div className="space-y-3 text-sm leading-6 text-ink">
      {blocks.map((block, index) => {
        const key = `${index}-${block.kind}`;
        if (block.kind === 'heading') {
          return (
            <Heading
              key={key}
              className="pt-2 text-base font-semibold text-balance first:pt-0"
            >
              {block.text}
            </Heading>
          );
        }
        if (block.kind === 'list') {
          return (
            <ul key={key} className="list-disc space-y-1 pl-5">
              {block.items.map((item, at) => (
                <li key={at} className="whitespace-pre-line">
                  {item}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={key} className="whitespace-pre-line text-pretty">
            {block.text}
          </p>
        );
      })}
    </div>
  );
}

// Whether a text shows anything at all.
export function hasBlocks(text: string): boolean {
  return readMarks(text).length > 0;
}
