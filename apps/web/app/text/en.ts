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
    shop: 'Shop',
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
  // The home page (part 14A): calm and premium, by the owner's choice, and
  // only what is true of the shop (2026-11-20): its own fields and makers,
  // made in India, AYUSH licensed Ayurveda, tested in a lab; prices with
  // GST; delivery free from ₹499 and ₹49 below it, across India; paid
  // online; cancelling until it ships, with the money back in full; at
  // least six months before a pack expires.
  home: {
    title: 'Herbs from our own fields',
    description:
      'Herbs grown on our own fields, tested in a lab and made in India. Prices include GST, and delivery is free from ₹499.',
    previewAlt:
      'Fresh herbs, saffron and amber jars on a wooden table in morning light.',
    hero: {
      // Broken where the thought breaks.
      // Two lines of at most 680 px at 60 px (648 and 494 in Poppins).
      heading: ['Herbs from our fields,', 'made with care.'],
      body: 'Grown on our own fields and tested in a lab before they reach you. Prices include GST, and delivery is free from ₹499.',
      cta: 'Shop the herbs',
      proof: ['Made in India', 'AYUSH licensed Ayurveda', 'Tested in a lab'],
    },
    promises: {
      heading: 'What you can count on',
      items: [
        {
          title: 'From our own fields',
          body: 'We grow and make what we sell, so we know where every herb begins.',
        },
        {
          title: 'Tested in a lab',
          body: 'Every batch is tested before it is sold.',
        },
        {
          title: 'Licensed and labelled',
          body: 'Our Ayurvedic medicines carry an AYUSH licence, and every product shows its licence and its maker.',
        },
        {
          title: 'Six months or more',
          body: 'Every pack we send has at least six months before it expires.',
        },
      ],
    },
    tagline: [
      'Grown slowly in our fields,',
      'tested with care,',
      'and sent to your home.',
    ],
    fields: {
      heading: 'Grown where we can see it',
      body: 'Our herbs grow on our own fields in India, and we make and pack them ourselves.',
      alt: 'Two people sharing saffron tea on a terrace above fields of saffron flowers and herbs, at sunrise.',
    },
    steps: {
      heading: 'How it works',
      items: [
        {
          title: 'Choose your herbs',
          body: 'Browse by category, or search by name.',
        },
        {
          title: 'Pay online',
          body: 'With UPI, a card or net banking, through Razorpay.',
        },
        {
          title: 'We pack and send',
          body: 'An email tells you each step, until it reaches your door anywhere in India.',
        },
      ],
    },
    categories: {
      heading: 'Shop by category',
      empty: 'The shop is being stocked. Please come back soon.',
    },
    questions: {
      heading: 'Questions',
      items: [
        {
          question: 'Where do you deliver?',
          answer: 'Anywhere in India.',
        },
        {
          question: 'How much is delivery?',
          answer:
            'Free on orders of ₹499 or more. Below that, delivery is ₹49.',
        },
        {
          question: 'How do I pay?',
          answer:
            'Online, through Razorpay: with UPI, a card, net banking or a wallet. We don’t take cash on delivery for now.',
        },
        {
          question: 'Can I cancel an order?',
          answer:
            'Yes, until it ships. If you have paid, the payment goes back to you in full.',
        },
        {
          question: 'How long will my herbs keep?',
          answer:
            'Every pack we send has at least six months before it expires.',
        },
        {
          question: 'Do prices include GST?',
          answer: 'Yes. Every price you see includes GST, in whole rupees.',
        },
        {
          question: 'Are your products licensed?',
          answer:
            'Yes. Each product’s page shows its licence number and its maker’s name and address. Our Ayurvedic medicines carry an AYUSH licence.',
        },
      ],
    },
    closing: {
      heading: 'Find the herbs that suit you',
      cta: 'Shop the herbs',
    },
  },
  // A product as a card in a list, and its price: the lowest of its packs
  // on sale, in whole rupees with GST.
  card: {
    from: (price: string) => `From ${price}`,
    notOnSale: 'Not on sale yet',
    outOfStock: 'Out of stock',
  },
  // The shop: every product, searched by words, filtered and sorted.
  shopPage: {
    title: 'Shop',
    resultsTitle: (words: string) => `Results for “${words}”`,
    description:
      'All our herbs, grown on our own fields and tested in a lab. Prices include GST, and delivery is free from ₹499.',
    heading: 'The shop',
    search: {
      label: 'Search the shop',
      placeholder: 'Search by name',
      submit: 'Search',
    },
    filters: {
      summary: 'Filters',
      inUse: (count: number) => `${count} in use`,
      category: 'Category',
      allCategories: 'All categories',
      type: 'Type',
      allTypes: 'All types',
      min: 'Lowest price in rupees',
      max: 'Highest price in rupees',
      apply: 'Show results',
      chipsLabel: 'Filters in use',
      remove: (name: string) => `Remove ${name}`,
      clear: 'Clear filters',
    },
    types: {
      'ayurvedic-medicine': 'Ayurvedic medicine',
      'food-or-supplement': 'Food or supplement',
      cosmetic: 'Cosmetic',
    },
    priceRange: (min?: string, max?: string) =>
      min && max ? `${min} to ${max}` : min ? `From ${min}` : `Up to ${max}`,
    sort: {
      label: 'Sort by',
      apply: 'Sort',
      relevance: 'Best match',
      'price-asc': 'Price, low to high',
      'price-desc': 'Price, high to low',
      name: 'Name, A to Z',
    },
    found: (count: number) => (count === 1 ? '1 product' : `${count} products`),
    foundFor: (count: number, words: string) =>
      `${count === 1 ? '1 product' : `${count} products`} for “${words}”`,
    loading: 'Finding products',
    none: 'Nothing matches your search.',
    noneHint: 'Try fewer words or another spelling, or clear the filters.',
    seeAll: 'See all products',
    stocking: 'The shop is being stocked. Please come back soon.',
    beyond: 'There are no more products to show here.',
    firstPage: 'Back to the first page',
    pages: {
      label: 'Pages',
      previous: 'Previous page',
      next: 'Next page',
      at: (page: number, of: number) => `Page ${page} of ${of}`,
    },
    problems: {
      short: 'Type at least 2 characters to search.',
      long: 'Search with at most 100 characters.',
      price: 'Give a price in whole rupees, like 499.',
      range: 'The highest price is below the lowest.',
    },
  },
  // A category's page: its products, in the order staff chose.
  categoryPage: {
    // When staff gave the category no description: no claim, only facts.
    description: (name: string) =>
      `${name} at Herbal Commerce. Prices include GST, and delivery is free from ₹499.`,
    trail: 'You are here',
    empty: 'Nothing here yet. Please come back soon.',
    more: 'Show more',
    shown: (count: number) =>
      count === 1 ? '1 more product shown' : `${count} more products shown`,
    start: 'Back to the start',
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
