import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RAVI, json } from '../../test/fake-api';
import { openSignedIn } from '../../test/console';

const LIST = 'GET /v1/staff/brands';
const CREATE = 'POST /v1/staff/brands';

const at = '2026-11-24T09:00:00.000Z';
// A brand as a create or a change gives it back, and as the list gives it.
const DABUR_SAVED = {
  id: '3f6c1a2e-9b4d-4c7e-8a15-6d2f0e9b7c41',
  name: 'Dabur',
  slug: 'dabur',
  createdAt: at,
  updatedAt: at,
};
const DABUR = { ...DABUR_SAVED, productCount: 0 };
const HIMALAYA = {
  ...DABUR,
  id: '5a8d2f4b-1c7e-4e9a-b3d6-0f2c8e5a7b91',
  name: 'Himalaya',
  slug: 'himalaya',
  productCount: 12,
};
const PATANJALI = {
  ...DABUR,
  id: '9c1e4b7d-3a6f-4d2c-8e5b-7f0a3c6e9d12',
  name: 'Patanjali',
  slug: 'patanjali',
  productCount: 1,
};
const ALL = [DABUR, HIMALAYA, PATANJALI];
const listOf = (brands: unknown[]) => () => json(200, { brands });
const PATCH = (brand: { id: string }) => `PATCH /v1/staff/brands/${brand.id}`;
const HAS_PRODUCTS = (brand: { id: string }) =>
  `GET /v1/staff/products?brandId=${brand.id}&limit=1`;
const noProducts = () => json(200, { products: [], nextAfter: null });

function rows() {
  const list = screen.getByRole('list', { name: 'Brands, by name' });
  return within(list)
    .getAllByRole('listitem')
    .map((row) => row.textContent);
}

async function openPage(
  answers: Parameters<typeof openSignedIn>[1] = {},
  path = '/catalog/brands',
) {
  const console = openSignedIn(path, {
    ...answers,
    answers: { [LIST]: listOf(ALL), ...answers.answers },
  });
  await screen.findByRole('heading', { name: 'Brands' });
  return console;
}

async function waitForList() {
  await screen.findByRole('list', { name: 'Brands, by name' });
}

describe('the brands page', () => {
  it('opens from the catalog tabs, with every brand by name and how many products have it', async () => {
    const { user, router } = openSignedIn('/catalog/categories', {
      answers: {
        'GET /v1/staff/categories': () => json(200, { categories: [] }),
        [LIST]: listOf(ALL),
      },
    });
    await screen.findByRole('heading', { name: 'Categories' });
    await user.click(screen.getByRole('link', { name: 'Brands' }));
    await waitForList();

    expect(router.state.location.pathname).toBe('/catalog/brands');
    await waitFor(() =>
      expect(document.title).toBe('Brands · Herbal Commerce Admin'),
    );
    expect(rows()).toEqual([
      expect.stringMatching(/^Dabur.*dabur.*No products/),
      expect.stringMatching(/^Himalaya.*himalaya.*12 products/),
      expect.stringMatching(/^Patanjali.*patanjali.*1 product(?!s)/),
    ]);
  });

  it('says when the list could not be loaded, and tries again', async () => {
    const { user } = await openPage({
      answers: { [LIST]: [() => json(503), listOf(ALL)] },
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The brands could not be loaded');
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await waitForList();
    expect(rows()).toHaveLength(3);
  });

  it('invites the first brand when there is none', async () => {
    const { user } = await openPage({ answers: { [LIST]: listOf([]) } });

    await user.click(
      await screen.findByRole('button', { name: 'Add the first brand' }),
    );

    expect(
      screen.getByRole('dialog', { name: 'New brand' }),
    ).toBeInTheDocument();
  });

  it('shows no delete buttons to Admins', async () => {
    await openPage();
    await waitForList();

    expect(
      screen.queryByRole('button', { name: /^Delete/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Edit Himalaya' }),
    ).toBeInTheDocument();
  });
});

describe('a new brand', () => {
  it('is checked before it is sent', async () => {
    const { user, api } = await openPage();
    await waitForList();

    await user.click(screen.getByRole('button', { name: 'New brand' }));
    const dialog = screen.getByRole('dialog', { name: 'New brand' });
    await user.click(within(dialog).getByRole('button', { name: 'Add brand' }));

    expect(within(dialog).getByLabelText('Name')).toHaveAccessibleDescription(
      expect.stringContaining('Enter a name'),
    );
    expect(within(dialog).getByLabelText('Name')).toHaveFocus();

    await user.type(within(dialog).getByLabelText('Name'), 'हिमालय');
    await user.click(within(dialog).getByRole('button', { name: 'Add brand' }));
    expect(within(dialog).getByLabelText('Slug')).toHaveAccessibleDescription(
      expect.stringContaining(
        'The name has no Latin letters or digits: enter a slug',
      ),
    );

    await user.type(within(dialog).getByLabelText('Slug'), 'Hima Laya');
    await user.click(within(dialog).getByRole('button', { name: 'Add brand' }));
    expect(within(dialog).getByLabelText('Slug')).toHaveAccessibleDescription(
      expect.stringContaining(
        'Use lowercase letters, digits and single hyphens',
      ),
    );
    expect(api.to('POST', '/v1/staff/brands')).toHaveLength(0);
  });

  it('is added with its slug made from the name, and takes its place by name', async () => {
    const BAIDYANATH = {
      ...DABUR_SAVED,
      id: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
      name: 'Baidyanath',
      slug: 'baidyanath',
    };
    const { user, api } = await openPage({
      answers: {
        [LIST]: [
          listOf(ALL),
          listOf([{ ...BAIDYANATH, productCount: 0 }, ...ALL]),
        ],
        [CREATE]: () => json(201, BAIDYANATH),
      },
    });
    await waitForList();

    await user.click(screen.getByRole('button', { name: 'New brand' }));
    const dialog = screen.getByRole('dialog', { name: 'New brand' });
    await user.type(within(dialog).getByLabelText('Name'), '  Baidyanath ');
    expect(within(dialog).getByLabelText('Slug')).toHaveAccessibleDescription(
      'Leave empty to use “baidyanath”.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Add brand' }));

    expect(await screen.findByText('Baidyanath added')).toBeInTheDocument();
    await waitFor(() => expect(rows()[0]).toMatch(/^Baidyanath.*No products/));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.to('POST', '/v1/staff/brands')[0]?.body).toEqual({
      name: 'Baidyanath',
    });
  });

  it('keeps the dialog open with the reason when the slug is taken', async () => {
    const { user } = await openPage({
      answers: {
        [CREATE]: () =>
          json(409, {
            message:
              'Another brand already has this slug. Choose a different one.',
          }),
      },
    });
    await waitForList();

    await user.click(screen.getByRole('button', { name: 'New brand' }));
    const dialog = screen.getByRole('dialog', { name: 'New brand' });
    await user.type(within(dialog).getByLabelText('Name'), 'HIMALAYA');
    await user.click(within(dialog).getByRole('button', { name: 'Add brand' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Another brand already has this slug. Choose a different one.',
    );
    expect(dialog).toHaveAttribute('open');
  });

  it('shows what the API refused next to its field', async () => {
    const { user } = await openPage({
      answers: {
        [CREATE]: () =>
          json(400, {
            message: 'Validation failed',
            errors: [{ field: 'name', message: 'At most 60 characters' }],
          }),
      },
    });
    await waitForList();

    await user.click(screen.getByRole('button', { name: 'New brand' }));
    const dialog = screen.getByRole('dialog', { name: 'New brand' });
    await user.type(within(dialog).getByLabelText('Name'), 'Baidyanath');
    await user.click(within(dialog).getByRole('button', { name: 'Add brand' }));

    const name = within(dialog).getByLabelText('Name');
    await waitFor(() =>
      expect(name).toHaveAccessibleDescription(
        expect.stringContaining('At most 60 characters'),
      ),
    );
    expect(name).toHaveFocus();
  });
});

describe('changing a brand', () => {
  it('sends only what changed, and keeps its product count', async () => {
    const renamed = {
      ...DABUR_SAVED,
      id: HIMALAYA.id,
      name: 'Himalaya Wellness',
      slug: 'himalaya',
    };
    const { user, api } = await openPage({
      answers: {
        [LIST]: [listOf(ALL), () => new Promise<Response>(() => undefined)],
        [PATCH(HIMALAYA)]: () => json(200, renamed),
      },
    });
    await waitForList();

    await user.click(screen.getByRole('button', { name: 'Edit Himalaya' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Himalaya' });
    expect(within(dialog).getByLabelText('Slug')).toHaveAccessibleDescription(
      "Part of the brand's web address in the shop.",
    );
    const name = within(dialog).getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Himalaya Wellness');
    await user.click(
      within(dialog).getByRole('button', { name: 'Save changes' }),
    );

    expect(
      await screen.findByText('Himalaya Wellness saved'),
    ).toBeInTheDocument();
    expect(rows()[1]).toMatch(/^Himalaya Wellness.*12 products/);
    expect(api.to('PATCH', `/v1/staff/brands/${HIMALAYA.id}`)[0]?.body).toEqual(
      {
        name: 'Himalaya Wellness',
      },
    );
  });

  it('warns that a new slug changes the web address', async () => {
    const { user } = await openPage();
    await waitForList();

    await user.click(screen.getByRole('button', { name: 'Edit Dabur' }));
    const slug = within(
      screen.getByRole('dialog', { name: 'Edit Dabur' }),
    ).getByLabelText('Slug');
    await user.type(slug, '-india');

    expect(slug).toHaveAccessibleDescription(
      "Changing it changes the brand's web address in the shop: old links to it stop working.",
    );
  });

  it('sends nothing when nothing changed', async () => {
    const { user, api } = await openPage();
    await waitForList();

    await user.click(screen.getByRole('button', { name: 'Edit Dabur' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Dabur' });
    await user.click(
      within(dialog).getByRole('button', { name: 'Save changes' }),
    );

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(api.to('PATCH', `/v1/staff/brands/${DABUR.id}`)).toHaveLength(0);
  });
});

describe('deleting a brand (Super Users)', () => {
  it('explains what is lost, and deletes it', async () => {
    const { user, api } = await openPage({
      staff: RAVI,
      answers: {
        // The list read again after the delete never comes back.
        [LIST]: [listOf(ALL), () => new Promise<Response>(() => undefined)],
        [HAS_PRODUCTS(DABUR)]: noProducts,
        [`DELETE /v1/staff/brands/${DABUR.id}`]: () =>
          new Response(null, { status: 204 }),
      },
    });
    await waitForList();

    await user.click(screen.getByRole('button', { name: 'Delete Dabur' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete Dabur?' });
    expect(dialog).toHaveAccessibleDescription(
      expect.stringContaining('It is removed for good'),
    );
    const remove = within(dialog).getByRole('button', {
      name: 'Delete for good',
    });
    await waitFor(() => expect(remove).toBeEnabled());
    await user.click(remove);

    expect(await screen.findByText('Dabur deleted')).toBeInTheDocument();
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(api.to('DELETE', `/v1/staff/brands/${DABUR.id}`)).toHaveLength(1);
  });

  it('cannot delete a brand that products still have, asking the API again rather than the list', async () => {
    const { user, api } = await openPage({
      staff: RAVI,
      answers: {
        // The list says none, but one was given the brand since.
        [HAS_PRODUCTS(DABUR)]: () =>
          json(200, {
            products: [
              {
                id: '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f',
                categoryId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
                name: 'Chyawanprash',
                slug: 'chyawanprash',
                summary: null,
                description: null,
                ingredients: null,
                usage: null,
                type: null,
                licenceNumber: null,
                manufacturerName: null,
                manufacturerAddress: null,
                countryOfOrigin: 'India',
                hsnCode: null,
                gstRate: null,
                isActive: false,
                position: 0,
                createdAt: at,
                updatedAt: at,
              },
            ],
            nextAfter: null,
          }),
      },
    });
    await waitForList();

    await user.click(screen.getByRole('button', { name: 'Delete Dabur' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete Dabur?' });

    expect(
      await within(dialog).findByText(
        /Products still have this brand, so it can't be deleted/,
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'Delete for good' }),
    ).toBeDisabled();
    expect(api.unexpected).toEqual([]);
  });

  it('keeps the dialog open with the reason when the API refuses', async () => {
    const { user } = await openPage({
      staff: RAVI,
      answers: {
        [HAS_PRODUCTS(PATANJALI)]: noProducts,
        [`DELETE /v1/staff/brands/${PATANJALI.id}`]: () =>
          json(409, {
            message:
              'This brand still has products. Choose another brand for them, or none, first.',
          }),
      },
    });
    await waitForList();

    await user.click(screen.getByRole('button', { name: 'Delete Patanjali' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete Patanjali?' });
    const remove = within(dialog).getByRole('button', {
      name: 'Delete for good',
    });
    await waitFor(() => expect(remove).toBeEnabled());
    await user.click(remove);

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This brand still has products.',
    );
    expect(dialog).toHaveAttribute('open');
  });
});
