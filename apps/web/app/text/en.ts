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
