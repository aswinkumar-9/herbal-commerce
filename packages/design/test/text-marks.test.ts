import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMarks } from '../src/text-marks.ts';

test('reads headings, paragraphs and lists', () => {
  assert.deepEqual(
    readMarks(
      [
        '## Who we are',
        '',
        'We sell herbs.',
        '',
        '## What we keep',
        '- Your name',
        '- Your address',
        '',
        'That is all.',
      ].join('\n'),
    ),
    [
      { kind: 'heading', text: 'Who we are' },
      { kind: 'paragraph', text: 'We sell herbs.' },
      { kind: 'heading', text: 'What we keep' },
      { kind: 'list', items: ['Your name', 'Your address'] },
      { kind: 'paragraph', text: 'That is all.' },
    ],
  );
});

test('keeps a paragraph’s line breaks, so an address stays on its lines', () => {
  assert.deepEqual(
    readMarks('Herbal Commerce\n12 Market Road\nBengaluru 560001'),
    [
      {
        kind: 'paragraph',
        text: 'Herbal Commerce\n12 Market Road\nBengaluru 560001',
      },
    ],
  );
});

test('a heading needs no blank line around it, and ends the block before it', () => {
  assert.deepEqual(
    readMarks('Text before\n## Heading\nText after\n- item\n## Next'),
    [
      { kind: 'paragraph', text: 'Text before' },
      { kind: 'heading', text: 'Heading' },
      { kind: 'paragraph', text: 'Text after' },
      { kind: 'list', items: ['item'] },
      { kind: 'heading', text: 'Next' },
    ],
  );
});

test('a line after a list item, until a blank line, belongs to the item', () => {
  assert.deepEqual(
    readMarks('- First item\n  goes on here\n- Second\n\nA paragraph'),
    [
      { kind: 'list', items: ['First item\ngoes on here', 'Second'] },
      { kind: 'paragraph', text: 'A paragraph' },
    ],
  );
});

test('a blank line between items starts a new list', () => {
  assert.deepEqual(readMarks('- one\n\n- two'), [
    { kind: 'list', items: ['one'] },
    { kind: 'list', items: ['two'] },
  ]);
});

test('takes bullets pasted from a document, with a space or a tab', () => {
  assert.deepEqual(readMarks('•\tPasted\n• Typed\n-\tTabbed'), [
    { kind: 'list', items: ['Pasted', 'Typed', 'Tabbed'] },
  ]);
});

test('anything else is text, shown as written', () => {
  for (const line of [
    '##No space',
    '## ',
    '### Three',
    '# One',
    '-No space',
    '- ',
    '* star',
    '1. numbered',
    '**bold**',
    '<script>alert(1)</script>',
    '[a link](https://example.com)',
    '&amp; &lt;b&gt;',
  ]) {
    assert.deepEqual(
      readMarks(line),
      [{ kind: 'paragraph', text: line.trim() }],
      line,
    );
  }
});

test('Windows and old Mac line ends read the same as Unix ones', () => {
  const unix = readMarks('## A\n\nB\n- c');
  assert.deepEqual(readMarks('## A\r\n\r\nB\r\n- c'), unix);
  assert.deepEqual(readMarks('## A\r\rB\r- c'), unix);
});

test('spaces at the ends of lines, and extra blank lines, change nothing', () => {
  assert.deepEqual(
    readMarks('\n\n   ##   Spaced heading   \n\n\n\n  text  \n \t \n'),
    [
      { kind: 'heading', text: 'Spaced heading' },
      { kind: 'paragraph', text: 'text' },
    ],
  );
});

test('an empty text has no blocks', () => {
  assert.deepEqual(readMarks(''), []);
  assert.deepEqual(readMarks(' \n\t\n'), []);
});

test('reads Hindi and other scripts as text', () => {
  assert.deepEqual(readMarks('## गोपनीयता नीति\n\n- आपका नाम'), [
    { kind: 'heading', text: 'गोपनीयता नीति' },
    { kind: 'list', items: ['आपका नाम'] },
  ]);
});

test('reads the longest page quickly', () => {
  const page = Array.from({ length: 1500 }, (_, i) =>
    i % 3 === 0 ? `## H${i}` : `- item ${i}`,
  ).join('\n');
  const started = performance.now();
  const blocks = readMarks(page.slice(0, 30_000));
  assert.ok(blocks.length > 0);
  assert.ok(performance.now() - started < 100);
});
