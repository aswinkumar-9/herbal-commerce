// Every word the website shows, in English (ADR 0039). Pages never write
// their own words: they take them from here, so other languages can come
// later as files like this one.
export const text = {
  shop: {
    // The shop's name until the owner confirms it.
    name: 'Herbal Commerce',
  },
  skipLink: 'Skip to content',
  // Read out while the next page is on its way.
  pageLoading: 'Loading the page',
  nav: {
    label: 'Main',
    phoneLabel: 'Main, on a phone',
    menu: 'Menu',
    home: 'Home',
    shop: 'Shop',
    signIn: 'Sign in',
    account: 'Account',
    cart: 'Cart',
    orders: 'Orders',
    // The menu's cart, read out with what it holds (part 14C).
    cartHolding: (packs: number) =>
      packs === 1 ? 'Cart, 1 pack' : `Cart, ${packs} packs`,
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
  // The cart (part 14C, ADR 0042): today's prices, and whether each line
  // can be bought now. Delivery and the order's total come at checkout.
  cart: {
    title: 'Your cart',
    description: 'The herbs in your Herbal Commerce cart.',
    empty: 'Your cart is empty.',
    emptyHint: 'Choose a pack size on any product page to add it here.',
    browse: 'See all products',
    lines: 'In your cart',
    each: (price: string) => `${price} each`,
    packs: (count: number) => (count === 1 ? '1 pack' : `${count} packs`),
    // What each line's buttons are read out as: their sign or word, then
    // which line.
    fewer: (which: string) => `One pack fewer, ${which}`,
    more: (which: string) => `One pack more, ${which}`,
    remove: 'Remove',
    removeFor: (which: string) => `Remove, ${which}`,
    removing: 'Removing',
    status: {
      OUT_OF_STOCK: 'Out of stock just now, so it is not counted below.',
      OFF_SALE:
        'No longer sold, so it is not counted below. You can remove it.',
    },
    summary: {
      heading: 'Summary',
      packs: (count: number) =>
        count === 1 ? '1 pack to order' : `${count} packs to order`,
      mrp: 'At MRP',
      save: 'You save',
      subtotal: 'Subtotal',
      delivery:
        'Delivery is free on orders of ₹499 or more, and ₹49 below that. Checkout adds it.',
      gst: 'Prices include GST.',
      checkout: 'Go to checkout',
      // While a line can't be bought: the API would refuse the order.
      fixFirst:
        'Remove the packs that can’t be bought now, and you can check out.',
    },
    saved: {
      packs: (which: string, packs: string) => `${which}: now ${packs}.`,
      removed: (which: string) => `Removed ${which}.`,
    },
    problems: {
      stock: 'That pack size is out of stock, so no more can be added.',
      full: 'That is the most for one product: 4 packs, all sizes together.',
      gone: 'That pack size is no longer sold. You can remove it.',
      resting:
        'We could not change your cart just now. Please try again in a minute.',
    },
  },
  // Checkout (part 14C, ADR 0042): where it goes, what it costs as the API
  // prices it, and placing the order.
  checkout: {
    title: 'Checkout',
    description: 'Choose where your order goes, and place it.',
    address: {
      title: 'Delivery address',
      add: 'Add an address',
      none: 'Add a delivery address, and your order can go there.',
      phone: (phone: string) => `Phone ${phone}`,
    },
    order: {
      title: 'Your order',
      packs: (count: number, price: string) =>
        count === 1 ? `1 pack at ${price}` : `${count} packs at ${price} each`,
      items: 'Items',
      delivery: 'Delivery',
      free: 'Free',
      total: 'Total',
      gst: (amount: string) =>
        `Prices include GST: ${amount} of the items is GST.`,
    },
    place: 'Place order',
    placing: 'Placing your order',
    hold: 'Placing it holds your packs for 15 minutes while you pay.',
    back: 'Back to your cart',
    // With 3 orders waiting for payment: where to pay or cancel one (14D).
    toOrders: 'See your orders',
    backToCheckout: 'Back to checkout',
    problems: {
      empty: 'Your cart is empty, so there is nothing to order.',
      unavailable:
        'Some packs in your cart can’t be ordered now. Change or remove them in your cart first.',
      changed:
        'The total has changed since this page opened. Please check the new total, then place your order again.',
      tooMany:
        'You have 3 orders waiting for payment. Pay for one or cancel it first, or wait: an order not paid within 15 minutes ends by itself.',
      stock:
        'Some packs ran out while you were here. Please change them in your cart.',
      address: 'That address is no longer saved. Please choose another.',
      resting:
        'We could not place your order just now. Please try again in a minute.',
    },
  },
  // The customer's orders, the newest first (part 14D).
  orders: {
    title: 'Your orders',
    description: 'Your Herbal Commerce orders.',
    intro: 'The newest first. Open one to see where it stands.',
    // What is in it at a glance: its first product, and how many others.
    what: (first: string, more: number) =>
      more === 0 ? first : `${first} and ${more} more`,
    // Said after it to a screen reader, so each link is told apart.
    which: (reference: string) => `, order ${reference}`,
    placed: (day: string) => `Placed on ${day}`,
    status: {
      PENDING_PAYMENT: 'Waiting for payment',
      HOLD_OVER: 'Time to pay is over',
      PAID: 'Paid',
      PACKED: 'Packed',
      SHIPPED: 'On its way',
      DELIVERED: 'Delivered',
      CANCELLED: 'Cancelled',
      EXPIRED: 'Not paid in time',
    },
    payBy: (time: string) => `Pay by ${time}`,
    empty: 'You have not placed an order yet.',
    emptyHint: 'Your orders show here once you place one.',
    shop: 'Go to the shop',
    more: 'Show more orders',
    shown: (count: number) =>
      count === 1 ? '1 more order shown.' : `${count} more orders shown.`,
    // A later page, opened as a page of its own.
    start: 'Back to your newest orders',
    noMore: 'There are no more orders to show.',
  },
  // One of the customer's orders (part 14C), with its history and
  // cancelling (part 14D).
  order: {
    title: (reference: string) => `Order ${reference}`,
    description: 'Your Herbal Commerce order.',
    reference: 'Quote this reference if you contact us.',
    allOrders: 'All your orders',
    status: {
      PENDING_PAYMENT: (until: string) =>
        `Waiting for payment. Your packs are held until ${until}.`,
      PAID: 'Paid. We will pack it next.',
      PACKED: 'Packed, and ready for the courier.',
      SHIPPED: 'On its way with the courier.',
      DELIVERED: 'Delivered.',
      CANCELLED: 'Cancelled.',
      EXPIRED:
        'Not paid in time, so it was not sent. Its packs went back on sale.',
    },
    items: 'What you ordered',
    deliverTo: 'Delivering to',
    // Its history, step by step (part 14D), and the courier once shipped.
    history: {
      heading: 'History',
      steps: {
        placed: 'Placed',
        paid: 'Paid',
        packed: 'Packed',
        shipped: 'Shipped',
        delivered: 'Delivered',
        cancelled: 'Cancelled',
        expired: 'Not paid in time',
      },
      notYet: 'Not yet',
      courier: 'Courier',
      tracking: 'Tracking number',
      trackingHint: 'Use it on the courier’s website to follow your parcel.',
      copy: 'Copy',
      copied: 'Copied',
      // The button read out, starting with the word it shows.
      copyFull: 'Copy tracking number',
      copiedFull: 'Copied tracking number',
      saidCopied: 'Tracking number copied.',
      notCopied: 'Could not copy it. Select the number to copy it yourself.',
    },
    // Cancelling, until it ships (part 14D): asked once more first.
    cancel: {
      heading: 'Cancel this order',
      intro: {
        waiting: 'Changed your mind? Cancel it, and its packs go back on sale.',
        paid: (amount: string) =>
          `You can cancel it until it ships. Your ${amount} then comes back to you in full.`,
      },
      ask: 'Cancel order',
      title: (reference: string) => `Cancel order ${reference}?`,
      body: {
        waiting: 'It will not be sent, and it can no longer be paid for.',
        paid: (amount: string) =>
          `It will not be sent, and your ${amount} goes back to you in full.`,
      },
      confirm: 'Yes, cancel it',
      cancelling: 'Cancelling',
      keep: 'Keep the order',
      done: 'Your order is cancelled.',
      problems: {
        late: 'This order can no longer be cancelled. It may have shipped a moment ago.',
        resting:
          'We could not cancel your order just now. Please try again in a minute.',
      },
    },
    // Paying on Razorpay's own page (ADR 0042).
    pay: {
      button: (amount: string) => `Pay ${amount}`,
      opening: 'Opening Razorpay',
      how: 'You pay on Razorpay’s page, then come back here.',
      over: 'The time to pay for this order is over, so its packs are going back on sale. You can order them again.',
      shop: 'Go to the shop',
      problems: {
        changed:
          'This order changed a moment ago. Refresh the page to see where it stands.',
        resting:
          'Payments are not available right now. Please try again in a minute.',
      },
    },
    // Back from Razorpay's page, when the order alone doesn't say what
    // happened.
    returned: {
      cancelled: 'You left Razorpay’s page before paying. You can pay below.',
      failed: 'The payment did not go through. You can try again below.',
      checking:
        'Razorpay has not confirmed your payment yet. Look at this page again in a minute, before paying again.',
      unverified:
        'We could not verify that payment. If it went through, this page will show it once Razorpay tells us.',
    },
    // A payment going back to the customer, always in full.
    refunds: {
      heading: 'Money going back',
      reason: {
        ORDER_EXPIRED:
          'Your payment came after the time to pay was over, when there was no longer enough stock.',
        ORDER_CANCELLED: 'Your payment came after the order was cancelled.',
        ALREADY_PAID:
          'This order was paid twice, so the second payment goes back.',
        CANCELLED_BY_CUSTOMER: 'You cancelled the order.',
        CANCELLED_BY_STAFF: 'We cancelled the order.',
      } as Record<string, string>,
      coming: (amount: string) => `${amount} is on its way back to you.`,
      back: (amount: string) => `${amount} is back with you.`,
      byHand: (amount: string) =>
        `${amount} could not be given back by itself. Our team has been told, and gives it back by hand.`,
    },
  },
  // Signing in (part 14B, ADR 0041). One answer for a wrong email or
  // password, as the API gives (ADR 0007).
  signIn: {
    title: 'Sign in',
    description: 'Sign in to your Herbal Commerce account.',
    intro: 'Welcome back. Sign in to see your account.',
    forPage: 'Sign in to see that page.',
    // Coming from "Add to cart" on a product page (part 14C).
    forCart: 'Sign in to add it to your cart. We will add it as you come back.',
    // After a session ended on purpose, said above the form.
    ended: {
      password:
        'Your password is changed, and you are signed out on every device. Sign in with the new password.',
      everywhere: 'You are signed out on every device.',
    },
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
    // The way to the customer's orders (part 14D).
    orders: {
      title: 'Your orders',
      intro: 'See where each order stands, and pay for one waiting.',
      see: 'See your orders',
    },
    details: {
      title: 'Your details',
      name: 'Your name',
      email: 'Email address',
      save: 'Save name',
      saving: 'Saving',
    },
    addresses: {
      title: 'Delivery addresses',
      intro: 'Keep up to 10. The default one comes first.',
      none: 'No delivery addresses saved yet.',
      isDefault: 'Default',
      phone: (phone: string) => `Phone ${phone}`,
      edit: 'Edit',
      makeDefault: 'Make default',
      // Read out, as there may be several alike.
      editFor: (who: string) => `Edit the address for ${who}`,
      makeDefaultFor: (who: string) => `Make default, the address for ${who}`,
      add: 'Add an address',
      full: 'You have 10 addresses, the most we keep. Remove one to add another.',
    },
    password: {
      title: 'Password',
      intro: 'Changing it signs you out on every device, this one too.',
      change: 'Change password',
    },
    signingOut: {
      title: 'Signing out',
      intro:
        'Sign out everywhere if you used a shared computer or lost a phone.',
      signOut: 'Sign out',
      signingOut: 'Signing out',
      everywhere: 'Sign out everywhere',
    },
    // What was just done, said at the top of the page.
    saved: {
      name: 'Your name is saved.',
      default: 'Your default address is changed.',
      added: 'The address is added.',
      address: 'The address is saved.',
      removed: 'The address is removed.',
    },
    problems: {
      name: 'We could not save your name just now. Please try again in a minute.',
      default:
        'We could not change your default address just now. Please try again in a minute.',
      gone: 'That address is no longer saved.',
      everywhere:
        'We could not sign you out everywhere just now. Please try again in a minute.',
    },
  },
  // Adding or changing a delivery address (part 14B), by the API's rules.
  address: {
    newTitle: 'Add an address',
    editTitle: 'Edit address',
    description: 'A delivery address in your Herbal Commerce account.',
    intro: 'Where we deliver, anywhere in India.',
    fullName: 'Full name',
    phone: 'Mobile number',
    phoneHint: '10 digits, for the courier.',
    line1: 'House number and street',
    line2: 'Area or landmark (optional)',
    city: 'City or town',
    state: 'State or union territory',
    chooseState: 'Choose one',
    pincode: 'PIN code',
    makeDefault: 'Make this my default address',
    firstIsDefault: 'Your first address is your default.',
    isDefault: 'This is your default address.',
    add: 'Add address',
    adding: 'Adding',
    save: 'Save address',
    saving: 'Saving',
    back: 'Back to your account',
    full: 'You have 10 addresses, the most we keep. Remove one to add another.',
    remove: {
      ask: 'Remove this address',
      title: 'Remove this address?',
      body: (name: string, line1: string) =>
        `The address for ${name}, ${line1}, will be removed.`,
      nextDefault: 'Your newest other address becomes the default.',
      confirm: 'Remove address',
      removing: 'Removing',
      keep: 'Keep it',
    },
    problems: {
      fullNameMissing: 'Enter the name of the person receiving it.',
      phoneWrong: 'Enter a 10 digit Indian mobile number.',
      line1Missing: 'Enter the house number and street.',
      cityMissing: 'Enter the city or town.',
      stateMissing: 'Choose a state or union territory.',
      pincodeWrong: 'Enter a 6 digit PIN code.',
      tooLong: (most: number) => `This has at most ${most} characters.`,
      resting:
        'We could not save the address just now. Please try again in a minute.',
      removing:
        'We could not remove the address just now. Please try again in a minute.',
    },
  },
  // Changing the password while signed in (part 14B). The API then ends
  // every session, this one too.
  changePassword: {
    title: 'Change your password',
    description: 'Change the password of your Herbal Commerce account.',
    intro:
      'Changing it signs you out on every device, this one too. Then sign in with the new password.',
    current: 'Current password',
    new: 'New password',
    submit: 'Change password',
    submitting: 'Changing',
    back: 'Back to your account',
    problems: {
      currentMissing: 'Enter your current password.',
      currentWrong: 'The current password is not right.',
      same: 'Choose a password different from the current one.',
      resting:
        'We could not change your password just now. Please try again in a minute.',
    },
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
    // Choosing a pack size and how many, for the cart (part 14C).
    add: {
      howMany: 'How many packs',
      submit: 'Add to cart',
      adding: 'Adding',
      noneInStock:
        'None of its pack sizes is in stock just now. Please come back soon.',
      added: (packs: string, pack: string) =>
        `Added ${packs} of ${pack} to your cart.`,
      seeCart: 'See your cart',
      problems: {
        full: (room: number) =>
          room === 0
            ? 'Your cart already holds 4 packs of this product, the most for one product.'
            : `Your cart already holds ${4 - room} of this product. You can add ${room} more: 4 at most, all sizes together.`,
        stock:
          'That pack size has just run out. Please choose another, or come back soon.',
        gone: 'That pack size is no longer sold. Please choose another.',
        resting: 'We could not add it just now. Please try again in a minute.',
        choose: 'Choose a pack size in stock, and how many packs.',
      },
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
