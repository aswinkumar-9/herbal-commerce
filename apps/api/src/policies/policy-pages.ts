import type { PolicyKind } from '../generated/prisma/enums';

// The website's policy pages (ADR 0040), as their addresses name them, in
// the order the console and the website list them. A new page needs a new
// PolicyKind, a migration, and its title on the website and in the console.
export const POLICY_PAGES = [
  'privacy',
  'terms',
  'refunds',
  'shipping',
  'contact',
] as const;
export type PolicyPageName = (typeof POLICY_PAGES)[number];

const KINDS: Record<PolicyPageName, PolicyKind> = {
  privacy: 'PRIVACY',
  terms: 'TERMS',
  refunds: 'REFUNDS',
  shipping: 'SHIPPING',
  contact: 'CONTACT',
};

// The kind for a page's name, or none for any other word: only the
// object's own keys count, so "constructor" or "__proto__" is no page.
export function policyKindOf(page: string): PolicyKind | undefined {
  return Object.hasOwn(KINDS, page) ? KINDS[page as PolicyPageName] : undefined;
}

export function policyPageOf(kind: PolicyKind): PolicyPageName {
  const page = POLICY_PAGES.find((name) => KINDS[name] === kind);
  if (!page) {
    throw new Error(`No page name for the policy kind ${kind}`);
  }
  return page;
}
