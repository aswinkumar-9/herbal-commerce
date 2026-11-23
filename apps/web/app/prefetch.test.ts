import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Every link to another page fetches that page's code and data as soon as
// it is pointed at, focused or touched (prefetch="intent"), so the page is
// there, or nearly, by the click. A link that loads in its own way says
// prefetch="none", on purpose. Read from the pages' own source.
const APP = import.meta.dirname;

function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return pages(path);
    }
    return entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')
      ? [path]
      : [];
  });
}

// Each <Link> and <NavLink> in a file, with its prefetch (or null).
function linksIn(path: string): { at: string; prefetch: string | null }[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: { at: string; prefetch: string | null }[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ['Link', 'NavLink'].includes(node.tagName.getText(source))
    ) {
      const prefetch = node.attributes.properties.find(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(source) === 'prefetch',
      );
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line;
      found.push({
        at: `${path.slice(APP.length + 1)}:${line + 1}`,
        prefetch:
          prefetch && ts.isJsxAttribute(prefetch) && prefetch.initializer
            ? prefetch.initializer.getText(source)
            : null,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('links to other pages', () => {
  const links = pages(APP).flatMap(linksIn);

  it('are found (the reading works)', () => {
    expect(links.length).toBeGreaterThan(30);
  });

  it('every one fetches the next page on intent, or says it does not', () => {
    const unsaid = links.filter(
      (link) => !['"intent"', '"none"'].includes(link.prefetch ?? ''),
    );
    expect(unsaid).toEqual([]);
  });

  it('only the “show more” of a category and of the orders loads in its own way', () => {
    expect(
      links.filter((link) => link.prefetch === '"none"').map((link) => link.at),
    ).toEqual([
      expect.stringMatching(/^routes[\\/]category\.tsx:\d+$/),
      expect.stringMatching(/^routes[\\/]orders\.tsx:\d+$/),
    ]);
  });
});
