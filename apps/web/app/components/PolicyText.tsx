import { readMarks } from '@herbal/design/text-marks';

// A policy page's text (ADR 0040), from the simple marks the Super User
// writes in the console, read the same way as the console's preview:
// headings, paragraphs that keep their line breaks, and lists. Every word
// is shown as text, never as code.
export function PolicyText({ text }: { text: string }) {
  const blocks = readMarks(text);
  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block, index) => {
        const key = `${index}-${block.kind}`;
        if (block.kind === 'heading') {
          return (
            <h2
              key={key}
              className="title-1 pt-4 text-balance text-ink first:pt-0"
            >
              {block.text}
            </h2>
          );
        }
        if (block.kind === 'list') {
          return (
            <ul
              key={key}
              className="body-3 flex list-disc flex-col gap-2 pl-6 text-ink-muted"
            >
              {block.items.map((item, at) => (
                <li key={at} className="whitespace-pre-line text-pretty">
                  {item}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p
            key={key}
            className="body-3 whitespace-pre-line text-pretty text-ink-muted"
          >
            {block.text}
          </p>
        );
      })}
    </div>
  );
}
