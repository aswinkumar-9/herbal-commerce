// The website's policy pages (ADR 0040), in the order the footer lists
// them. Each lives at its own word: /privacy, /terms and so on. The API
// keeps the same fixed list, and the Super User writes them in the console.
export const POLICY_PAGES = [
  'privacy',
  'terms',
  'refunds',
  'shipping',
  'contact',
] as const;
export type PolicyPage = (typeof POLICY_PAGES)[number];

// Only the list's own words are pages: never "constructor" or the like.
export function isPolicyPage(value: string | undefined): value is PolicyPage {
  return (
    value !== undefined && (POLICY_PAGES as readonly string[]).includes(value)
  );
}
