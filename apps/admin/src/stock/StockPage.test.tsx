import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ML_100, ML_200, ML_500, OIL, SHAMPOO } from '../test/catalog-fixtures';
import { heldBack, openSignedIn } from '../test/console';
import { json } from '../test/fake-api';
import { LINES, OUT, PLENTY, stockLine } from '../test/stock-fixtures';

const STOCK = 'GET /v1/staff/stock';
const pageOf =
  (lines: unknown[], nextAfter: string | null = null) =>
  () =>
    json(200, { lines, nextAfter });

// The draft oil's only pack size, with nothing in stock.
const OIL_LINE = {
  variant: {
    id: '9e0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b',
    sku: 'BHR-OIL-100',
    quantity: 100,
    unit: 'ML',
    isActive: true,
    lowStockAt: 10,
    position: 0,
  },
  product: { id: OIL.id, name: OIL.name, isActive: false },
  stock: OUT,
};
const ALL = [...LINES, OIL_LINE];

async function openStock(
  options: Parameters<typeof openSignedIn>[1] = {},
  path = '/stock',
) {
  const console = openSignedIn(path, {
    ...options,
    answers: { [STOCK]: pageOf(ALL), ...options.answers },
  });
  await screen.findByRole('heading', { name: 'Stock', level: 1 });
  return console;
}

// The products on the page, top to bottom.
async function products() {
  const list = await screen.findByRole('list', { name: 'Stock by product' });
  return within(list)
    .getAllByRole('heading', { level: 2 })
    .map((heading) => heading.textContent);
}

// One product's pack sizes, by name.
function packsOf(product: { name: string }) {
  return within(screen.getByRole('list', { name: product.name }))
    .getAllByRole('listitem')
    .map((row) => row.querySelector('a')?.firstChild?.textContent);
}

function row(product: { name: string }, pack: string) {
  const found = within(screen.getByRole('list', { name: product.name }))
    .getAllByRole('listitem')
    .find((item) => item.querySelector('a')?.firstChild?.textContent === pack);
  if (!found) {
    throw new Error(`No row ${pack}`);
  }
  return found;
}

const chip = (name: string) => screen.getByRole('button', { name });

describe('the Stock page', () => {
  it('opens from the menu, with every pack size by product, drafts and those off sale too', async () => {
    const { user } = openSignedIn('/', { answers: { [STOCK]: pageOf(ALL) } });
    const menu = await screen.findByRole('navigation', { name: 'Main' });
    await user.click(within(menu).getByRole('link', { name: 'Stock' }));

    expect(await products()).toEqual(['Amla Shampoo', 'Bhringraj Oil']);
    expect(document.title).toBe('Stock · Herbal Commerce Admin');
    expect(packsOf(SHAMPOO)).toEqual(['100 ml', '200 ml', '500 ml']);
    expect(row(SHAMPOO, '100 ml')).toHaveTextContent('AML-SHA-100');
    expect(row(SHAMPOO, '100 ml')).toHaveTextContent('In stock');
    expect(row(SHAMPOO, '200 ml')).toHaveTextContent('Low');
    expect(row(SHAMPOO, '500 ml')).toHaveTextContent('Out of stock');
    expect(row(SHAMPOO, '500 ml')).toHaveTextContent('Off sale');
    expect(row(SHAMPOO, '100 ml')).not.toHaveTextContent('Off sale');
    // The draft says so beside its name; the live product does not.
    const oil = screen.getByRole('heading', { name: OIL.name });
    expect(oil.parentElement).toHaveTextContent('Draft');
    const shampoo = screen.getByRole('heading', { name: SHAMPOO.name });
    expect(shampoo.parentElement).not.toHaveTextContent('Draft');
    expect(chip('All')).toHaveAttribute('aria-pressed', 'true');
  });

  it('says what the packs are doing, and when a batch stops selling', async () => {
    const NEAR = stockLine(ML_500, { ...OUT, free: 9, awaitingPacking: 1 });
    await openStock({ answers: { [STOCK]: pageOf([...LINES, NEAR]) } });
    await products();

    expect(row(SHAMPOO, '100 ml')).toHaveTextContent(
      '40 packs may be sold · 2 packs for orders to pack · 1 pack packed for shipping',
    );
    expect(row(SHAMPOO, '100 ml')).toHaveTextContent(
      'A batch stops selling on 1 Apr 2028',
    );
    expect(row(SHAMPOO, '100 ml')).not.toHaveTextContent('within 30 days');
    expect(row(SHAMPOO, '200 ml')).toHaveTextContent('4 packs may be sold');
    expect(row(SHAMPOO, '200 ml')).toHaveTextContent(
      'A batch stops selling on 1 Dec 2026, within 30 days',
    );
    const [out, near] = within(
      screen.getByRole('list', { name: SHAMPOO.name }),
    ).getAllByText(/^0 packs may be sold/);
    expect(out).toHaveTextContent(/^0 packs may be sold$/);
    expect(out?.closest('li')).not.toHaveTextContent('stops selling');
    expect(near).toHaveTextContent(
      '0 packs may be sold · 9 packs too near expiry to sell · 1 pack for orders to pack',
    );
  });

  it('opens a product’s page from its name', async () => {
    await openStock();
    await products();

    expect(
      screen.getByRole('link', { name: 'Open product: Amla Shampoo' }),
    ).toHaveAttribute('href', `/catalog/products/${SHAMPOO.id}`);
  });

  it('filters: out of stock, low or out, expiring soon, and back to all', async () => {
    const { user, api, router } = await openStock({
      answers: {
        [`${STOCK}?status=low`]: pageOf([LINES[1], LINES[2], OIL_LINE]),
        [`${STOCK}?status=expiring`]: pageOf([LINES[1]]),
      },
    });
    await products();

    await user.click(chip('Low or out'));
    await waitFor(() => expect(packsOf(SHAMPOO)).toEqual(['200 ml', '500 ml']));
    expect(chip('Low or out')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('All')).toHaveAttribute('aria-pressed', 'false');
    expect(router.state.location.search).toBe('?status=low');

    await user.click(chip('Expiring soon'));
    await waitFor(() => expect(packsOf(SHAMPOO)).toEqual(['200 ml']));
    expect(await products()).toEqual(['Amla Shampoo']);

    await user.click(chip('All'));
    await waitFor(() =>
      expect(packsOf(SHAMPOO)).toEqual(['100 ml', '200 ml', '500 ml']),
    );
    expect(router.state.location.search).toBe('');
    expect(api.unexpected).toEqual([]);
  });

  it('finds pack sizes by product name or SKU once typing pauses', async () => {
    const { user, api, router } = await openStock({
      answers: { [`${STOCK}?q=sha-200`]: pageOf([LINES[1]]) },
    });
    await products();

    await user.type(
      screen.getByRole('searchbox', { name: 'Search by product or SKU' }),
      ' sha-200 ',
    );

    await waitFor(() => expect(packsOf(SHAMPOO)).toEqual(['200 ml']));
    expect(router.state.location.search).toBe('?q=sha-200');
    expect(api.unexpected).toEqual([]);
  });

  it('comes back as the address says', async () => {
    await openStock(
      {
        answers: {
          [`${STOCK}?status=expiring&q=amla`]: pageOf([LINES[1]]),
        },
      },
      '/stock?status=expiring&q=amla',
    );

    expect(await products()).toEqual(['Amla Shampoo']);
    expect(chip('Expiring soon')).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('searchbox', { name: 'Search by product or SKU' }),
    ).toHaveValue('amla');
  });

  it('ignores a filter in the address that it does not know', async () => {
    const { api } = await openStock({}, '/stock?status=soon');

    expect(await products()).toEqual(['Amla Shampoo', 'Bhringraj Oil']);
    expect(chip('All')).toHaveAttribute('aria-pressed', 'true');
    expect(api.to('GET', '/v1/staff/stock')).toHaveLength(1);
  });
});

describe('an empty Stock page', () => {
  it('invites the first pack size when there is none', async () => {
    await openStock({ answers: { [STOCK]: pageOf([]) } });

    expect(await screen.findByText('No pack sizes yet')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Go to the products' }),
    ).toHaveAttribute('href', '/catalog/products');
  });

  it.each([
    ['Out of stock', 'out', 'Nothing is out of stock'],
    ['Low or out', 'low', 'Nothing is low'],
    ['Expiring soon', 'expiring', 'Nothing stops selling soon'],
  ])(
    'says when nothing is %s, and shows all again',
    async (name, status, title) => {
      const { user, router } = await openStock({
        answers: { [`${STOCK}?status=${status}`]: pageOf([]) },
      });
      await products();

      await user.click(chip(name));
      expect(await screen.findByText(title)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Show all' }));

      expect(await products()).toEqual(['Amla Shampoo', 'Bhringraj Oil']);
      expect(router.state.location.search).toBe('');
    },
  );

  it('says when nothing matches the words, and clears the filters', async () => {
    const { user, router } = await openStock(
      { answers: { [`${STOCK}?status=low&q=tulsi`]: pageOf([]) } },
      '/stock?status=low&q=tulsi',
    );

    expect(await screen.findByText('No pack sizes match')).toBeInTheDocument();
    expect(
      screen.getByText(
        'No product name or SKU has these words in what you chose.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear the filters' }));

    expect(await products()).toEqual(['Amla Shampoo', 'Bhringraj Oil']);
    expect(router.state.location.search).toBe('');
    expect(
      screen.getByRole('searchbox', { name: 'Search by product or SKU' }),
    ).toHaveValue('');
  });
});

describe('loading the Stock page', () => {
  it('says when it could not be loaded, and tries again', async () => {
    const { user } = await openStock({
      answers: {
        [STOCK]: [
          () => json(500, { message: 'Internal server error' }),
          pageOf(ALL),
        ],
      },
    });

    expect(
      await screen.findByText('The stock could not be loaded'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await products()).toEqual(['Amla Shampoo', 'Bhringraj Oil']);
  });

  it('shows more a page at a time, keeping one product’s pack sizes together', async () => {
    const next = heldBack();
    const { user } = await openStock({
      answers: {
        [STOCK]: pageOf([LINES[0], LINES[1]], ML_200.id),
        [`${STOCK}?after=${ML_200.id}`]: next.answer,
      },
    });
    expect(await products()).toEqual(['Amla Shampoo']);

    await user.click(screen.getByRole('button', { name: 'Show more' }));
    next.release(json(200, { lines: [LINES[2], OIL_LINE], nextAfter: null }));

    await waitFor(async () =>
      expect(await products()).toEqual(['Amla Shampoo', 'Bhringraj Oil']),
    );
    expect(packsOf(SHAMPOO)).toEqual(['100 ml', '200 ml', '500 ml']);
    expect(
      screen.queryByRole('button', { name: 'Show more' }),
    ).not.toBeInTheDocument();
  });

  it('says when the next page could not be loaded', async () => {
    const { user } = await openStock({
      answers: {
        [STOCK]: pageOf([stockLine(ML_100, PLENTY)], ML_100.id),
        [`${STOCK}?after=${ML_100.id}`]: () =>
          json(500, { message: 'Internal server error' }),
      },
    });
    await products();

    await user.click(screen.getByRole('button', { name: 'Show more' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'More pack sizes could not be loaded.',
    );
    expect(packsOf(SHAMPOO)).toEqual(['100 ml']);
  });
});
