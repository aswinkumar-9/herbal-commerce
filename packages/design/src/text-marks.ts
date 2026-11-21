// The simple marks the website's policy pages are written in (ADR 0040),
// read the same way by the console's preview and by the website:
//
// - a blank line starts a new block;
// - a line that starts with "## " is a heading;
// - a line that starts with "- " (or "• ", as pasted from a document) is an
//   item of a list, and the lines after it, until a blank line, belong to
//   that item;
// - every other line is text, and a paragraph keeps its line breaks, so an
//   address stays on its own lines.
//
// Nothing else means anything: every character shows as it was written.
// The blocks are plain data for React to show as text, so no page text can
// ever become code.

export type TextBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] };

const HEADING = /^##[ \t]+(\S.*)$/;
const ITEM = /^[-•][ \t]+(\S.*)$/;

export function readMarks(text: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  // The block being read: a paragraph or a list, never a heading, which is
  // always one line.
  let open: Extract<TextBlock, { kind: 'paragraph' | 'list' }> | undefined;

  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (line === '') {
      open = undefined;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading?.[1]) {
      blocks.push({ kind: 'heading', text: heading[1].trim() });
      open = undefined;
      continue;
    }
    const item = ITEM.exec(line);
    if (item?.[1]) {
      if (open?.kind !== 'list') {
        open = { kind: 'list', items: [] };
        blocks.push(open);
      }
      open.items.push(item[1].trim());
      continue;
    }
    if (open?.kind === 'list') {
      const last = open.items.length - 1;
      open.items[last] = `${open.items[last] ?? ''}\n${line}`;
    } else if (open?.kind === 'paragraph') {
      open.text = `${open.text}\n${line}`;
    } else {
      open = { kind: 'paragraph', text: line };
      blocks.push(open);
    }
  }
  return blocks;
}
