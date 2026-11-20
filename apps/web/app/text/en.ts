// Every word the website shows, in English (ADR 0039). Pages never write
// their own words: they take them from here, so other languages can come
// later as files like this one.
export const text = {
  shop: {
    // The shop's name until the owner confirms it.
    name: 'Herbal Commerce',
  },
  skipLink: 'Skip to content',
  nav: {
    label: 'Main',
    phoneLabel: 'Main, on a phone',
    menu: 'Menu',
    home: 'Home',
  },
  theme: {
    label: 'Theme',
    system: 'Auto',
    light: 'Light',
    dark: 'Dark',
  },
  footer: {
    label: 'About the shop',
    prices: 'Prices include GST.',
    delivery: 'We deliver across India.',
  },
  home: {
    title: 'Herbal Commerce',
    description: 'Herbal products, delivered across India.',
    heading: 'Herbal Commerce',
    categories: 'Categories',
    noCategories: 'The shop is being stocked. Please come back soon.',
  },
  notFound: {
    title: 'Page not found',
    heading: 'We couldn’t find that page',
    body: 'The link may be old, or the page may have moved.',
    home: 'Back to the shop',
  },
  unavailable: {
    title: 'Back in a moment',
    heading: 'The shop is taking a short break',
    body: 'Please try again in a minute.',
    retry: 'Try again',
  },
  failed: {
    title: 'Something went wrong',
    heading: 'Something went wrong',
    body: 'Please try again. If it keeps happening, come back a little later.',
    retry: 'Try again',
  },
} as const;
