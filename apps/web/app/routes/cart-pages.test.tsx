import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { AddOutcome, Cart } from '../cart.server.ts';
import type { Product } from '../catalog.server.ts';
import { renderPage } from '../test/render.tsx';
import CartPage from './cart.tsx';
import ProductPage from './product.tsx';

// The product page's "Add to cart" and the cart page, as they are drawn and
// read out (part 14C, ADR 0042).
const MEDIA = 'http://127.0.0.1:3000/media/products';
const PRODUCT: Product = {
  name: 'Ashwagandha Capsules',
  slug: 'ashwagandha-capsules',
  summary: null,
  description: null,
  ingredients: 'Ashwagandha root extract',
  usage: null,
  type: 'AYURVEDIC_MEDICINE',
  licenceNumber: '25D/123/2015',
  manufacturerName: 'Herbal Works',
  manufacturerAddress: 'Mysuru',
  countryOfOrigin: 'India',
  category: { name: 'Wellness', slug: 'wellness', parent: null },
  brand: null,
  variants: [
    {
      sku: 'ASH-CAP-30',
      quantity: 30,
      unit: 'CAPSULES',
      mrpRupees: 280,
      priceRupees: 280,
      inStock: false,
    },
    {
      sku: 'ASH-CAP-60',
      quantity: 60,
      unit: 'CAPSULES',
      mrpRupees: 500,
      priceRupees: 449,
      inStock: true,
    },
    {
      sku: 'ASH-CAP-120',
      quantity: 120,
      unit: 'CAPSULES',
      mrpRupees: 900,
      priceRupees: 799,
      inStock: true,
    },
  ],
  images: [],
};

function openProduct({
  product = PRODUCT,
  returned = null,
  answer = null,
}: {
  product?: Product;
  returned?: AddOutcome | null;
  answer?: AddOutcome | null;
} = {}) {
  const sentForms: FormData[] = [];
  renderPage({
    path: '/products/:slug',
    url: `/products/${product.slug}`,
    Component: ProductPage as never,
    loader: () => ({
      product,
      photo: 0,
      origin: 'https://shop.example.com',
      returned,
    }),
    action: async ({ request }) => {
      sentForms.push(await request.formData());
      return answer;
    },
  });
  return { sentForms, user: userEvent.setup() };
}

const choice = (name: RegExp) => screen.getByRole('radio', { name });

describe('adding to the cart on a product page', () => {
  it('offers each pack size as a choice with its price; one out of stock can’t be chosen; the first in stock is', async () => {
    openProduct();
    await screen.findByRole('heading', { level: 1 });
    const sizes = screen.getByRole('group', { name: 'Pack sizes' });
    expect(within(sizes).getAllByRole('radio')).toHaveLength(3);
    expect(choice(/^30 capsules/)).toBeDisabled();
    expect(choice(/^60 capsules$/)).toBeChecked();
    expect(choice(/^60 capsules$/)).toHaveAccessibleDescription(
      /₹449.*MRP ₹500.*You save ₹51.*In stock/,
    );
    expect(choice(/^30 capsules$/)).toHaveAccessibleDescription(/Out of stock/);
    expect(choice(/^120 capsules/)).not.toBeChecked();
    expect(
      screen.getByRole('combobox', { name: 'How many packs' }),
    ).toHaveDisplayValue('1');
    expect(
      within(screen.getByRole('combobox', { name: 'How many packs' }))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['1', '2', '3', '4']);
  });

  it('sends the size and how many with one button', async () => {
    const { sentForms, user } = openProduct();
    await screen.findByRole('heading', { level: 1 });
    await user.click(choice(/^120 capsules/));
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'How many packs' }),
      '2',
    );
    await user.click(screen.getByRole('button', { name: 'Add to cart' }));
    await waitFor(() => expect(sentForms).toHaveLength(1));
    expect(Object.fromEntries(sentForms[0] ?? [])).toEqual({
      intent: 'add',
      sku: 'ASH-CAP-120',
      packs: '2',
    });
  });

  it('says what went in, with the way to the cart, and the keyboard goes there', async () => {
    const { user } = openProduct({
      answer: {
        added: { sku: 'ASH-CAP-60', packs: 2 },
        notAdded: null,
        room: 0,
        choice: { sku: 'ASH-CAP-60', packs: 2 },
      },
    });
    await screen.findByRole('heading', { level: 1 });
    await user.click(screen.getByRole('button', { name: 'Add to cart' }));
    const said = await screen.findByRole('status');
    expect(said).toHaveTextContent(
      'Added 2 packs of 60 capsules to your cart.',
    );
    await waitFor(() => expect(said).toHaveFocus());
    expect(screen.getByRole('link', { name: 'See your cart' })).toHaveAttribute(
      'href',
      '/cart',
    );
  });

  it('says why not, keeps the choice, and the keyboard goes there', async () => {
    openProduct({
      returned: {
        added: null,
        notAdded: 'full',
        room: 1,
        choice: { sku: 'ASH-CAP-120', packs: 2 },
      },
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Your cart already holds 3 of this product. You can add 1 more: 4 at most, all sizes together.',
    );
    await waitFor(() => expect(alert).toHaveFocus());
    expect(choice(/^120 capsules/)).toBeChecked();
    expect(
      screen.getByRole('combobox', { name: 'How many packs' }),
    ).toHaveDisplayValue('2');
  });

  it('back from signing in, says it went in', async () => {
    openProduct({
      returned: {
        added: { sku: 'ASH-CAP-60', packs: 1 },
        notAdded: null,
        room: 0,
        choice: { sku: 'ASH-CAP-60', packs: 1 },
      },
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Added 1 pack of 60 capsules to your cart.',
    );
  });

  it('with nothing in stock, offers no button, and says so', async () => {
    openProduct({
      product: {
        ...PRODUCT,
        variants: PRODUCT.variants.map((pack) => ({ ...pack, inStock: false })),
      },
    });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('button', { name: 'Add to cart' })).toBeNull();
    expect(
      screen.getByText(
        'None of its pack sizes is in stock just now. Please come back soon.',
      ),
    ).toBeInTheDocument();
  });
});

const line = (
  sku: string,
  quantity: number,
  packs: number,
  status: Cart['items'][number]['status'] = 'AVAILABLE',
) => ({
  product: {
    name: 'Ashwagandha Capsules',
    slug: 'ashwagandha-capsules',
    imageUrl: `${MEDIA}/a-small.webp`,
  },
  sku,
  quantity,
  unit: 'CAPSULES' as const,
  mrpRupees: 500,
  priceRupees: 449,
  packs,
  lineTotalRupees: 449 * packs,
  status,
});

function openCart(items: Cart['items'], answer: unknown = null) {
  const available = items.filter((item) => item.status === 'AVAILABLE');
  const cart: Cart = {
    items,
    packs: available.reduce((sum, item) => sum + item.packs, 0),
    subtotalRupees: available.reduce(
      (sum, item) => sum + item.lineTotalRupees,
      0,
    ),
    mrpTotalRupees: available.reduce((sum, item) => sum + 500 * item.packs, 0),
  };
  const sentForms: FormData[] = [];
  renderPage({
    path: '/cart',
    Component: CartPage as never,
    loader: () => ({ cart, origin: 'https://shop.example.com' }),
    action: async ({ request }) => {
      sentForms.push(await request.formData());
      return answer;
    },
  });
  return { sentForms, user: userEvent.setup() };
}

const SIXTY = 'Ashwagandha Capsules, 60 capsules';
const ONE_TWENTY = 'Ashwagandha Capsules, 120 capsules';

describe('the cart page', () => {
  it('when empty, says so, with the way to the shop', async () => {
    openCart([]);
    expect(await screen.findByText('Your cart is empty.')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'See all products' }),
    ).toHaveAttribute('href', '/shop');
  });

  it('shows each line, its price and packs, with buttons named for their line', async () => {
    openCart([line('ASH-CAP-60', 60, 1), line('ASH-CAP-120', 120, 2)]);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your cart' }),
    ).toBeInTheDocument();
    const lines = screen.getAllByRole('listitem');
    expect(lines).toHaveLength(2);
    expect(
      within(lines[0] as HTMLElement).getByRole('link', {
        name: 'Ashwagandha Capsules',
      }),
    ).toHaveAttribute('href', '/products/ashwagandha-capsules');
    expect(lines[0]).toHaveTextContent('60 capsules');
    expect(lines[0]).toHaveTextContent('₹449 each');
    expect(lines[0]).toHaveTextContent('1 pack');
    // One pack is the fewest: then it is Remove.
    expect(
      screen.getByRole('button', { name: `One pack fewer, ${SIXTY}` }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: `One pack fewer, ${ONE_TWENTY}` }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: `Remove, ${SIXTY}` }),
    ).toBeEnabled();
  });

  it('allows no more than 4 packs of one product, all its sizes together', async () => {
    openCart([line('ASH-CAP-60', 60, 1), line('ASH-CAP-120', 120, 3)]);
    await screen.findByRole('heading', { level: 1 });
    expect(
      screen.getByRole('button', { name: `One pack more, ${SIXTY}` }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: `One pack more, ${ONE_TWENTY}` }),
    ).toBeDisabled();
  });

  it('says plainly when a line can’t be bought now, and counts only what can', async () => {
    openCart([
      line('ASH-CAP-60', 60, 2),
      line('ASH-CAP-120', 120, 1, 'OUT_OF_STOCK'),
    ]);
    await screen.findByRole('heading', { level: 1 });
    expect(
      screen.getByText('Out of stock just now, so it is not counted below.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: `One pack more, ${ONE_TWENTY}` }),
    ).toBeDisabled();
    const summary = screen.getByRole('region', { name: 'Summary' });
    expect(summary).toHaveTextContent('2 packs to order');
    expect(summary).toHaveTextContent('At MRP₹1,000');
    expect(summary).toHaveTextContent('You save₹102');
    expect(summary).toHaveTextContent('Subtotal₹898');
    expect(summary).toHaveTextContent(
      'Delivery is free on orders of ₹499 or more, and ₹49 below that. Checkout adds it.',
    );
  });

  it('one more sends the line’s new number of packs', async () => {
    const { sentForms, user } = openCart([line('ASH-CAP-60', 60, 1)]);
    await screen.findByRole('heading', { level: 1 });
    await user.click(
      screen.getByRole('button', { name: `One pack more, ${SIXTY}` }),
    );
    await waitFor(() => expect(sentForms).toHaveLength(1));
    expect(Object.fromEntries(sentForms[0] ?? [])).toEqual({
      intent: 'packs',
      sku: 'ASH-CAP-60',
      packs: '2',
    });
  });

  it('says what was done, and the keyboard goes there', async () => {
    const { user } = openCart([line('ASH-CAP-60', 60, 1)], {
      sku: 'ASH-CAP-60',
      name: SIXTY,
      done: 'removed',
      packs: null,
      problem: null,
    });
    await screen.findByRole('heading', { level: 1 });
    await user.click(screen.getByRole('button', { name: `Remove, ${SIXTY}` }));
    const said = await screen.findByRole('status');
    expect(said).toHaveTextContent(`Removed ${SIXTY}.`);
    await waitFor(() => expect(said).toHaveFocus());
  });

  it('says why a change was refused, and the keyboard goes there', async () => {
    const { user } = openCart([line('ASH-CAP-60', 60, 1)], {
      sku: 'ASH-CAP-60',
      name: null,
      done: null,
      packs: null,
      problem: 'stock',
    });
    await screen.findByRole('heading', { level: 1 });
    await user.click(
      screen.getByRole('button', { name: `One pack more, ${SIXTY}` }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'That pack size is out of stock, so no more can be added.',
    );
    await waitFor(() => expect(alert).toHaveFocus());
  });
});
