import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  HAIR,
  ML_100,
  ML_200,
  ML_500,
  OIL,
  PRODUCT,
  SHAMPOO,
  SKIN,
  VARIANTS,
  categoriesOf,
  fieldsRefused,
  variantsOf,
} from '../../test/catalog-fixtures';
import { heldBack, openSignedIn } from '../../test/console';
import { RAVI, json } from '../../test/fake-api';

const ALL = [ML_100, ML_200, ML_500];
const POST = `POST /v1/staff/products/${SHAMPOO.id}/variants`;
const ORDER = `PUT /v1/staff/products/${SHAMPOO.id}/variants/order`;
const PATCH = (pack: { id: string }) => `PATCH /v1/staff/variants/${pack.id}`;
const DELETE = (pack: { id: string }) => `DELETE /v1/staff/variants/${pack.id}`;
const LIST_NAME = 'Pack sizes, in the order customers see them';

async function openPacks(
  options: Parameters<typeof openSignedIn>[1] & {
    product?: { id: string; name: string };
  } = {},
) {
  const product = options.product ?? SHAMPOO;
  const console = openSignedIn(`/catalog/products/${product.id}`, {
    ...options,
    answers: {
      [CATEGORIES]: categoriesOf([HAIR, SKIN]),
      [PRODUCT(product)]: () => json(200, product),
      [VARIANTS(product)]: variantsOf(ALL),
      ...options.answers,
    },
  });
  await screen.findByRole('heading', { name: product.name, level: 1 });
  return console;
}

const section = () => screen.getByRole('region', { name: 'Pack sizes' });

async function waitForList() {
  return screen.findByRole('list', { name: LIST_NAME });
}

function rowNames() {
  return within(screen.getByRole('list', { name: LIST_NAME }))
    .getAllByRole('listitem')
    .map((row) => row.querySelector('p')?.textContent);
}

function row(name: string) {
  const found = within(screen.getByRole('list', { name: LIST_NAME }))
    .getAllByRole('listitem')
    .find((item) => item.querySelector('p')?.textContent === name);
  if (!found) {
    throw new Error(`No row ${name}`);
  }
  return found;
}

describe("a product's pack sizes", () => {
  it('lists them in the order customers see them, with their SKUs and prices', async () => {
    await openPacks();
    await waitForList();

    expect(rowNames()).toEqual(['100 ml', '200 ml', '500 ml']);
    expect(row('100 ml')).toHaveTextContent('AML-SHA-100');
    expect(row('100 ml')).toHaveTextContent('₹225 · MRP ₹250');
    expect(row('100 ml')).toHaveTextContent('On sale');
    expect(row('200 ml')).toHaveTextContent('₹450 (the MRP)');
    expect(row('500 ml')).toHaveTextContent('Off sale');
    expect(
      screen.getByRole('switch', { name: '500 ml on sale' }),
    ).not.toBeChecked();
    expect(
      within(section()).queryByText(/no pack size is on sale/),
    ).not.toBeInTheDocument();
  });

  it('warns when a live product has no pack size on sale', async () => {
    await openPacks({ answers: { [VARIANTS(SHAMPOO)]: variantsOf([ML_500]) } });
    await waitForList();

    expect(
      within(section()).getByText(
        "The product is live, but no pack size is on sale: customers can't buy it.",
      ),
    ).toBeInTheDocument();
  });

  it('does not warn about a draft with nothing on sale', async () => {
    await openPacks({
      product: OIL,
      answers: { [VARIANTS(OIL)]: variantsOf([ML_500]) },
    });
    await waitForList();

    expect(
      within(section()).queryByText(/no pack size is on sale/),
    ).not.toBeInTheDocument();
  });

  it('invites the first pack size when there is none', async () => {
    const { user } = await openPacks({
      product: OIL,
      answers: { [VARIANTS(OIL)]: variantsOf([]) },
    });

    await user.click(
      await within(section()).findByRole('button', {
        name: 'Add the first pack size',
      }),
    );

    expect(
      screen.getByRole('dialog', { name: 'New pack size' }),
    ).toBeInTheDocument();
    // A draft: nothing to warn about.
    expect(
      within(section()).queryByText(/no pack size is on sale/),
    ).not.toBeInTheDocument();
  });

  it('says when they could not be loaded, and tries again', async () => {
    const { user } = await openPacks({
      answers: { [VARIANTS(SHAMPOO)]: [() => json(500), variantsOf(ALL)] },
    });

    expect(
      await within(section()).findByText('The pack sizes could not be loaded'),
    ).toBeInTheDocument();
    await user.click(
      within(section()).getByRole('button', { name: 'Try again' }),
    );

    await waitForList();
    expect(rowNames()).toEqual(['100 ml', '200 ml', '500 ml']);
  });

  it('is not on a new product’s page until it is added', async () => {
    const { api } = openSignedIn('/catalog/products/new', {
      answers: { [CATEGORIES]: categoriesOf([HAIR, SKIN]) },
    });
    await screen.findByRole('heading', { name: 'New product' });

    expect(
      screen.queryByRole('region', { name: 'Pack sizes' }),
    ).not.toBeInTheDocument();
    expect(api.unexpected).toEqual([]);
  });
});

describe('a new pack size', () => {
  it('is checked before it is sent', async () => {
    const { user, api } = await openPacks();
    await waitForList();
    await user.click(screen.getByRole('button', { name: 'Add pack size' }));
    const dialog = screen.getByRole('dialog', { name: 'New pack size' });

    await user.click(
      within(dialog).getByRole('button', { name: 'Add pack size' }),
    );

    expect(within(dialog).getByLabelText('Quantity')).toHaveFocus();
    expect(
      within(dialog).getByLabelText('Quantity'),
    ).toHaveAccessibleDescription(
      expect.stringContaining('Enter the quantity on the label'),
    );
    expect(within(dialog).getByLabelText('Unit')).toHaveAccessibleDescription(
      'Choose a unit',
    );

    await user.type(within(dialog).getByLabelText('Quantity'), '150');
    await user.selectOptions(within(dialog).getByLabelText('Unit'), 'ml');
    await user.type(within(dialog).getByLabelText('SKU'), 'aml sha 150');
    await user.type(within(dialog).getByLabelText('MRP (₹)'), '349.50');
    await user.type(within(dialog).getByLabelText('Price (₹)'), '400');
    await user.click(
      within(dialog).getByRole('button', { name: 'Add pack size' }),
    );

    expect(within(dialog).getByLabelText('SKU')).toHaveFocus();
    expect(within(dialog).getByLabelText('SKU')).toHaveAccessibleDescription(
      expect.stringContaining('letters, digits and single hyphens'),
    );
    expect(
      within(dialog).getByLabelText('MRP (₹)'),
    ).toHaveAccessibleDescription(
      expect.stringContaining('Whole rupees only, like 499'),
    );

    await user.clear(within(dialog).getByLabelText('MRP (₹)'));
    await user.type(within(dialog).getByLabelText('MRP (₹)'), '350');
    await user.click(
      within(dialog).getByRole('button', { name: 'Add pack size' }),
    );
    expect(
      within(dialog).getByLabelText('Price (₹)'),
    ).toHaveAccessibleDescription(
      expect.stringContaining('The price may not be more than the MRP'),
    );
    await user.type(within(dialog).getByLabelText('MRP (₹)'), '0');
    expect(
      within(dialog).getByLabelText('Price (₹)'),
    ).toHaveAccessibleDescription('₹3,100 off the MRP.');

    expect(api.to('POST', `/v1/staff/products/${SHAMPOO.id}/variants`)).toEqual(
      [],
    );
  });

  it('is added on sale, after the last one, and the list reads it', async () => {
    const ML_150 = {
      ...ML_100,
      id: '9d0e1f2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a',
      sku: 'AML-SHA-150',
      quantity: 150,
      mrpRupees: 1250,
      priceRupees: 1199,
      position: 3,
    };
    const { user, api } = await openPacks({
      answers: {
        [VARIANTS(SHAMPOO)]: [variantsOf(ALL), variantsOf([...ALL, ML_150])],
        [POST]: () => json(201, ML_150),
      },
    });
    await waitForList();
    await user.click(screen.getByRole('button', { name: 'Add pack size' }));
    const dialog = screen.getByRole('dialog', { name: 'New pack size' });

    await user.type(within(dialog).getByLabelText('Quantity'), '150');
    await user.selectOptions(within(dialog).getByLabelText('Unit'), 'ml');
    await user.type(within(dialog).getByLabelText('SKU'), ' aml-sha-150 ');
    await user.type(within(dialog).getByLabelText('MRP (₹)'), '1,250');
    await user.type(within(dialog).getByLabelText('Price (₹)'), '1199');
    expect(
      within(dialog).getByLabelText('Price (₹)'),
    ).toHaveAccessibleDescription('₹51 off the MRP.');
    expect(
      within(dialog).getByRole('switch', { name: 'On sale' }),
    ).toBeChecked();
    await user.click(
      within(dialog).getByRole('button', { name: 'Add pack size' }),
    );

    expect(await screen.findByText('150 ml added')).toBeInTheDocument();
    expect(
      api.to('POST', `/v1/staff/products/${SHAMPOO.id}/variants`)[0]?.body,
    ).toEqual({
      sku: 'AML-SHA-150',
      quantity: 150,
      unit: 'ML',
      mrpRupees: 1250,
      priceRupees: 1199,
      isActive: true,
      position: 3,
    });
    await waitFor(() =>
      expect(rowNames()).toEqual(['100 ml', '200 ml', '500 ml', '150 ml']),
    );
    expect(
      screen.queryByRole('dialog', { name: 'New pack size' }),
    ).not.toBeInTheDocument();
  });

  it('marks the field the API refused, a taken SKU or size too', async () => {
    const { user } = await openPacks({
      answers: {
        [POST]: [
          () =>
            json(409, {
              message:
                'Another pack size already has this SKU. Choose a different one.',
            }),
          () =>
            json(409, {
              message: 'This product already has a pack of this size.',
            }),
          () =>
            fieldsRefused([
              {
                field: 'priceRupees',
                message: 'The price may not be more than the MRP',
              },
            ]),
          () => json(503, {}),
        ],
      },
    });
    await waitForList();
    await user.click(screen.getByRole('button', { name: 'Add pack size' }));
    const dialog = screen.getByRole('dialog', { name: 'New pack size' });
    await user.type(within(dialog).getByLabelText('Quantity'), '100');
    await user.selectOptions(within(dialog).getByLabelText('Unit'), 'ml');
    await user.type(within(dialog).getByLabelText('SKU'), 'AML-SHA-100');
    await user.type(within(dialog).getByLabelText('MRP (₹)'), '250');
    await user.type(within(dialog).getByLabelText('Price (₹)'), '225');
    const add = () =>
      user.click(within(dialog).getByRole('button', { name: 'Add pack size' }));

    await add();
    await waitFor(() =>
      expect(within(dialog).getByLabelText('SKU')).toHaveFocus(),
    );
    expect(within(dialog).getByLabelText('SKU')).toHaveAccessibleDescription(
      expect.stringContaining('Another pack size already has this SKU'),
    );

    await add();
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Quantity')).toHaveFocus(),
    );
    expect(
      within(dialog).getByLabelText('Quantity'),
    ).toHaveAccessibleDescription(
      expect.stringContaining('This product already has a pack of this size.'),
    );

    await add();
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Price (₹)')).toHaveFocus(),
    );

    await add();
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The server had a problem. Try again in a moment.',
    );
    expect(
      screen.getByRole('dialog', { name: 'New pack size' }),
    ).toBeInTheDocument();
  });
});

describe('changing a pack size', () => {
  it('sends only what changed', async () => {
    const { user, api } = await openPacks({
      answers: {
        [PATCH(ML_100)]: () => json(200, { ...ML_100, priceRupees: 199 }),
      },
    });
    await waitForList();
    await user.click(screen.getByRole('button', { name: 'Edit 100 ml' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit 100 ml' });
    expect(within(dialog).getByLabelText('SKU')).toHaveValue('AML-SHA-100');

    await user.clear(within(dialog).getByLabelText('Price (₹)'));
    await user.type(within(dialog).getByLabelText('Price (₹)'), '199');
    await user.click(
      within(dialog).getByRole('button', { name: 'Save changes' }),
    );

    expect(await screen.findByText('100 ml saved')).toBeInTheDocument();
    expect(api.to('PATCH', `/v1/staff/variants/${ML_100.id}`)[0]?.body).toEqual(
      { priceRupees: 199 },
    );
    expect(row('100 ml')).toHaveTextContent('₹199 · MRP ₹250');
    expect(rowNames()).toEqual(['100 ml', '200 ml', '500 ml']);
    expect(row('200 ml')).toHaveTextContent('₹450 (the MRP)');
  });

  it('sends nothing when nothing changed', async () => {
    const { user, api } = await openPacks();
    await waitForList();
    await user.click(screen.getByRole('button', { name: 'Edit 200 ml' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit 200 ml' });

    await user.click(
      within(dialog).getByRole('button', { name: 'Save changes' }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Edit 200 ml' }),
      ).not.toBeInTheDocument(),
    );
    expect(api.to('PATCH', `/v1/staff/variants/${ML_200.id}`)).toEqual([]);
  });
});

describe('putting a pack size on or off sale', () => {
  it('flips at once, and says so', async () => {
    const { user, api } = await openPacks({
      answers: {
        [PATCH(ML_100)]: () => json(200, { ...ML_100, isActive: false }),
      },
    });
    await waitForList();
    const toggle = screen.getByRole('switch', { name: '100 ml on sale' });

    await user.click(toggle);

    expect(
      await screen.findByText('100 ml is now off sale'),
    ).toBeInTheDocument();
    expect(toggle).not.toBeChecked();
    expect(row('100 ml')).toHaveTextContent('Off sale');
    expect(api.to('PATCH', `/v1/staff/variants/${ML_100.id}`)[0]?.body).toEqual(
      { isActive: false },
    );
  });

  it('ignores clicks while its change is on the way, and goes back when refused', async () => {
    const answer = heldBack();
    const { user, api } = await openPacks({
      answers: { [PATCH(ML_500)]: answer.answer },
    });
    await waitForList();
    const toggle = screen.getByRole('switch', { name: '500 ml on sale' });

    await user.click(toggle);
    await user.click(toggle);

    expect(toggle).toBeChecked();
    expect(api.to('PATCH', `/v1/staff/variants/${ML_500.id}`)).toHaveLength(1);
    await act(async () => answer.release(json(403, { message: 'Forbidden' })));
    expect(
      await screen.findByText("Your role can't do this."),
    ).toBeInTheDocument();
    expect(toggle).not.toBeChecked();
  });
});

describe('ordering pack sizes with the keyboard', () => {
  it('moves one with the arrow keys, says where it went, and saves the whole list', async () => {
    const { user, api } = await openPacks({
      answers: { [ORDER]: variantsOf([ML_200, ML_100, ML_500]) },
    });
    await waitForList();
    const handle = screen.getByRole('button', { name: 'Move 100 ml' });
    expect(handle).toHaveAccessibleDescription(
      expect.stringContaining('press Up or Down to move a pack size one place'),
    );

    handle.focus();
    await user.keyboard('{ArrowDown}');

    expect(rowNames()).toEqual(['200 ml', '100 ml', '500 ml']);
    expect(
      screen.getByText('100 ml moved to position 2 of 3.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Order saved')).toBeInTheDocument();
    expect(
      api.to('PUT', `/v1/staff/products/${SHAMPOO.id}/variants/order`)[0]?.body,
    ).toEqual({ ids: [ML_200.id, ML_100.id, ML_500.id] });
  });

  it('goes back to the saved order when the pack sizes changed meanwhile', async () => {
    const { user } = await openPacks({
      answers: {
        [VARIANTS(SHAMPOO)]: [variantsOf(ALL), variantsOf([ML_500, ML_100])],
        [ORDER]: () =>
          json(409, {
            message:
              "The product's pack sizes changed while you were ordering them. Reload and try again.",
          }),
      },
    });
    await waitForList();

    screen.getByRole('button', { name: 'Move 500 ml' }).focus();
    await user.keyboard('{Home}');

    expect(
      await screen.findByText(
        "The product's pack sizes changed while you were ordering them. Reload and try again.",
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(rowNames()).toEqual(['500 ml', '100 ml']));
  });
});

describe('deleting a pack size (Super Users)', () => {
  it('is not offered to Admins', async () => {
    await openPacks();
    await waitForList();

    expect(
      screen.queryByRole('button', { name: /^Delete / }),
    ).not.toBeInTheDocument();
  });

  it('explains what is lost, and deletes it', async () => {
    const { user, api } = await openPacks({
      staff: RAVI,
      answers: {
        [VARIANTS(SHAMPOO)]: [variantsOf(ALL), variantsOf([ML_100, ML_200])],
        [DELETE(ML_500)]: () => new Response(null, { status: 204 }),
      },
    });
    await waitForList();

    await user.click(screen.getByRole('button', { name: 'Delete 500 ml' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete 500 ml?' });
    expect(dialog).toHaveAccessibleDescription(
      expect.stringContaining('It is removed for good'),
    );
    // Off sale already: nothing to offer instead.
    expect(
      within(dialog).queryByRole('button', {
        name: 'Take it off sale instead',
      }),
    ).not.toBeInTheDocument();
    await user.click(
      within(dialog).getByRole('button', { name: 'Delete for good' }),
    );

    expect(await screen.findByText('500 ml deleted')).toBeInTheDocument();
    await waitFor(() => expect(rowNames()).toEqual(['100 ml', '200 ml']));
    expect(api.to('DELETE', `/v1/staff/variants/${ML_500.id}`)).toHaveLength(1);
  });

  it('keeps the dialog open with the reason when the pack still has stock', async () => {
    const { user } = await openPacks({
      staff: RAVI,
      answers: {
        [DELETE(ML_100)]: () =>
          json(409, {
            message:
              'This pack size still has stock. Write it off first, then delete it.',
          }),
      },
    });
    await waitForList();

    await user.click(screen.getByRole('button', { name: 'Delete 100 ml' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete 100 ml?' });
    await user.click(
      within(dialog).getByRole('button', { name: 'Delete for good' }),
    );

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This pack size still has stock. Write it off first, then delete it.',
    );
    expect(rowNames()).toEqual(['100 ml', '200 ml', '500 ml']);
  });

  it('offers taking it off sale instead', async () => {
    const { user, api } = await openPacks({
      staff: RAVI,
      answers: {
        [PATCH(ML_100)]: () => json(200, { ...ML_100, isActive: false }),
      },
    });
    await waitForList();

    await user.click(screen.getByRole('button', { name: 'Delete 100 ml' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete 100 ml?' });
    await user.click(
      within(dialog).getByRole('button', { name: 'Take it off sale instead' }),
    );

    expect(
      await screen.findByText('100 ml is now off sale'),
    ).toBeInTheDocument();
    expect(row('100 ml')).toHaveTextContent('Off sale');
    expect(api.to('PATCH', `/v1/staff/variants/${ML_100.id}`)[0]?.body).toEqual(
      { isActive: false },
    );
    expect(api.to('DELETE', `/v1/staff/variants/${ML_100.id}`)).toEqual([]);
  });
});
