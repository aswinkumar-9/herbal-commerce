import { text } from './text/en.ts';

// A page's title in the browser's tab: the page, then the shop.
export const pageTitle = (page: string): string =>
  `${page} · ${text.shop.name}`;
