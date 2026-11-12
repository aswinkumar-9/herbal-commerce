import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RAVI, json } from '../../test/fake-api';
import { heldBack, openSignedIn } from '../../test/console';

const LIST = 'GET /v1/staff/categories';
const CREATE = 'POST /v1/staff/categories';
const ORDER = 'PUT /v1/staff/categories/order';

const at = '2026-11-01T09:00:00.000Z';
const HAIR = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  name: 'Hair Care',
  slug: 'hair-care',
  description: null,
  isActive: true,
  position: 0,
  createdAt: at,
  updatedAt: at,
};
const SKIN = {
  ...HAIR,
  id: '0b8f3a52-6d1e-4c7a-9f2b-3e4d5c6b7a81',
  name: 'Skin Care',
  slug: 'skin-care',
  description: 'Creams and oils for the skin',
  isActive: false,
  position: 1,
};
const TEAS = {
  ...HAIR,
  id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  name: 'Herbal Teas',
  slug: 'herbal-teas',
  position: 2,
};
const ALL = [HAIR, SKIN, TEAS];
// A product in Hair Care, drafts count too.
const OIL = {
  id: '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f',
  categoryId: HAIR.id,
  name: 'Bhringraj Oil',
  slug: 'bhringraj-oil',
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
};
const listOf = (categories: unknown[]) => () => json(200, { categories });
const PATCH = (category: { id: string }) =>
  `PATCH /v1/staff/categories/${category.id}`;
const HAS_PRODUCTS = (category: { id: string }) =>
  `GET /v1/staff/products?categoryId=${category.id}&limit=1`;

function rowNames() {
  const list = screen.getByRole('list', {
    name: 'Categories, in the order customers see them',
  });
  return within(list)
    .getAllByRole('listitem')
    .map((row) => row.querySelector('p')?.textContent);
}

async function openPage(
  answers: Parameters<typeof openSignedIn>[1] = {},
  path = '/catalog/categories',
) {
  const console = openSignedIn(path, {
    ...answers,
    answers: { [LIST]: listOf(ALL), ...answers.answers },
  });
  await screen.findByRole('heading', { name: 'Categories' });
  return console;
}

async function waitForList() {
  await screen.findByRole('list', {
    name: 'Categories, in the order customers see them',
  });
}

// A browser drops the focus from an element moved in the page (it is taken
// out and put back); jsdom keeps it. Do as the browser does.
function dropFocusOnMove() {
  const insert = Node.prototype.insertBefore;
  const append = Node.prototype.appendChild;
  const blurIfMoved = (node: Node) => {
    const focused = document.activeElement;
    if (
      focused instanceof HTMLElement &&
      node.contains(focused) &&
      node.isConnected
    ) {
      focused.blur();
    }
  };
  vi.spyOn(Node.prototype, 'insertBefore').mockImplementation(function <
    T extends Node,
  >(this: Node, node: T, child: Node | null): T {
    blurIfMoved(node);
    return insert.call(this, node, child) as T;
  });
  vi.spyOn(Node.prototype, 'appendChild').mockImplementation(function <
    T extends Node,
  >(this: Node, node: T): T {
    blurIfMoved(node);
    return append.call(this, node) as T;
  });
}

describe('the categories page', () => {
  it('opens from the catalog, with the categories in the order customers see them', async () => {
    const { router } = await openPage({}, '/catalog');
    await waitForList();

    expect(router.state.location.pathname).toBe('/catalog/categories');
    expect(document.title).toBe('Categories · Herbal Commerce Admin');
    expect(rowNames()).toEqual(['Hair Care', 'Skin Care', 'Herbal Teas']);
    expect(
      screen.getByRole('switch', { name: 'Customers see Hair Care' }),
    ).toBeChecked();
    expect(
      screen.getByRole('switch', { name: 'Customers see Skin Care' }),
    ).not.toBeChecked();
    expect(
      screen.getByText('Creams and oils for the skin'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Categories' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('says when the list could not be loaded, and tries again', async () => {
    const { user } = await openPage({
      answers: { [LIST]: [() => json(503), listOf(ALL)] },
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The categories could not be loaded');
    expect(alert).toHaveTextContent(
      'The server had a problem. Try again in a moment.',
    );
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await waitForList();
    expect(rowNames()).toHaveLength(3);
  });

  it('invites the first category when there is none', async () => {
    const { user } = await openPage({ answers: { [LIST]: listOf([]) } });

    await user.click(
      await screen.findByRole('button', { name: 'Add the first category' }),
    );

    expect(
      screen.getByRole('dialog', { name: 'New category' }),
    ).toBeInTheDocument();
  });

  it('shows no delete buttons to Admins', async () => {
    await openPage();
    await waitForList();

    expect(
      screen.queryByRole('button', { name: /^Delete/ }),
    ).not.toBeInTheDocument();
  });
});

describe('a new category', () => {
  it('is checked before it is sent', async () => {
    const { user, api } = await openPage();
    await waitForList();

    await user.click(screen.getByRole('button', { name: 'New category' }));
    const dialog = screen.getByRole('dialog', { name: 'New category' });
    await user.click(
      within(dialog).getByRole('button', { name: 'Add category' }),
    );

    expect(within(dialog).getByLabelText('Name')).toHaveAccessibleDescription(
      'Enter a name',
    );
    expect(within(dialog).getByLabelText('Name')).toHaveFocus();

    await user.type(within(dialog).getByLabelText('Name'), 'मेहंदी');
    await user.click(
      within(dialog).getByRole('button', { name: 'Add category' }),
    );
    expect(within(dialog).getByLabelText('Slug')).toHaveAccessibleDescription(
      expect.stringContaining(
        'The name has no Latin letters or digits: enter a slug',
      ),
    );

    await user.type(within(dialog).getByLabelText('Slug'), 'Mehndi Hair');
    await user.click(
      within(dialog).getByRole('button', { name: 'Add category' }),
    );
    expect(within(dialog).getByLabelText('Slug')).toHaveAccessibleDescription(
      expect.stringContaining(
        'Use lowercase letters, digits and single hyphens',
      ),
    );
    expect(api.to('POST', '/v1/staff/categories')).toHaveLength(0);
  });

  it('is added hidden, after the last one, with its slug made from the name', async () => {
    const OILS = {
      ...HAIR,
      id: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
      name: 'Hair Oils',
      slug: 'hair-oils',
      isActive: false,
      position: 3,
    };
    const { user, api } = await openPage({
      answers: {
        [LIST]: [listOf(ALL), listOf([...ALL, OILS])],
        [CREATE]: () => json(201, OILS),
      },
    });
    await waitForList();

    await user.click(screen.getByRole('button', { name: 'New category' }));
    const dialog = screen.getByRole('dialog', { name: 'New category' });
    await user.type(within(dialog).getByLabelText('Name'), '  Hair Oils ');

    expect(within(dialog).getByLabelText('Slug')).toHaveAccessibleDescription(
      'Leave empty to use “hair-oils”.',
    );
    expect(
      within(dialog).getByRole('switch', { name: 'Customers see it' }),
    ).not.toBeChecked();
    await user.click(
      within(dialog).getByRole('button', { name: 'Add category' }),
    );

    expect(await screen.findByText('Hair Oils added')).toBeInTheDocument();
    await waitFor(() => expect(rowNames()).toContain('Hair Oils'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.to('POST', '/v1/staff/categories')[0]?.body).toEqual({
      name: 'Hair Oils',
      description: null,
      isActive: false,
      position: 3,
    });
  });

  it('shows what the API refused next to its field', async () => {
    const { user } = await openPage({
      answers: {
        [CREATE]: () =>
          json(400, {
            message: 'Validation failed',
            errors: [
              { field: 'description', message: 'At most 500 characters' },
            ],
          }),
      },
    });
    await waitForList();

    await user.click(screen.getByRole('button', { name: 'New category' }));
    const dialog = screen.getByRole('dialog', { name: 'New category' });
    await user.type(within(dialog).getByLabelText('Name'), 'Hair Oils');
    await user.click(
      within(dialog).getByRole('button', { name: 'Add category' }),
    );

    const description = within(dialog).getByLabelText('Description');
    await waitFor(() =>
      expect(description).toHaveAccessibleDescription(
        'Optional. At most 500 characters',
      ),
    );
    expect(description).toHaveFocus();
  });

  it('keeps the dialog open with the reason when the slug is taken', async () => {
    const { user } = await openPage({
      answers: {
        [CREATE]: () =>
          json(409, {
            message:
              'Another category already has this slug. Choose a different one.',
          }),
      },
    });
    await waitForList();

    await user.click(screen.getByRole('button', { name: 'New category' }));
    const dialog = screen.getByRole('dialog', { name: 'New category' });
    await user.type(within(dialog).getByLabelText('Name'), 'Hair Care');
    await user.click(
      within(dialog).getByRole('button', { name: 'Add category' }),
    );

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Another category already has this slug. Choose a different one.',
    );
    expect(dialog).toHaveAttribute('open');
  });
});

describe('changing a category', () => {
  it('sends only what changed', async () => {
    const changed = { ...SKIN, description: 'Creams, oils and soaps' };
    const { user, api } = await openPage({
      answers: { [PATCH(SKIN)]: () => json(200, changed) },
    });
    await waitForList();

    await user.click(screen.getByRole('button', { name: 'Edit Skin Care' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Skin Care' });
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Skin Care');
    const description = within(dialog).getByLabelText('Description');
    await user.clear(description);
    await user.type(description, 'Creams, oils and soaps');
    await user.click(
      within(dialog).getByRole('button', { name: 'Save changes' }),
    );

    expect(await screen.findByText('Skin Care saved')).toBeInTheDocument();
    expect(screen.getByText('Creams, oils and soaps')).toBeInTheDocument();
    expect(api.to('PATCH', `/v1/staff/categories/${SKIN.id}`)[0]?.body).toEqual(
      {
        description: 'Creams, oils and soaps',
      },
    );
  });

  it('warns that a new slug changes the web address', async () => {
    const { user } = await openPage();
    await waitForList();

    await user.click(screen.getByRole('button', { name: 'Edit Hair Care' }));
    const slug = within(
      screen.getByRole('dialog', { name: 'Edit Hair Care' }),
    ).getByLabelText('Slug');
    expect(slug).toHaveAccessibleDescription(
      "Part of the category's web address.",
    );

    await user.type(slug, '-and-scalp');

    expect(slug).toHaveAccessibleDescription(
      "Changing it changes the category's web address: old links to it stop working.",
    );
  });

  it('sends nothing when nothing changed', async () => {
    const { user, api } = await openPage();
    await waitForList();

    await user.click(screen.getByRole('button', { name: 'Edit Hair Care' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(api.to('PATCH', `/v1/staff/categories/${HAIR.id}`)).toHaveLength(0);
  });
});

describe('showing and hiding a category', () => {
  it('flips at once, and says so', async () => {
    const { user, api } = await openPage({
      answers: { [PATCH(SKIN)]: () => json(200, { ...SKIN, isActive: true }) },
    });
    await waitForList();
    const toggle = screen.getByRole('switch', {
      name: 'Customers see Skin Care',
    });

    await user.click(toggle);

    expect(
      await screen.findByText('Skin Care is now shown to customers'),
    ).toBeInTheDocument();
    expect(toggle).toBeChecked();
    expect(toggle).toHaveFocus();
    expect(api.to('PATCH', `/v1/staff/categories/${SKIN.id}`)[0]?.body).toEqual(
      {
        isActive: true,
      },
    );
  });

  it('ignores clicks while its change is on the way', async () => {
    const answer = heldBack();
    const { user, api } = await openPage({
      answers: { [PATCH(SKIN)]: answer.answer },
    });
    await waitForList();
    const toggle = screen.getByRole('switch', {
      name: 'Customers see Skin Care',
    });

    await user.click(toggle);
    await user.click(toggle);
    await user.click(toggle);

    expect(toggle).toBeChecked();
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    expect(api.to('PATCH', `/v1/staff/categories/${SKIN.id}`)).toHaveLength(1);
    await act(async () =>
      answer.release(json(200, { ...SKIN, isActive: true })),
    );
    expect(
      await screen.findByText('Skin Care is now shown to customers'),
    ).toBeInTheDocument();
  });

  it('goes back when the change is refused', async () => {
    const { user } = await openPage({
      answers: { [PATCH(SKIN)]: () => json(403, { message: 'Forbidden' }) },
    });
    await waitForList();
    const toggle = screen.getByRole('switch', {
      name: 'Customers see Skin Care',
    });

    await user.click(toggle);

    expect(
      await screen.findByText("Your role can't do this."),
    ).toBeInTheDocument();
    expect(toggle).not.toBeChecked();
  });
});

describe('ordering with the keyboard', () => {
  it('moves a category with the arrow keys, keeps the focus, says where it went, and saves', async () => {
    const { user, api } = await openPage({
      answers: { [ORDER]: listOf([SKIN, HAIR, TEAS]) },
    });
    await waitForList();
    const handle = screen.getByRole('button', { name: 'Move Hair Care' });
    expect(handle).toHaveAccessibleDescription(
      expect.stringContaining('press Up or Down to move a category one place'),
    );

    handle.focus();
    await user.keyboard('{ArrowDown}');

    expect(rowNames()).toEqual(['Skin Care', 'Hair Care', 'Herbal Teas']);
    expect(
      screen.getByRole('button', { name: 'Move Hair Care' }),
    ).toHaveFocus();
    expect(
      screen.getByText('Hair Care moved to position 2 of 3.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Order saved')).toBeInTheDocument();
    expect(api.to('PUT', '/v1/staff/categories/order')[0]?.body).toEqual({
      ids: [SKIN.id, HAIR.id, TEAS.id],
    });
  });

  it('keeps the focus on the handle in a browser, which drops it from a moved row', async () => {
    const { user } = await openPage({
      answers: {
        [ORDER]: [listOf([SKIN, HAIR, TEAS]), listOf([SKIN, TEAS, HAIR])],
      },
    });
    await waitForList();
    dropFocusOnMove();

    screen.getByRole('button', { name: 'Move Hair Care' }).focus();
    await user.keyboard('{ArrowDown}');
    expect(
      screen.getByRole('button', { name: 'Move Hair Care' }),
    ).toHaveFocus();

    await user.keyboard('{End}');
    expect(rowNames()).toEqual(['Skin Care', 'Herbal Teas', 'Hair Care']);
    expect(
      screen.getByRole('button', { name: 'Move Hair Care' }),
    ).toHaveFocus();
  });

  it('keeps the arrow keys it uses from scrolling the page', async () => {
    await openPage({ answers: { [ORDER]: listOf([SKIN, HAIR, TEAS]) } });
    await waitForList();
    const handle = screen.getByRole('button', { name: 'Move Herbal Teas' });

    // fireEvent answers false when the key's own action was stopped.
    expect(fireEvent.keyDown(handle, { key: 'ArrowDown' })).toBe(false);
    expect(fireEvent.keyDown(handle, { key: 'Home' })).toBe(false);
    expect(fireEvent.keyDown(handle, { key: 'Tab' })).toBe(true);
    expect(fireEvent.keyDown(handle, { key: 'a' })).toBe(true);
  });

  it('moves to the bottom with End and the top with Home, and not past either', async () => {
    const { user, api } = await openPage({
      answers: {
        [ORDER]: [listOf([SKIN, TEAS, HAIR]), listOf([HAIR, SKIN, TEAS])],
      },
    });
    await waitForList();

    screen.getByRole('button', { name: 'Move Hair Care' }).focus();
    await user.keyboard('{ArrowUp}');
    expect(api.to('PUT', '/v1/staff/categories/order')).toHaveLength(0);

    await user.keyboard('{End}');
    expect(rowNames()).toEqual(['Skin Care', 'Herbal Teas', 'Hair Care']);
    await screen.findByText('Order saved');

    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Home}');

    expect(rowNames()).toEqual(['Hair Care', 'Skin Care', 'Herbal Teas']);
    expect(
      screen.getByText('Hair Care moved to position 1 of 3.'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(api.to('PUT', '/v1/staff/categories/order')).toHaveLength(2),
    );
  });

  it('sends moves made while saving afterwards, as their latest order only', async () => {
    const first = heldBack();
    const { user, api } = await openPage({
      answers: { [ORDER]: [first.answer, listOf([SKIN, TEAS, HAIR])] },
    });
    await waitForList();

    screen.getByRole('button', { name: 'Move Hair Care' }).focus();
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowDown}');

    expect(screen.getByText('Saving the order…')).toBeInTheDocument();
    expect(rowNames()).toEqual(['Skin Care', 'Herbal Teas', 'Hair Care']);
    expect(api.to('PUT', '/v1/staff/categories/order')).toHaveLength(1);

    await act(async () => {
      first.release(json(200, { categories: [SKIN, HAIR, TEAS] }));
    });

    await screen.findByText('Order saved');
    const sent = api.to('PUT', '/v1/staff/categories/order');
    expect(sent.map((request) => request.body)).toEqual([
      { ids: [SKIN.id, HAIR.id, TEAS.id] },
      { ids: [SKIN.id, TEAS.id, HAIR.id] },
    ]);
    expect(rowNames()).toEqual(['Skin Care', 'Herbal Teas', 'Hair Care']);
  });

  it('goes back to the saved order when the categories changed meanwhile', async () => {
    const { user } = await openPage({
      answers: {
        [LIST]: [listOf(ALL), listOf([TEAS, HAIR, SKIN])],
        [ORDER]: () =>
          json(409, {
            message:
              'The categories changed while you were ordering them. Reload and try again.',
          }),
      },
    });
    await waitForList();

    screen.getByRole('button', { name: 'Move Hair Care' }).focus();
    await user.keyboard('{ArrowDown}');

    expect(
      await screen.findByText(
        'The categories changed while you were ordering them. Reload and try again.',
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(rowNames()).toEqual(['Herbal Teas', 'Hair Care', 'Skin Care']),
    );
  });
});

describe('deleting a category (Super Users)', () => {
  it('explains what is lost, and deletes it', async () => {
    const { user, api } = await openPage({
      staff: RAVI,
      answers: {
        // The list read again after the delete never comes back.
        [LIST]: [listOf(ALL), () => new Promise<Response>(() => undefined)],
        [HAS_PRODUCTS(TEAS)]: () =>
          json(200, { products: [], nextAfter: null }),
        [`DELETE /v1/staff/categories/${TEAS.id}`]: () =>
          new Response(null, { status: 204 }),
      },
    });
    await waitForList();

    await user.click(
      screen.getByRole('button', { name: 'Delete Herbal Teas' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Delete Herbal Teas?' });
    expect(dialog).toHaveAccessibleDescription(
      expect.stringContaining('It is removed for good'),
    );
    const remove = within(dialog).getByRole('button', {
      name: 'Delete for good',
    });
    await waitFor(() => expect(remove).toBeEnabled());
    await user.click(remove);

    expect(await screen.findByText('Herbal Teas deleted')).toBeInTheDocument();
    await waitFor(() => expect(rowNames()).toEqual(['Hair Care', 'Skin Care']));
    expect(api.to('DELETE', `/v1/staff/categories/${TEAS.id}`)).toHaveLength(1);
  });

  it('cannot delete a category that still has products', async () => {
    const { user, api } = await openPage({
      staff: RAVI,
      answers: {
        [HAS_PRODUCTS(HAIR)]: () =>
          json(200, { products: [OIL], nextAfter: null }),
      },
    });
    await waitForList();

    await user.click(screen.getByRole('button', { name: 'Delete Hair Care' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete Hair Care?' });

    expect(
      await within(dialog).findByText(
        /It still has products, so it can't be deleted/,
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'Delete for good' }),
    ).toBeDisabled();
    expect(api.unexpected).toEqual([]);
  });

  it('offers hiding it instead', async () => {
    const { user, api } = await openPage({
      staff: RAVI,
      answers: {
        [HAS_PRODUCTS(HAIR)]: () =>
          json(200, { products: [], nextAfter: null }),
        [PATCH(HAIR)]: () => json(200, { ...HAIR, isActive: false }),
      },
    });
    await waitForList();

    await user.click(screen.getByRole('button', { name: 'Delete Hair Care' }));
    await user.click(screen.getByRole('button', { name: 'Hide it instead' }));

    expect(
      await screen.findByText('Hair Care is now hidden from customers'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: 'Customers see Hair Care' }),
    ).not.toBeChecked();
    expect(api.to('PATCH', `/v1/staff/categories/${HAIR.id}`)[0]?.body).toEqual(
      {
        isActive: false,
      },
    );
  });

  it('keeps the dialog open with the reason when the API refuses', async () => {
    const { user } = await openPage({
      staff: RAVI,
      answers: {
        [HAS_PRODUCTS(SKIN)]: () =>
          json(200, { products: [], nextAfter: null }),
        [`DELETE /v1/staff/categories/${SKIN.id}`]: () =>
          json(409, {
            message:
              'This category still has products. Move them to another category or delete them first.',
          }),
      },
    });
    await waitForList();

    await user.click(screen.getByRole('button', { name: 'Delete Skin Care' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete Skin Care?' });
    expect(
      within(dialog).queryByRole('button', { name: 'Hide it instead' }),
    ).not.toBeInTheDocument();
    const remove = within(dialog).getByRole('button', {
      name: 'Delete for good',
    });
    await waitFor(() => expect(remove).toBeEnabled());
    await user.click(remove);

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This category still has products.',
    );
    expect(dialog).toHaveAttribute('open');
  });
});
