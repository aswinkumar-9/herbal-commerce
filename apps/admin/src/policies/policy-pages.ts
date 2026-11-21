// The website's policy pages (ADR 0040), in the order the website's footer
// lists them, with their names as customers read them. The API keeps the
// same fixed list.
export const POLICY_PAGES = [
  'privacy',
  'terms',
  'refunds',
  'shipping',
  'contact',
] as const;
export type PolicyPageName = (typeof POLICY_PAGES)[number];

export const POLICY_TITLES: Record<PolicyPageName, string> = {
  privacy: 'Privacy policy',
  terms: 'Terms and conditions',
  refunds: 'Refunds and cancellations',
  shipping: 'Shipping and delivery',
  contact: 'Contact us',
};

// What each page is for, to help the Super User writing it.
export const POLICY_PURPOSES: Record<PolicyPageName, string> = {
  privacy:
    'What personal details the shop keeps, why, for how long, and how customers can ask about them.',
  terms:
    'The terms of sale and of using the website: orders, prices, payment and delivery.',
  refunds:
    'When customers can cancel or return an order, and how and when their money goes back.',
  shipping:
    'Where the shop delivers, what delivery costs, and how long it takes.',
  contact:
    'How customers reach the shop: email, phone, address and hours, and who handles complaints.',
};

// A page's name from an address, or none for any other word: only the
// list's own names count, so "constructor" is no page.
export function isPolicyPage(
  value: string | undefined,
): value is PolicyPageName {
  return value !== undefined && Object.hasOwn(POLICY_TITLES, value);
}
