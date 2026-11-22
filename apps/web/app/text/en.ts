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
    signIn: 'Sign in',
    account: 'Account',
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
    policies: 'The shop’s policies',
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
  // What every account form says about its fields (part 14B). The API
  // checks them again; these say it beside the field first.
  forms: {
    email: 'Email address',
    showPassword: 'Show password',
    emailMissing: 'Enter your email address.',
    emailWrong: 'Enter an email address like name@example.com.',
    passwordMissing: 'Enter your password.',
    passwordLong: 'A password has at most 128 characters.',
    newPasswordMissing: 'Choose a password.',
    newPasswordShort: 'Choose a password with at least 10 characters.',
    newPasswordHint: 'At least 10 characters.',
    nameMissing: 'Enter your name.',
    nameLong: 'A name has at most 100 characters.',
    tooMany: (wait: string) =>
      `Too many tries. Please wait ${wait} and try again.`,
    minutes: (count: number) => (count === 1 ? '1 minute' : `${count} minutes`),
    seconds: (count: number) => (count === 1 ? '1 second' : `${count} seconds`),
  },
  // Signing in (part 14B, ADR 0041). One answer for a wrong email or
  // password, as the API gives (ADR 0007).
  signIn: {
    title: 'Sign in',
    description: 'Sign in to your Herbal Commerce account.',
    intro: 'Welcome back. Sign in to see your account.',
    forPage: 'Sign in to see that page.',
    password: 'Password',
    submit: 'Sign in',
    submitting: 'Signing in',
    forgot: 'Forgot your password?',
    newHere: 'New here?',
    createAccount: 'Create an account',
    sendAgain: 'Send the link again',
    problems: {
      wrong:
        'The email address or the password is not right. Please check them and try again.',
      unconfirmed:
        'Signed up recently? Confirm your email address first, with the link we sent you.',
      closed: 'This account is closed. To ask about it, see Contact us.',
      resting:
        'We could not sign you in just now. Please try again in a minute.',
    },
  },
  // Creating an account (part 14B). The answer is the same whether or not
  // the address has an account already, as the API's is (ADR 0007).
  signUp: {
    title: 'Create an account',
    description: 'Create your Herbal Commerce account.',
    intro:
      'It takes a minute. We will send you a link to confirm your email address.',
    name: 'Your name',
    password: 'Password',
    agree: {
      before: 'By creating an account, you agree to the ',
      between: ' and the ',
      after: '.',
    },
    submit: 'Create account',
    submitting: 'Creating your account',
    haveOne: 'Have an account already?',
    signIn: 'Sign in',
    sent: {
      title: 'Check your inbox',
      body: (email: string) =>
        `We have sent a message to ${email}. Open it to finish.`,
      lasts: 'The link in it lasts 24 hours.',
      nothing: 'Nothing after a few minutes? Look in your spam folder, or',
      sendAgain: 'send the link again',
    },
    problems: {
      resting:
        'We could not create your account just now. Please try again in a minute.',
    },
  },
  // Confirming the email address, from the link in the email (part 14B).
  // Opening the link only shows a button: a mail scanner that opens every
  // link can't use it up.
  verifyEmail: {
    title: 'Confirm your email address',
    description: 'Confirm the email address of your Herbal Commerce account.',
    intro: 'One more step: confirm that this email address is yours.',
    confirm: 'Confirm my email address',
    confirming: 'Confirming',
    confirmed: {
      title: 'Your email address is confirmed',
      body: 'Thank you. You can sign in now.',
      signIn: 'Sign in',
    },
    failed:
      'This link has expired or has been used already. A link lasts 24 hours and works once.',
    broken:
      'This link is not complete. Copy the whole link from the email, or ask for a new one below.',
    resend: {
      title: 'Send the link again',
      intro:
        'Enter the email address you signed up with, and we will send a new link to confirm it.',
      submit: 'Send the link',
      submitting: 'Sending',
      sent: (email: string) =>
        `If ${email} is waiting to be confirmed, we have sent it a new link. It lasts 24 hours.`,
    },
    problems: {
      resting: 'We could not do that just now. Please try again in a minute.',
    },
  },
  // Forgot password, and choosing a new one from the emailed link (part
  // 14B). The same answer whether or not the address has an account.
  forgotPassword: {
    title: 'Forgot your password?',
    description: 'Choose a new password for your Herbal Commerce account.',
    intro:
      'Enter the email address of your account, and we will send you a link to choose a new password.',
    submit: 'Send the link',
    submitting: 'Sending',
    sent: {
      title: 'Check your inbox',
      body: (email: string) =>
        `If ${email} has an account, we have sent it a link to choose a new password.`,
      lasts: 'The link lasts 30 minutes and works once.',
    },
    back: 'Back to sign in',
    problems: {
      resting:
        'We could not send the link just now. Please try again in a minute.',
    },
  },
  resetPassword: {
    title: 'Choose a new password',
    description: 'Choose a new password for your Herbal Commerce account.',
    intro:
      'Once it is saved, every device signed in to your account is signed out.',
    password: 'New password',
    submit: 'Save the new password',
    submitting: 'Saving',
    changed: {
      title: 'Your password is changed',
      body: 'Please sign in with your new password.',
      signIn: 'Sign in',
    },
    failed:
      'This link has expired or has been used already. A link lasts 30 minutes and works once.',
    broken:
      'This link is not complete. Copy the whole link from the email, or ask for a new one.',
    askAgain: 'Ask for a new link',
    problems: {
      resting:
        'We could not change your password just now. Please try again in a minute.',
    },
  },
  // The customer's own page (part 14B). More comes with the account's
  // details and addresses.
  account: {
    title: 'Your account',
    description: 'Your Herbal Commerce account.',
    signedInAs: 'Signed in as',
    signOut: 'Sign out',
    signingOut: 'Signing out',
  },
  // The policy pages (part 14B, ADR 0040). Their words are the Super
  // User's, from the console; these are only the names and the frame.
  policies: {
    pages: {
      privacy: {
        title: 'Privacy policy',
        description:
          'The privacy policy of Herbal Commerce: what personal details we keep, why, and for how long.',
      },
      terms: {
        title: 'Terms and conditions',
        description:
          'The terms for ordering from Herbal Commerce and for using its website.',
      },
      refunds: {
        title: 'Refunds and cancellations',
        description:
          'When an order from Herbal Commerce can be cancelled or returned, and how the money comes back.',
      },
      shipping: {
        title: 'Shipping and delivery',
        description:
          'Where Herbal Commerce delivers, what delivery costs, and how long it takes.',
      },
      contact: {
        title: 'Contact us',
        description: 'How to reach Herbal Commerce.',
      },
    },
    updated: 'Last updated',
    // Not published yet: said plainly, with a way on.
    pending: 'We are still writing this page.',
    pendingHint: 'Please come back soon.',
  },
  // A product's own page (part 14A). Buying comes with the cart (14C).
  productPage: {
    // When staff gave the product no summary: no claim, only facts.
    description: (name: string) =>
      `${name} at Herbal Commerce. Prices include GST, and delivery is free from ₹499.`,
    photos: 'Photos',
    showPhoto: (at: number, of: number) => `Show photo ${at} of ${of}`,
    packs: {
      heading: 'Pack sizes',
      mrp: (price: string) => `MRP ${price}`,
      save: (amount: string) => `You save ${amount}`,
      inStock: 'In stock',
      outOfStock: 'Out of stock',
      none: 'Not on sale yet. Please come back soon.',
      terms:
        'Prices include GST. Delivery is free on orders of ₹499 or more, and ₹49 below that.',
    },
    // A pack's net quantity, as its label gives it.
    units: {
      G: (n: string) => `${n} g`,
      KG: (n: string) => `${n} kg`,
      ML: (n: string) => `${n} ml`,
      L: (n: string) => `${n} L`,
      CAPSULES: (n: string) => (n === '1' ? '1 capsule' : `${n} capsules`),
      TABLETS: (n: string) => (n === '1' ? '1 tablet' : `${n} tablets`),
      PIECES: (n: string) => (n === '1' ? '1 piece' : `${n} pieces`),
    },
    about: 'About it',
    ingredients: 'Ingredients',
    usage: 'How to use it',
    label: {
      heading: 'Licence and maker',
      licence: {
        AYURVEDIC_MEDICINE: 'AYUSH licence',
        FOOD_OR_SUPPLEMENT: 'FSSAI licence',
        COSMETIC: 'Cosmetics licence',
      },
      maker: 'Made by',
      address: 'Maker’s address',
      origin: 'Country of origin',
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
