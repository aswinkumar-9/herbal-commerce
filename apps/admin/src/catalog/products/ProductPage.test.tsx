import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ALL_PRODUCTS,
  CATEGORIES,
  HAIR,
  OIL,
  PATCH_PRODUCT,
  PRODUCT,
  PRODUCTS_IN,
  SHAMPOO,
  SKIN,
  SOAP,
  categoriesOf,
  fieldsRefused,
  productsOf,
} from '../../test/catalog-fixtures';
import { heldBack, openSignedIn } from '../../test/console';
import { RAVI, json } from '../../test/fake-api';

const CREATE = 'POST /v1/staff/products';
const NEEDED = 'Needed before the product can go live';
const NEEDS_CHANGES = 'Some details need changing: see the marked fields.';

async function openProduct(
  product: { id: string; name: string } = OIL,
  options: Parameters<typeof openSignedIn>[1] = {},
) {
  const console = openSignedIn(`/catalog/products/${product.id}`, {
    ...options,
    answers: {
      [CATEGORIES]: categoriesOf([HAIR, SKIN]),
      [PRODUCT(product)]: () => json(200, product),
      ...options.answers,
    },
  });
  await screen.findByRole('heading', { name: product.name, level: 1 });
  await screen.findByLabelText('Name');
  return console;
}

async function openNew(
  options: Parameters<typeof openSignedIn>[1] = {},
  path = '/catalog/products/new',
) {
  const console = openSignedIn(path, {
    ...options,
    answers: {
      [CATEGORIES]: categoriesOf([HAIR, SKIN]),
      ...options.answers,
    },
  });
  await screen.findByRole('heading', { name: 'New product' });
  await screen.findByLabelText('Name');
  return console;
}

const saveButton = () => screen.getByRole('button', { name: 'Save changes' });
const liveSwitch = () =>
  screen.getByRole('switch', { name: 'Customers see it' });

describe('a new product', () => {
  it('is added as a draft, after the last product of its category', async () => {
    const NEW = {
      ...OIL,
      id: '6f7a8b9c-0d1e-4f2a-9b3c-4d5e6f7a8b9c',
      name: 'Neem Hair Oil',
      slug: 'neem-hair-oil',
      type: 'AYURVEDIC_MEDICINE',
      licenceNumber: '25D/123',
      position: 2,
    };
    const { user, api, router } = await openNew({
      answers: {
        [PRODUCTS_IN(HAIR)]: productsOf([OIL, SHAMPOO]),
        [CREATE]: () => json(201, NEW),
        [PRODUCT(NEW)]: () => json(200, NEW),
      },
    });
    await waitFor(() =>
      expect(document.title).toBe('New product · Herbal Commerce Admin'),
    );
    expect(
      screen.getByText(/A new product starts as a draft/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Name'), '  Neem Hair Oil ');
    expect(screen.getByLabelText('Slug')).toHaveAccessibleDescription(
      'Leave empty to use “neem-hair-oil”.',
    );
    await user.selectOptions(screen.getByLabelText('Category'), 'Hair Care');
    await user.selectOptions(
      screen.getByLabelText('Type'),
      'Ayurvedic medicine',
    );
    expect(screen.getByLabelText('Licence number')).toHaveAccessibleDescription(
      'The AYUSH licence, as printed on the pack.',
    );
    await user.type(screen.getByLabelText('Licence number'), ' 25d / 123 ');
    await user.click(screen.getByRole('button', { name: 'Add product' }));

    expect(await screen.findByText('Neem Hair Oil added')).toBeInTheDocument();
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/catalog/products/${NEW.id}`,
      ),
    );
    expect(
      await screen.findByRole('heading', { name: 'Neem Hair Oil', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    // Leaving after the save is not held up.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.to('POST', '/v1/staff/products')[0]?.body).toEqual({
      categoryId: HAIR.id,
      name: 'Neem Hair Oil',
      summary: null,
      description: null,
      usage: null,
      type: 'AYURVEDIC_MEDICINE',
      licenceNumber: '25D/123',
      manufacturerName: null,
      manufacturerAddress: null,
      countryOfOrigin: 'India',
      ingredients: null,
      hsnCode: null,
      gstRate: null,
      position: 2,
    });
  });

  it('starts in the category the list had chosen', async () => {
    await openNew({}, `/catalog/products/new?category=${SKIN.id}`);

    expect(screen.getByLabelText('Category')).toHaveValue(SKIN.id);
    expect(
      screen.getByRole('option', { name: 'Skin Care (hidden)' }),
    ).toBeInTheDocument();
  });

  it('is checked before it is sent', async () => {
    const { user, api } = await openNew();

    await user.click(screen.getByRole('button', { name: 'Add product' }));

    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription(
      'Enter a name',
    );
    expect(screen.getByLabelText('Name')).toHaveFocus();
    expect(screen.getByLabelText('Category')).toHaveAccessibleDescription(
      'Choose a category',
    );
    expect(screen.getByRole('alert')).toHaveTextContent(NEEDS_CHANGES);

    await user.type(screen.getByLabelText('Name'), 'Moringa Powder');
    expect(screen.getByLabelText('Name')).not.toHaveAccessibleDescription();
    await user.selectOptions(screen.getByLabelText('Category'), 'Hair Care');
    await user.selectOptions(
      screen.getByLabelText('Type'),
      'Food or supplement',
    );
    await user.type(screen.getByLabelText('Licence number'), '1234');
    await user.type(screen.getByLabelText('HSN code'), '12');
    await user.clear(screen.getByLabelText('Country of origin'));
    await user.click(screen.getByRole('button', { name: 'Add product' }));

    expect(screen.getByLabelText('Licence number')).toHaveAccessibleDescription(
      'The FSSAI licence: 14 digits. An FSSAI licence number has exactly 14 digits',
    );
    expect(screen.getByLabelText('Licence number')).toHaveFocus();
    expect(screen.getByLabelText('HSN code')).toHaveAccessibleDescription(
      expect.stringContaining('An HSN code has 4, 6 or 8 digits'),
    );
    expect(
      screen.getByLabelText('Country of origin'),
    ).toHaveAccessibleDescription('Enter the country of origin');
    expect(api.to('POST', '/v1/staff/products')).toHaveLength(0);
  });

  it('clears a licence mark when the type changes', async () => {
    const { user } = await openNew();

    await user.selectOptions(
      screen.getByLabelText('Type'),
      'Food or supplement',
    );
    await user.type(screen.getByLabelText('Licence number'), '1234');
    await user.click(screen.getByRole('button', { name: 'Add product' }));
    expect(screen.getByLabelText('Licence number')).toHaveAccessibleDescription(
      expect.stringContaining('An FSSAI licence number has exactly 14 digits'),
    );
    await user.selectOptions(screen.getByLabelText('Type'), 'Cosmetic');

    expect(screen.getByLabelText('Licence number')).toHaveAccessibleDescription(
      'The cosmetics licence, as printed on the pack.',
    );
  });

  it('ignores a category in the address that is not in the list', async () => {
    const { user, api } = await openNew(
      {},
      '/catalog/products/new?category=0b8f3a52-0000-4c7a-9f2b-3e4d5c6b7a81',
    );

    await user.type(screen.getByLabelText('Name'), 'Moringa Powder');
    await user.click(screen.getByRole('button', { name: 'Add product' }));

    expect(screen.getByLabelText('Category')).toHaveAccessibleDescription(
      'Choose a category',
    );
    expect(api.to('POST', '/v1/staff/products')).toHaveLength(0);
  });

  it('asks for a category first when there is none', async () => {
    openSignedIn('/catalog/products/new', {
      answers: { [CATEGORIES]: categoriesOf([]) },
    });

    expect(await screen.findByText('Add a category first')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Go to categories' }),
    ).toHaveAttribute('href', '/catalog/categories');
  });
});

describe('changing a product', () => {
  it('shows the product, and sends only what changed', async () => {
    const { user, api } = await openProduct(OIL, {
      answers: {
        [PATCH_PRODUCT(OIL)]: () =>
          json(200, { ...OIL, summary: 'Cold-pressed bhringraj oil' }),
      },
    });
    await waitFor(() =>
      expect(document.title).toBe('Bhringraj Oil · Herbal Commerce Admin'),
    );
    expect(screen.getByLabelText('Name')).toHaveValue('Bhringraj Oil');
    expect(screen.getByLabelText('Slug')).toHaveAccessibleDescription(
      "Part of the product's web address.",
    );
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();

    await user.type(
      screen.getByLabelText('Summary'),
      'Cold-pressed bhringraj oil',
    );
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await user.click(saveButton());

    expect(await screen.findByText('Bhringraj Oil saved')).toBeInTheDocument();
    expect(api.to('PATCH', `/v1/staff/products/${OIL.id}`)[0]?.body).toEqual({
      summary: 'Cold-pressed bhringraj oil',
    });
    await waitFor(() =>
      expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Summary')).toHaveValue(
      'Cold-pressed bhringraj oil',
    );
  });

  it('sends nothing when nothing changed', async () => {
    const { user, api } = await openProduct();

    await user.click(saveButton());

    expect(
      await screen.findByText('There are no changes to save.'),
    ).toBeInTheDocument();
    expect(api.to('PATCH', `/v1/staff/products/${OIL.id}`)).toHaveLength(0);
  });

  it('puts a product moved to another category after its last one', async () => {
    const { user, api } = await openProduct(OIL, {
      answers: {
        [PRODUCTS_IN(SKIN)]: productsOf([SOAP]),
        [PATCH_PRODUCT(OIL)]: () =>
          json(200, { ...OIL, categoryId: SKIN.id, position: 1 }),
      },
    });

    await user.selectOptions(
      screen.getByLabelText('Category'),
      'Skin Care (hidden)',
    );
    await user.click(saveButton());

    expect(await screen.findByText('Bhringraj Oil saved')).toBeInTheDocument();
    expect(api.to('PATCH', `/v1/staff/products/${OIL.id}`)[0]?.body).toEqual({
      categoryId: SKIN.id,
      position: 1,
    });
  });

  it('warns that a new slug changes the web address', async () => {
    const { user } = await openProduct();

    await user.type(screen.getByLabelText('Slug'), '-2');

    expect(screen.getByLabelText('Slug')).toHaveAccessibleDescription(
      "Changing it changes the product's web address: old links to it stop working.",
    );
  });

  it('shows what the API refused next to its field', async () => {
    const { user } = await openProduct(OIL, {
      answers: {
        [PATCH_PRODUCT(OIL)]: () =>
          fieldsRefused([
            { field: 'usage', message: 'At most 2000 characters' },
          ]),
      },
    });

    await user.type(
      screen.getByLabelText('How to use'),
      'Massage into the scalp',
    );
    await user.click(saveButton());

    const usage = screen.getByLabelText('How to use');
    await waitFor(() =>
      expect(usage).toHaveAccessibleDescription('At most 2000 characters'),
    );
    expect(usage).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent(NEEDS_CHANGES);
  });

  it('says what the API refused when the page has no such field', async () => {
    const { user } = await openProduct(OIL, {
      answers: {
        [PATCH_PRODUCT(OIL)]: () =>
          fieldsRefused([{ field: 'position', message: 'At most 9999' }]),
      },
    });

    await user.type(screen.getByLabelText('Summary'), 'Cold-pressed');
    await user.click(saveButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('At most 9999');
  });

  it('says why when the slug is taken', async () => {
    const { user } = await openProduct(OIL, {
      answers: {
        [PATCH_PRODUCT(OIL)]: () =>
          json(409, {
            message:
              'Another product already has this slug. Choose a different one.',
          }),
      },
    });

    await user.clear(screen.getByLabelText('Slug'));
    await user.type(screen.getByLabelText('Slug'), 'amla-shampoo');
    await user.click(saveButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Another product already has this slug. Choose a different one.',
    );
    expect(
      screen.getByText('Bhringraj Oil', { selector: 'h1' }),
    ).toBeInTheDocument();
  });

  it('puts the changes back with Discard changes', async () => {
    const { user } = await openProduct();

    await user.type(screen.getByLabelText('Name'), ' Plus');
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));

    expect(screen.getByLabelText('Name')).toHaveValue('Bhringraj Oil');
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Discard changes' }),
    ).not.toBeInTheDocument();
  });

  it('asks before leaving with unsaved changes', async () => {
    const { user, router } = await openProduct(OIL, {
      answers: { [ALL_PRODUCTS]: productsOf([OIL]) },
    });

    await user.type(screen.getByLabelText('Name'), ' Plus');
    await user.click(screen.getByRole('link', { name: 'Products' }));

    const dialog = await screen.findByRole('dialog', {
      name: 'Leave without saving?',
    });
    await user.click(
      within(dialog).getByRole('button', { name: 'Keep editing' }),
    );
    expect(router.state.location.pathname).toBe(`/catalog/products/${OIL.id}`);
    expect(screen.getByLabelText('Name')).toHaveValue('Bhringraj Oil Plus');

    await user.click(screen.getByRole('link', { name: 'Products' }));
    await user.click(
      within(
        await screen.findByRole('dialog', { name: 'Leave without saving?' }),
      ).getByRole('button', { name: 'Leave without saving' }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/catalog/products'),
    );
  });

  it('keeps typing that happened while saving', async () => {
    const answer = heldBack();
    const { user } = await openProduct(OIL, {
      answers: { [PATCH_PRODUCT(OIL)]: answer.answer },
    });

    await user.type(screen.getByLabelText('Summary'), 'First');
    await user.click(saveButton());
    await user.type(screen.getByLabelText('How to use'), 'Typed meanwhile');
    answer.release(json(200, { ...OIL, summary: 'First' }));

    expect(await screen.findByText('Bhringraj Oil saved')).toBeInTheDocument();
    expect(screen.getByLabelText('How to use')).toHaveValue('Typed meanwhile');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });
});

describe('going live', () => {
  it('says what a draft still needs', async () => {
    await openProduct();

    expect(liveSwitch()).not.toBeChecked();
    expect(liveSwitch()).toHaveAccessibleDescription(
      "Before it can go live: Type, Licence number, Manufacturer, Manufacturer's address, Ingredients, HSN code, GST rate, and an image.",
    );
  });

  it('marks every missing detail before sending', async () => {
    const { user, api } = await openProduct();

    await user.click(liveSwitch());
    expect(liveSwitch()).toHaveAccessibleDescription(
      'It goes live when you save.',
    );
    await user.click(saveButton());

    for (const label of ['Type', 'Licence number', 'Ingredients', 'GST rate']) {
      expect(screen.getByLabelText(label)).toHaveAccessibleDescription(
        expect.stringContaining(NEEDED),
      );
    }
    expect(screen.getByLabelText('Type')).toHaveFocus();
    expect(api.to('PATCH', `/v1/staff/products/${OIL.id}`)).toHaveLength(0);
  });

  it('asks for an image first when the API says one is missing', async () => {
    const READY = { ...SHAMPOO, isActive: false };
    const { user, api } = await openProduct(READY, {
      answers: {
        [PATCH_PRODUCT(READY)]: () =>
          fieldsRefused([{ field: 'images', message: NEEDED }]),
      },
    });
    expect(liveSwitch()).toHaveAccessibleDescription(
      'Before it can go live: an image.',
    );

    await user.click(liveSwitch());
    await user.click(saveButton());

    await waitFor(() =>
      expect(liveSwitch()).toHaveAccessibleDescription(
        'It goes live when you save. Add an image first: a live product needs at least one.',
      ),
    );
    expect(liveSwitch()).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent(NEEDS_CHANGES);
    expect(api.to('PATCH', `/v1/staff/products/${READY.id}`)[0]?.body).toEqual({
      isActive: true,
    });

    // Turning it off again clears the mark.
    await user.click(liveSwitch());
    expect(liveSwitch()).toHaveAccessibleDescription(
      'Before it can go live: an image.',
    );
  });

  it('takes a live product out of the shop', async () => {
    const { user, api } = await openProduct(SHAMPOO, {
      answers: {
        [PATCH_PRODUCT(SHAMPOO)]: () =>
          json(200, { ...SHAMPOO, isActive: false }),
      },
    });
    expect(liveSwitch()).toHaveAccessibleDescription('It is in the shop.');

    await user.click(liveSwitch());
    expect(liveSwitch()).toHaveAccessibleDescription(
      'It leaves the shop when you save.',
    );
    await user.click(saveButton());

    expect(await screen.findByText('Amla Shampoo saved')).toBeInTheDocument();
    expect(
      api.to('PATCH', `/v1/staff/products/${SHAMPOO.id}`)[0]?.body,
    ).toEqual({
      isActive: false,
    });
    expect(await screen.findByText('Draft')).toBeInTheDocument();
  });
});

describe('a product that is not there', () => {
  it('never sends an address that is not an ID', async () => {
    const { api } = openSignedIn('/catalog/products/..%2Fstaff', {
      answers: { [CATEGORIES]: categoriesOf([HAIR]) },
    });

    expect(
      await screen.findByText('There is no such product'),
    ).toBeInTheDocument();
    expect(api.sent.some((r) => r.path.startsWith('/v1/staff/products'))).toBe(
      false,
    );
    expect(api.unexpected).toEqual([]);
  });

  it('says so when the API has no such product', async () => {
    openSignedIn(`/catalog/products/${OIL.id}`, {
      answers: {
        [CATEGORIES]: categoriesOf([HAIR]),
        [PRODUCT(OIL)]: () => json(404, { message: 'Product not found' }),
      },
    });

    expect(
      await screen.findByText('There is no such product'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Back to the products' }),
    ).toHaveAttribute('href', '/catalog/products');
  });

  it('says when it could not be loaded, and tries again', async () => {
    const { user } = openSignedIn(`/catalog/products/${OIL.id}`, {
      answers: {
        [CATEGORIES]: categoriesOf([HAIR]),
        [PRODUCT(OIL)]: [() => json(500), () => json(200, OIL)],
      },
    });

    expect(
      await screen.findByText('The product could not be loaded'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByLabelText('Name')).toHaveValue('Bhringraj Oil');
  });
});

describe('deleting a product (Super Users)', () => {
  it('is not offered to Admins', async () => {
    await openProduct();

    expect(
      screen.queryByRole('button', { name: 'Delete product' }),
    ).not.toBeInTheDocument();
  });

  it('explains what is lost, deletes it, and goes back to the list', async () => {
    const { user, api, router } = await openProduct(OIL, {
      staff: RAVI,
      answers: {
        [`DELETE /v1/staff/products/${OIL.id}`]: () =>
          new Response(null, { status: 204 }),
        [ALL_PRODUCTS]: productsOf([SHAMPOO]),
      },
    });
    // Unsaved changes do not hold the delete up.
    await user.type(screen.getByLabelText('Name'), ' Plus');

    await user.click(screen.getByRole('button', { name: 'Delete product' }));
    const dialog = screen.getByRole('dialog', {
      name: 'Delete Bhringraj Oil?',
    });
    expect(dialog).toHaveAccessibleDescription(
      expect.stringContaining(
        'It is removed for good, with its pack sizes and images',
      ),
    );
    // A draft is not in the shop: nothing to hide.
    expect(
      within(dialog).queryByRole('button', { name: 'Hide it instead' }),
    ).not.toBeInTheDocument();
    await user.click(
      within(dialog).getByRole('button', { name: 'Delete for good' }),
    );

    expect(
      await screen.findByText('Bhringraj Oil deleted'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/catalog/products'),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(api.to('DELETE', `/v1/staff/products/${OIL.id}`)).toHaveLength(1);
  });

  it('never shows a deleted product in the list it goes back to', async () => {
    const again = heldBack();
    const { user, router } = openSignedIn('/catalog/products', {
      staff: RAVI,
      answers: {
        [CATEGORIES]: categoriesOf([HAIR, SKIN]),
        [ALL_PRODUCTS]: [productsOf([OIL, SHAMPOO]), again.answer],
        [PRODUCT(OIL)]: () => json(200, OIL),
        [`DELETE /v1/staff/products/${OIL.id}`]: () =>
          new Response(null, { status: 204 }),
      },
    });
    await user.click(
      await screen.findByRole('link', { name: 'Bhringraj Oil' }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'Delete product' }),
    );
    await user.click(
      within(
        screen.getByRole('dialog', { name: 'Delete Bhringraj Oil?' }),
      ).getByRole('button', { name: 'Delete for good' }),
    );

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/catalog/products'),
    );
    expect(
      await screen.findByText('Loading the products…'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Bhringraj Oil' }),
    ).not.toBeInTheDocument();
    await act(async () =>
      again.release(json(200, { products: [SHAMPOO], nextAfter: null })),
    );
    expect(
      await screen.findByRole('link', { name: 'Amla Shampoo' }),
    ).toBeInTheDocument();
  });

  it('keeps the dialog open with the reason when the API refuses', async () => {
    const { user } = await openProduct(OIL, {
      staff: RAVI,
      answers: {
        [`DELETE /v1/staff/products/${OIL.id}`]: () =>
          json(409, {
            message:
              'This product still has stock. Write it off first, then delete it.',
          }),
      },
    });

    await user.click(screen.getByRole('button', { name: 'Delete product' }));
    const dialog = screen.getByRole('dialog', {
      name: 'Delete Bhringraj Oil?',
    });
    await user.click(
      within(dialog).getByRole('button', { name: 'Delete for good' }),
    );

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This product still has stock. Write it off first, then delete it.',
    );
  });

  it('offers hiding a live product instead', async () => {
    const { user, api } = await openProduct(SHAMPOO, {
      staff: RAVI,
      answers: {
        [PATCH_PRODUCT(SHAMPOO)]: () =>
          json(200, { ...SHAMPOO, isActive: false }),
      },
    });

    await user.click(screen.getByRole('button', { name: 'Delete product' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete Amla Shampoo?' });
    await user.click(
      within(dialog).getByRole('button', { name: 'Hide it instead' }),
    );

    expect(
      await screen.findByText('Amla Shampoo is now hidden from customers'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(liveSwitch()).not.toBeChecked();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(
      api.to('PATCH', `/v1/staff/products/${SHAMPOO.id}`)[0]?.body,
    ).toEqual({
      isActive: false,
    });

    // The page knows it is hidden: saving now sends nothing.
    await user.click(saveButton());
    expect(
      await screen.findByText('There are no changes to save.'),
    ).toBeInTheDocument();
  });
});
