import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ALL_PRODUCTS,
  CATEGORIES,
  HAIR,
  OIL,
  PRODUCT,
  PRODUCTS_IN,
  SHAMPOO,
  SKIN,
  SOAP,
  categoriesOf,
  productsOf,
} from '../../test/catalog-fixtures';
import { heldBack, openSignedIn } from '../../test/console';
import { json } from '../../test/fake-api';

const ORDER = 'PUT /v1/staff/products/order';
const SEARCH = (words: string) => `GET /v1/staff/products?q=${words}&limit=100`;
const orderOf = (products: unknown[]) => () => json(200, { products });

async function openList(
  options: Parameters<typeof openSignedIn>[1] = {},
  path = '/catalog/products',
) {
  const console = openSignedIn(path, {
    ...options,
    answers: {
      [CATEGORIES]: categoriesOf([HAIR, SKIN]),
      [ALL_PRODUCTS]: productsOf([OIL, SHAMPOO, SOAP]),
      ...options.answers,
    },
  });
  await screen.findByRole('heading', { name: 'Products' });
  return console;
}

// The names in a list, top to bottom.
function namesIn(list: HTMLElement) {
  return within(list)
    .getAllByRole('listitem')
    .map((row) => within(row).getByRole('link').textContent);
}

async function rows() {
  return namesIn(await screen.findByRole('list', { name: 'Products' }));
}

async function orderedRows(category = HAIR) {
  return namesIn(
    await screen.findByRole('list', {
      name: `${category.name}, in the order customers see them`,
    }),
  );
}

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

describe('the products list', () => {
  it('opens from its tab, with every product, drafts too', async () => {
    const { user, router } = openSignedIn('/catalog/categories', {
      answers: {
        [CATEGORIES]: categoriesOf([HAIR, SKIN]),
        [ALL_PRODUCTS]: productsOf([OIL, SHAMPOO, SOAP]),
      },
    });
    await user.click(await screen.findByRole('link', { name: 'Products' }));

    expect(await rows()).toEqual([
      'Bhringraj Oil',
      'Amla Shampoo',
      'Neem Soap',
    ]);
    expect(router.state.location.pathname).toBe('/catalog/products');
    await waitFor(() =>
      expect(document.title).toBe('Products · Herbal Commerce Admin'),
    );
    const oil = screen
      .getByRole('link', { name: 'Bhringraj Oil' })
      .closest('li') as HTMLElement;
    expect(within(oil).getByText('Draft')).toBeInTheDocument();
    expect(
      within(oil).getByText('7 details to fill in before it can go live'),
    ).toBeInTheDocument();
    const shampoo = screen
      .getByRole('link', { name: 'Amla Shampoo' })
      .closest('li') as HTMLElement;
    expect(within(shampoo).getByText('Live')).toBeInTheDocument();
    expect(shampoo).toHaveTextContent('Hair Care · Cosmetic · /amla-shampoo');
    expect(within(shampoo).queryByText(/to fill in/)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Choose a category to change the order of its products.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Move / }),
    ).not.toBeInTheDocument();
  });

  it('counts a single missing detail as one', async () => {
    await openList({
      answers: {
        [ALL_PRODUCTS]: productsOf([
          { ...SHAMPOO, isActive: false, gstRate: null },
        ]),
      },
    });
    expect(
      await screen.findByText('1 detail to fill in before it can go live'),
    ).toBeInTheDocument();
  });

  it('finds products by name once typing pauses', async () => {
    const { api, router } = await openList({
      answers: { [SEARCH('neem+soap')]: productsOf([SOAP]) },
    });
    await rows();
    const box = screen.getByRole('searchbox', { name: 'Search by name' });

    // Typed at once (a slow computer can pause between keys).
    fireEvent.change(box, { target: { value: 'ne' } });
    fireEvent.change(box, { target: { value: '  neem   soap' } });
    // Nothing is sent while staff type.
    expect(router.state.location.search).toBe('');
    await pause(100);
    expect(router.state.location.search).toBe('');

    await waitFor(() =>
      expect(router.state.location.search).toBe('?q=neem+soap'),
    );
    // The last list stays until the matches are in.
    await waitFor(async () => expect(await rows()).toEqual(['Neem Soap']));
    expect(screen.getByText('The closest names first.')).toBeInTheDocument();
    // Only the last words were sent.
    expect(api.sent.filter((r) => r.path.includes('q='))).toHaveLength(1);
  });

  it('searches at once with Enter', async () => {
    const { user, router } = await openList({
      answers: { [SEARCH('neem')]: productsOf([SOAP]) },
    });
    await rows();

    await user.type(
      screen.getByRole('searchbox', { name: 'Search by name' }),
      'neem{Enter}',
    );

    await waitFor(() => expect(router.state.location.search).toBe('?q=neem'), {
      timeout: 150,
    });
  });

  it('waits for a second character before searching', async () => {
    const { user, api } = await openList();
    await rows();
    const box = screen.getByRole('searchbox', { name: 'Search by name' });

    await user.type(box, 'n');
    expect(box).toHaveAccessibleDescription('Type at least 2 characters.');
    await pause(400);

    expect(api.sent.filter((r) => r.path.includes('q='))).toHaveLength(0);
    expect(api.unexpected).toEqual([]);
  });

  it('says when nothing matches, and clears the filters', async () => {
    const { user, router } = await openList(
      {
        answers: {
          'GET /v1/staff/products?isActive=false&limit=100': productsOf([OIL]),
          'GET /v1/staff/products?isActive=false&q=zz&limit=100': productsOf(
            [],
          ),
        },
      },
      '/catalog/products?status=draft',
    );
    await rows();
    const box = screen.getByRole('searchbox', { name: 'Search by name' });

    await user.type(box, 'zz');
    expect(await screen.findByText('No products match')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear the filters' }));

    expect(await rows()).toEqual([
      'Bhringraj Oil',
      'Amla Shampoo',
      'Neem Soap',
    ]);
    expect(box).toHaveValue('');
    expect(router.state.location.search).toBe('');
  });

  it('invites the first product when there is none', async () => {
    await openList({ answers: { [ALL_PRODUCTS]: productsOf([]) } });

    expect(await screen.findByText('No products yet')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Add the first product' }),
    ).toHaveAttribute('href', '/catalog/products/new');
  });

  it('says when the list could not be loaded, and tries again', async () => {
    const { user } = await openList({
      answers: {
        [ALL_PRODUCTS]: [() => json(500), productsOf([OIL])],
      },
    });

    expect(
      await screen.findByText('The products could not be loaded'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await rows()).toEqual(['Bhringraj Oil']);
  });

  it('shows more, a page at a time', async () => {
    const { user } = await openList({
      answers: {
        [ALL_PRODUCTS]: productsOf([OIL, SHAMPOO], SHAMPOO.id),
        [`GET /v1/staff/products?after=${SHAMPOO.id}&limit=100`]: productsOf([
          SOAP,
        ]),
      },
    });
    expect(await rows()).toEqual(['Bhringraj Oil', 'Amla Shampoo']);

    await user.click(screen.getByRole('button', { name: 'Show more' }));

    await waitFor(async () =>
      expect(await rows()).toEqual([
        'Bhringraj Oil',
        'Amla Shampoo',
        'Neem Soap',
      ]),
    );
    expect(
      screen.queryByRole('button', { name: 'Show more' }),
    ).not.toBeInTheDocument();
  });

  it('says when the next page could not be loaded', async () => {
    const { user } = await openList({
      answers: {
        [ALL_PRODUCTS]: productsOf([OIL], OIL.id),
        [`GET /v1/staff/products?after=${OIL.id}&limit=100`]: () => json(500),
      },
    });
    await rows();

    await user.click(screen.getByRole('button', { name: 'Show more' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'More products could not be loaded. The server had a problem.',
    );
    expect(await rows()).toEqual(['Bhringraj Oil']);
  });

  it('filters by status', async () => {
    const { user, router } = await openList({
      answers: {
        'GET /v1/staff/products?isActive=true&limit=100': productsOf([
          SHAMPOO,
          SOAP,
        ]),
      },
    });
    await rows();

    await user.selectOptions(screen.getByLabelText('Status'), 'Live');

    await waitFor(async () =>
      expect(await rows()).toEqual(['Amla Shampoo', 'Neem Soap']),
    );
    expect(router.state.location.search).toBe('?status=live');
  });

  it('ignores a category in the address that is not an ID', async () => {
    const { api } = await openList({}, '/catalog/products?category=../x');

    expect(await rows()).toHaveLength(3);
    expect(screen.getByLabelText('Category')).toHaveValue('');
    expect(api.unexpected).toEqual([]);
  });
});

describe('ordering one category’s products', () => {
  it('offers the order once one category is chosen', async () => {
    const { user, router } = await openList({
      answers: { [PRODUCTS_IN(HAIR)]: productsOf([OIL, SHAMPOO]) },
    });
    await rows();

    await user.selectOptions(screen.getByLabelText('Category'), 'Hair Care');

    expect(await orderedRows()).toEqual(['Bhringraj Oil', 'Amla Shampoo']);
    expect(router.state.location.search).toBe(`?category=${HAIR.id}`);
    expect(
      screen.getByText(
        'Drag a handle to change the order customers see in Hair Care.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Move Amla Shampoo' }),
    ).toHaveAccessibleDescription(
      expect.stringContaining('press Up or Down to move a product one place'),
    );
    // A new product starts in the chosen category.
    expect(screen.getByRole('link', { name: 'New product' })).toHaveAttribute(
      'href',
      `/catalog/products/new?category=${HAIR.id}`,
    );
  });

  it('moves a product with the arrow keys, says where it went, and saves', async () => {
    const { user, api } = await openList(
      {
        answers: {
          [PRODUCTS_IN(HAIR)]: productsOf([OIL, SHAMPOO]),
          [ORDER]: orderOf([
            { ...SHAMPOO, position: 0 },
            { ...OIL, position: 1 },
          ]),
        },
      },
      `/catalog/products?category=${HAIR.id}`,
    );
    await orderedRows();

    screen.getByRole('button', { name: 'Move Bhringraj Oil' }).focus();
    await user.keyboard('{ArrowDown}');

    expect(await orderedRows()).toEqual(['Amla Shampoo', 'Bhringraj Oil']);
    expect(
      screen.getByText('Bhringraj Oil moved to position 2 of 2.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Order saved')).toBeInTheDocument();
    expect(api.to('PUT', '/v1/staff/products/order')[0]?.body).toEqual({
      categoryId: HAIR.id,
      ids: [SHAMPOO.id, OIL.id],
    });
    expect(await orderedRows()).toEqual(['Amla Shampoo', 'Bhringraj Oil']);
    await waitFor(
      () => expect(screen.queryByText('Order saved')).not.toBeInTheDocument(),
      { timeout: 4000 },
    );
  });

  it('goes back to the saved order when the products changed meanwhile', async () => {
    const { user } = await openList(
      {
        answers: {
          [PRODUCTS_IN(HAIR)]: [
            productsOf([OIL, SHAMPOO]),
            // Someone added a product meanwhile.
            productsOf([OIL, SHAMPOO, { ...SOAP, categoryId: HAIR.id }]),
          ],
          [ORDER]: () =>
            json(409, {
              message:
                'The products in this category changed while you were ordering them. Reload and try again.',
            }),
        },
      },
      `/catalog/products?category=${HAIR.id}`,
    );
    await orderedRows();

    screen.getByRole('button', { name: 'Move Amla Shampoo' }).focus();
    await user.keyboard('{Home}');

    expect(
      await screen.findByText(
        'The products in this category changed while you were ordering them. Reload and try again.',
      ),
    ).toBeInTheDocument();
    await waitFor(async () =>
      expect(await orderedRows()).toEqual([
        'Bhringraj Oil',
        'Amla Shampoo',
        'Neem Soap',
      ]),
    );
  });

  it('is not offered while searching', async () => {
    await openList(
      {
        answers: {
          [`GET /v1/staff/products?categoryId=${HAIR.id}&q=oil&limit=100`]:
            productsOf([OIL]),
        },
      },
      `/catalog/products?category=${HAIR.id}&q=oil`,
    );

    expect(await rows()).toEqual(['Bhringraj Oil']);
    expect(screen.getByText('The closest names first.')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Move / }),
    ).not.toBeInTheDocument();
  });

  it('is not offered with a status chosen', async () => {
    await openList(
      {
        answers: {
          [`GET /v1/staff/products?categoryId=${HAIR.id}&isActive=false&limit=100`]:
            productsOf([OIL]),
        },
      },
      `/catalog/products?category=${HAIR.id}&status=draft`,
    );

    expect(await rows()).toEqual(['Bhringraj Oil']);
    expect(
      screen.getByText('Choose “Live and drafts” to change the order.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Move / }),
    ).not.toBeInTheDocument();
  });

  it('is not offered on the last category’s list while the next one loads', async () => {
    const skin = heldBack();
    const { user } = await openList(
      {
        answers: {
          [PRODUCTS_IN(HAIR)]: productsOf([OIL, SHAMPOO]),
          [PRODUCTS_IN(SKIN)]: skin.answer,
        },
      },
      `/catalog/products?category=${HAIR.id}`,
    );
    await orderedRows();

    await user.selectOptions(screen.getByLabelText('Category'), 'Skin Care');

    // Hair Care's products stay while Skin Care's load, but can't be moved.
    expect(await rows()).toEqual(['Bhringraj Oil', 'Amla Shampoo']);
    expect(
      screen.queryByRole('button', { name: /^Move / }),
    ).not.toBeInTheDocument();
    await act(async () =>
      skin.release(json(200, { products: [SOAP], nextAfter: null })),
    );
    expect(await orderedRows(SKIN)).toEqual(['Neem Soap']);
  });

  it('is offered once every product of the category is shown', async () => {
    const { user } = await openList(
      {
        answers: {
          [PRODUCTS_IN(HAIR)]: productsOf([OIL], OIL.id),
          [`GET /v1/staff/products?categoryId=${HAIR.id}&after=${OIL.id}&limit=100`]:
            productsOf([SHAMPOO]),
        },
      },
      `/catalog/products?category=${HAIR.id}`,
    );

    expect(await rows()).toEqual(['Bhringraj Oil']);
    expect(
      screen.getByText('Show all of them to change their order.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show more' }));

    expect(await orderedRows()).toEqual(['Bhringraj Oil', 'Amla Shampoo']);
  });
});

describe('opening a product from the list', () => {
  it('goes back to the list as it was left', async () => {
    const { user, router } = await openList(
      {
        answers: {
          [PRODUCTS_IN(HAIR)]: productsOf([OIL, SHAMPOO]),
          [PRODUCT(OIL)]: () => json(200, OIL),
        },
      },
      `/catalog/products?category=${HAIR.id}`,
    );
    await orderedRows();

    await user.click(screen.getByRole('link', { name: 'Bhringraj Oil' }));
    expect(
      await screen.findByRole('heading', { name: 'Bhringraj Oil', level: 1 }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Products' }));

    expect(await orderedRows()).toEqual(['Bhringraj Oil', 'Amla Shampoo']);
    expect(router.state.location.search).toBe(`?category=${HAIR.id}`);
  });
});
