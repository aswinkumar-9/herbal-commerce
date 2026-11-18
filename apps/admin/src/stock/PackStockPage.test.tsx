import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ML_100, SHAMPOO } from '../test/catalog-fixtures';
import { heldBack, openSignedIn } from '../test/console';
import { json } from '../test/fake-api';
import {
  BATCHES,
  LATER,
  LINES,
  MOVEMENT,
  MOVEMENTS,
  SOON,
  batchesOf,
} from '../test/stock-fixtures';

// 18 November 2026, 10:00 in India. Only the clock is fixed: timers run,
// so typing and waiting work as they do for staff.
const NOW = new Date('2026-11-18T04:30:00.000Z');

// An expired batch with nothing left in it.
const GONE = {
  ...SOON,
  id: '4c5d6e7f-8a9b-4c0d-9e1f-3a4b5c6d7e8f',
  batchNumber: 'AS2401',
  manufacturedOn: '2024-01-01',
  expiresOn: '2026-06-30',
  quantity: 0,
  sellable: false,
  stopsSellingOn: '2025-12-31',
  onShelf: 0,
};

const PAGE = `/stock/${ML_100.id}`;
const COUNT = (batch: { id: string }) =>
  `POST /v1/staff/batches/${batch.id}/count`;
const MOVE = (batch: { id: string }) =>
  `POST /v1/staff/batches/${batch.id}/movements`;
const RECEIVE = `POST /v1/staff/variants/${ML_100.id}/batches`;
const STALE =
  "This batch's stock changed while you were counting. Check the new numbers and count again.";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});

async function openPack(
  options: Parameters<typeof openSignedIn>[1] = {},
  path: Parameters<typeof openSignedIn>[0] = PAGE,
) {
  const console = openSignedIn(path, {
    ...options,
    answers: {
      [BATCHES(ML_100)]: batchesOf(ML_100, [SOON, LATER, GONE]),
      ...options.answers,
    },
  });
  await screen.findByRole('heading', {
    name: 'Amla Shampoo · 100 ml',
    level: 1,
  });
  return console;
}

function card(number: string) {
  const found = screen
    .getAllByRole('listitem')
    .find(
      (item) =>
        within(item).queryByRole('heading', { level: 3 })?.textContent ===
        `Batch ${number}`,
    );
  if (!found) {
    throw new Error(`No batch ${number}`);
  }
  return found;
}

async function openDialog(action: string, number: string, title: string) {
  fireEvent.click(
    screen.getByRole('button', { name: `${action} batch ${number}` }),
  );
  return screen.findByRole('dialog', { name: title });
}

describe("a pack size's stock", () => {
  it('opens from the Stock page, and goes back to it as it was left', async () => {
    const { user, router } = openSignedIn('/stock?status=low', {
      answers: {
        'GET /v1/staff/stock?status=low': () =>
          json(200, { lines: [LINES[0]], nextAfter: null }),
        [BATCHES(ML_100)]: batchesOf(ML_100, [SOON, LATER]),
      },
    });

    await user.click(
      await screen.findByRole('link', { name: '100 ml, Amla Shampoo' }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Amla Shampoo · 100 ml' }),
    ).toBeInTheDocument();
    expect(document.title).toBe(
      'Amla Shampoo · 100 ml · Herbal Commerce Admin',
    );
    await user.click(
      within(screen.getByRole('main')).getByRole('link', { name: 'Stock' }),
    );

    expect(router.state.location.pathname).toBe('/stock');
    expect(router.state.location.search).toBe('?status=low');
  });

  it('shows the pack size, its stock and its batches, the first to expire first', async () => {
    await openPack();

    expect(screen.getByText('AML-SHA-100')).toBeInTheDocument();
    expect(
      screen.getByText(
        '40 packs may be sold · 2 packs for orders to pack · 1 pack packed for shipping',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Shown as low at 10 packs or fewer that may be sold\./),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Change it on the product’s page' }),
    ).toHaveAttribute('href', `/catalog/products/${SHAMPOO.id}`);

    const list = screen.getByRole('list', { name: 'Batches in stock' });
    expect(
      within(list)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(['Batch AS2511', 'Batch AS2610']);
    expect(card('AS2511')).toHaveTextContent('Stops selling soon');
    expect(card('AS2511')).toHaveTextContent(
      'Made 1 Nov 2025 · Expires 1 Jun 2027 · Stops selling on 2 Dec 2026',
    );
    expect(card('AS2610')).not.toHaveTextContent('Stops selling soon');
    const figures = within(card('AS2610'))
      .getAllByRole('definition')
      .map((figure) => figure.textContent);
    expect(figures).toEqual(['30', '2', '32', '1']);
    expect(
      within(card('AS2610'))
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual([
      'Free to sell',
      'For orders to pack',
      'On the shelf',
      'Packed for shipping',
    ]);
  });

  it('keeps empty batches out of the way until asked', async () => {
    const { user } = await openPack();

    const toggle = screen.getByRole('button', { name: '1 empty batch' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByRole('list', { name: 'Empty batches' }),
    ).not.toBeInTheDocument();
    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const empty = screen.getByRole('list', { name: 'Empty batches' });
    expect(within(empty).getByRole('heading')).toHaveTextContent(
      'Batch AS2401',
    );
    expect(card('AS2401')).toHaveTextContent('Expired');
    expect(card('AS2401')).toHaveTextContent('Expired on 30 Jun 2026');
  });

  it('says a pack size never shows as low at 0', async () => {
    await openPack({
      answers: {
        [BATCHES(ML_100)]: () =>
          json(200, {
            variant: { ...LINES[0]?.variant, lowStockAt: 0, isActive: false },
            product: { id: SHAMPOO.id, name: SHAMPOO.name, isActive: false },
            stock: LINES[0]?.stock,
            batches: [LATER],
          }),
      },
    });

    expect(screen.getByText(/Never shown as low\./)).toBeInTheDocument();
    const header = screen.getByRole('heading', { level: 1 }).parentElement;
    expect(header).toHaveTextContent('Draft');
    expect(header).toHaveTextContent('Off sale');
  });

  it('invites the first delivery when there is no batch', async () => {
    await openPack({ answers: { [BATCHES(ML_100)]: batchesOf(ML_100, []) } });

    expect(screen.getByText('No batches yet')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Receive the first delivery' }),
    );
    expect(
      await screen.findByRole('dialog', { name: 'Receive a delivery' }),
    ).toBeInTheDocument();
  });

  it('says when every batch is empty', async () => {
    await openPack({
      answers: { [BATCHES(ML_100)]: batchesOf(ML_100, [GONE]) },
    });

    expect(screen.getByText('Nothing in stock')).toBeInTheDocument();
    expect(
      screen.getByText('Every batch of this pack size is empty.'),
    ).toBeInTheDocument();
  });

  it('says when there is no such pack size, and asks nothing for an ID that is not one', async () => {
    openSignedIn(PAGE, {
      answers: {
        [BATCHES(ML_100)]: () => json(404, { message: 'Pack size not found' }),
      },
    });
    expect(
      await screen.findByText('There is no such pack size'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Back to the stock' }),
    ).toHaveAttribute('href', '/stock');
  });

  it('goes back to the product it was opened from, even when there is no such pack size', async () => {
    openSignedIn(
      {
        pathname: PAGE,
        state: { product: { id: SHAMPOO.id, name: SHAMPOO.name } },
      },
      {
        answers: {
          [BATCHES(ML_100)]: () =>
            json(404, { message: 'Pack size not found' }),
        },
      },
    );

    expect(
      await screen.findByText('There is no such pack size'),
    ).toBeInTheDocument();
    const main = within(screen.getByRole('main'));
    expect(main.getByRole('link', { name: SHAMPOO.name })).toHaveAttribute(
      'href',
      `/catalog/products/${SHAMPOO.id}`,
    );
    expect(
      main.getByRole('link', { name: 'Back to the product' }),
    ).toHaveAttribute('href', `/catalog/products/${SHAMPOO.id}`);
  });

  it('goes back to the Stock page when what it was given is not a product', async () => {
    await openPack(
      {},
      {
        pathname: PAGE,
        state: { product: { id: SHAMPOO.id, name: 42 } },
      },
    );

    expect(
      within(screen.getByRole('main')).getByRole('link', { name: 'Stock' }),
    ).toHaveAttribute('href', '/stock');
  });

  it('asks nothing for an ID in the address that is not one', async () => {
    const { api } = openSignedIn('/stock/..%2F..%2Fauth');

    expect(
      await screen.findByText('There is no such pack size'),
    ).toBeInTheDocument();
    expect(api.sent.map((request) => request.path)).not.toContainEqual(
      expect.stringContaining('/batches'),
    );
  });

  it('says when the batches could not be loaded, and tries again', async () => {
    openSignedIn(PAGE, {
      answers: {
        [BATCHES(ML_100)]: [
          () => json(500, { message: 'Internal server error' }),
          batchesOf(ML_100, [LATER]),
        ],
      },
    });

    expect(
      await screen.findByText('The batches could not be loaded'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { name: 'Batch AS2610' }),
    ).toBeInTheDocument();
  });
});

describe('receiving a delivery', () => {
  const NEW = {
    ...LATER,
    id: '5d6e7f8a-9b0c-4d1e-8f2a-4b5c6d7e8f9a',
    batchNumber: 'AS2611',
    manufacturedOn: '2026-11-01',
    expiresOn: '2028-10-31',
    quantity: 120,
    stopsSellingOn: '2028-05-01',
    awaitingPacking: 0,
    packed: 0,
    onShelf: 120,
  };

  it('checks it first, then adds the batch where it expires', async () => {
    const { user, api } = await openPack({
      answers: {
        [BATCHES(ML_100)]: [
          batchesOf(ML_100, [SOON, LATER]),
          batchesOf(ML_100, [SOON, LATER, NEW]),
        ],
        [RECEIVE]: () => json(201, NEW),
      },
    });
    await user.click(
      screen.getByRole('button', { name: 'Receive a delivery' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Receive a delivery' });

    await user.click(within(dialog).getByRole('button', { name: 'Receive' }));
    expect(within(dialog).getByLabelText('Batch number')).toHaveFocus();
    expect(
      within(dialog).getByLabelText('Packs received'),
    ).toHaveAccessibleDescription(
      expect.stringContaining('Enter how many packs came'),
    );

    await user.type(within(dialog).getByLabelText('Batch number'), ' as 2611 ');
    fireEvent.change(within(dialog).getByLabelText('Manufactured on'), {
      target: { value: '2026-11-01' },
    });
    const expires = within(dialog).getByLabelText('Expires on');
    fireEvent.change(expires, { target: { value: '2027-05-01' } });
    expect(expires).toHaveAccessibleDescription(
      'Under 6 months left: this batch will not be sold.',
    );
    fireEvent.change(expires, { target: { value: '2028-10-31' } });
    expect(expires).toHaveAccessibleDescription('As printed on the label.');
    await user.type(within(dialog).getByLabelText('Packs received'), '120');
    await user.type(
      within(dialog).getByLabelText('Note (optional)'),
      'Invoice 42',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Receive' }));

    expect(
      await screen.findByText('Batch AS2611 received: 120 packs'),
    ).toBeInTheDocument();
    expect(api.to('POST', `/v1/staff/variants/${ML_100.id}/batches`)).toEqual([
      expect.objectContaining({
        body: {
          batchNumber: 'AS2611',
          manufacturedOn: '2026-11-01',
          expiresOn: '2028-10-31',
          quantity: 120,
          note: 'Invoice 42',
        },
      }),
    ]);
    expect(
      within(screen.getByRole('list', { name: 'Batches in stock' }))
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(['Batch AS2511', 'Batch AS2610', 'Batch AS2611']);
    expect(
      screen.queryByRole('dialog', { name: 'Receive a delivery' }),
    ).not.toBeInTheDocument();
  });

  it('marks a batch number the pack size has already, and a date the API refused', async () => {
    const { user } = await openPack({
      answers: {
        [RECEIVE]: [
          () =>
            json(409, {
              message: 'This pack size already has a batch with this number.',
            }),
          () =>
            json(400, {
              message: 'Validation failed',
              errors: [
                {
                  field: 'expiresOn',
                  message: 'This batch has already expired',
                },
              ],
            }),
        ],
      },
    });
    await user.click(
      screen.getByRole('button', { name: 'Receive a delivery' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Receive a delivery' });
    await user.type(within(dialog).getByLabelText('Batch number'), 'AS2610');
    fireEvent.change(within(dialog).getByLabelText('Manufactured on'), {
      target: { value: '2026-10-01' },
    });
    fireEvent.change(within(dialog).getByLabelText('Expires on'), {
      target: { value: '2028-09-30' },
    });
    await user.type(within(dialog).getByLabelText('Packs received'), '5');

    await user.click(within(dialog).getByRole('button', { name: 'Receive' }));
    await waitFor(() =>
      expect(
        within(dialog).getByLabelText('Batch number'),
      ).toHaveAccessibleDescription(
        expect.stringContaining(
          'This pack size already has a batch with this number.',
        ),
      ),
    );
    expect(within(dialog).getByLabelText('Batch number')).toHaveFocus();

    await user.click(within(dialog).getByRole('button', { name: 'Receive' }));
    await waitFor(() =>
      expect(
        within(dialog).getByLabelText('Expires on'),
      ).toHaveAccessibleDescription(
        expect.stringContaining('This batch has already expired'),
      ),
    );
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says what went wrong when the server could not be reached', async () => {
    const { user } = await openPack({
      answers: {
        [RECEIVE]: () => json(500, { message: 'Internal server error' }),
      },
    });
    await user.click(
      screen.getByRole('button', { name: 'Receive a delivery' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Receive a delivery' });
    await user.type(within(dialog).getByLabelText('Batch number'), 'AS2611');
    fireEvent.change(within(dialog).getByLabelText('Manufactured on'), {
      target: { value: '2026-11-01' },
    });
    fireEvent.change(within(dialog).getByLabelText('Expires on'), {
      target: { value: '2028-10-31' },
    });
    await user.type(within(dialog).getByLabelText('Packs received'), '5');
    await user.click(within(dialog).getByRole('button', { name: 'Receive' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The server had a problem. Try again in a moment.',
    );
  });
});

describe("correcting a batch's label", () => {
  it('sends only what changed', async () => {
    const { user, api } = await openPack({
      answers: {
        [BATCHES(ML_100)]: [
          batchesOf(ML_100, [SOON, LATER]),
          batchesOf(ML_100, [SOON, { ...LATER, batchNumber: 'AS2612' }]),
        ],
        [`PATCH /v1/staff/batches/${LATER.id}`]: () =>
          json(200, { ...LATER, batchNumber: 'AS2612' }),
      },
    });
    const dialog = await openDialog(
      'Correct label',
      'AS2610',
      'Correct batch AS2610',
    );
    const number = within(dialog).getByLabelText('Batch number');
    expect(number).toHaveValue('AS2610');
    expect(within(dialog).getByLabelText('Expires on')).toHaveValue(
      '2028-09-30',
    );

    await user.clear(number);
    await user.type(number, 'as2612');
    await user.click(
      within(dialog).getByRole('button', { name: 'Save changes' }),
    );

    expect(
      await screen.findByText('Batch AS2612 corrected'),
    ).toBeInTheDocument();
    expect(api.to('PATCH', `/v1/staff/batches/${LATER.id}`)[0]?.body).toEqual({
      batchNumber: 'AS2612',
    });
    expect(card('AS2612')).toBeInTheDocument();
  });

  it('sends nothing when nothing changed, and checks the dates', async () => {
    const { user, api } = await openPack();
    const dialog = await openDialog(
      'Correct label',
      'AS2610',
      'Correct batch AS2610',
    );

    fireEvent.change(within(dialog).getByLabelText('Expires on'), {
      target: { value: '2026-09-30' },
    });
    await user.click(
      within(dialog).getByRole('button', { name: 'Save changes' }),
    );
    expect(
      within(dialog).getByLabelText('Expires on'),
    ).toHaveAccessibleDescription(
      expect.stringContaining(
        'The expiry date must be after the manufacturing date',
      ),
    );
    // A new manufacturing date clears the expiry's mark too.
    fireEvent.change(within(dialog).getByLabelText('Manufactured on'), {
      target: { value: '2026-10-02' },
    });
    expect(
      within(dialog).getByLabelText('Expires on'),
    ).not.toHaveAccessibleDescription(expect.stringContaining('must be after'));
    fireEvent.change(within(dialog).getByLabelText('Manufactured on'), {
      target: { value: '2026-10-01' },
    });
    fireEvent.change(within(dialog).getByLabelText('Expires on'), {
      target: { value: '2028-09-30' },
    });
    await user.click(
      within(dialog).getByRole('button', { name: 'Save changes' }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Correct batch AS2610' }),
      ).not.toBeInTheDocument(),
    );
    expect(api.to('PATCH', `/v1/staff/batches/${LATER.id}`)).toEqual([]);
  });
});

describe("changing a batch's stock", () => {
  it('writes off damaged packs, at most the free ones', async () => {
    const { user, api } = await openPack({
      answers: {
        [BATCHES(ML_100)]: [
          batchesOf(ML_100, [SOON, LATER]),
          batchesOf(ML_100, [SOON, { ...LATER, quantity: 28, onShelf: 30 }]),
        ],
        [MOVE(LATER)]: () => json(201, { ...LATER, quantity: 28, onShelf: 30 }),
      },
    });
    const dialog = await openDialog(
      'Change stock',
      'AS2610',
      'Change the stock of batch AS2610',
    );
    expect(
      within(dialog).getByRole('radio', { name: /Damaged or lost/ }),
    ).toBeChecked();
    const count = within(dialog).getByLabelText('Packs written off');
    expect(count).toHaveAccessibleDescription('From the 30 packs free now.');

    await user.type(count, '31');
    await user.click(within(dialog).getByRole('button', { name: 'Write off' }));
    expect(count).toHaveAccessibleDescription(
      expect.stringContaining('At most 30 packs: the free packs of this batch'),
    );
    await user.clear(count);
    await user.type(count, '2');
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'Leaked');
    await user.click(within(dialog).getByRole('button', { name: 'Write off' }));

    expect(
      await screen.findByText('2 packs written off from batch AS2610'),
    ).toBeInTheDocument();
    expect(api.to('POST', `/v1/staff/batches/${LATER.id}/movements`)).toEqual([
      expect.objectContaining({
        body: { change: -2, reason: 'DAMAGED', note: 'Leaked' },
      }),
    ]);
    expect(
      within(card('AS2610')).getAllByRole('definition')[0],
    ).toHaveTextContent('28');
  });

  it('adds more of the same batch', async () => {
    const { user, api } = await openPack({
      answers: {
        [MOVE(LATER)]: () => json(201, { ...LATER, quantity: 40, onShelf: 42 }),
      },
    });
    const dialog = await openDialog(
      'Change stock',
      'AS2610',
      'Change the stock of batch AS2610',
    );

    await user.click(
      within(dialog).getByRole('radio', { name: /More arrived/ }),
    );
    await user.type(within(dialog).getByLabelText('Packs added'), '10');
    await user.click(within(dialog).getByRole('button', { name: 'Add packs' }));

    expect(
      await screen.findByText('10 packs added to batch AS2610'),
    ).toBeInTheDocument();
    expect(
      api.to('POST', `/v1/staff/batches/${LATER.id}/movements`)[0]?.body,
    ).toEqual({ change: 10, reason: 'RECEIVED', note: null });
  });

  it('only writes off an expired batch', async () => {
    const { user } = await openPack({
      answers: {
        [BATCHES(ML_100)]: batchesOf(ML_100, [
          { ...GONE, quantity: 3, onShelf: 3 },
        ]),
      },
    });
    const dialog = await openDialog(
      'Change stock',
      'AS2401',
      'Change the stock of batch AS2401',
    );

    expect(
      within(dialog).getByRole('radio', { name: /Expired/ }),
    ).toBeChecked();
    expect(
      within(dialog).queryByRole('radio', { name: /More arrived/ }),
    ).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  });

  it('says why the API refused, and shows the batch as it now is', async () => {
    const { user, api } = await openPack({
      answers: {
        [BATCHES(ML_100)]: [
          batchesOf(ML_100, [SOON, LATER]),
          batchesOf(ML_100, [SOON, { ...LATER, quantity: 1, onShelf: 3 }]),
        ],
        [MOVE(LATER)]: () =>
          json(409, { message: 'Not enough stock: this batch holds 1.' }),
      },
    });
    const dialog = await openDialog(
      'Change stock',
      'AS2610',
      'Change the stock of batch AS2610',
    );
    await user.type(within(dialog).getByLabelText('Packs written off'), '5');
    await user.click(within(dialog).getByRole('button', { name: 'Write off' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Not enough stock: this batch holds 1.',
    );
    await waitFor(() =>
      expect(
        within(dialog).getByLabelText('Packs written off'),
      ).toHaveAccessibleDescription('From the 1 pack free now.'),
    );
    expect(
      api.to('GET', `/v1/staff/variants/${ML_100.id}/batches`),
    ).toHaveLength(2);
  });
});

describe('counting a shelf', () => {
  it('says what should be there, and saves a count that matches', async () => {
    const { user, api } = await openPack({
      answers: {
        [COUNT(LATER)]: () => json(200, { batch: LATER, change: 0 }),
      },
    });
    const dialog = await openDialog('Count', 'AS2610', 'Count batch AS2610');

    expect(dialog).toHaveTextContent('Should be on the shelf: 32 packs');
    expect(dialog).toHaveTextContent(
      '30 packs free and 2 packs for orders not yet packed. Leave out the 1 pack already packed in boxes.',
    );
    const counted = within(dialog).getByLabelText('Packs counted');
    await user.type(counted, '32');
    expect(counted).toHaveAccessibleDescription(
      'It matches: nothing will change.',
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Save the count' }),
    );

    expect(
      await screen.findByText(
        'Batch AS2610: the count matches. Nothing changed.',
      ),
    ).toBeInTheDocument();
    expect(
      api.to('POST', `/v1/staff/batches/${LATER.id}/count`)[0]?.body,
    ).toEqual({ counted: 32, onShelf: 32, note: null });
  });

  it('asks why a count differs, then puts the stock right', async () => {
    const { user, api } = await openPack({
      answers: {
        [COUNT(LATER)]: () =>
          json(200, {
            batch: { ...LATER, quantity: 28, onShelf: 30 },
            change: -2,
          }),
      },
    });
    const dialog = await openDialog('Count', 'AS2610', 'Count batch AS2610');
    const counted = within(dialog).getByLabelText('Packs counted');

    await user.type(counted, '30');
    expect(counted).toHaveAccessibleDescription(
      '2 packs fewer than expected: the stock goes down.',
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Save the count' }),
    );
    const note = within(dialog).getByLabelText('Why it differs');
    expect(note).toHaveFocus();
    expect(note).toHaveAccessibleDescription(
      expect.stringContaining('Say why the count differs'),
    );
    await user.type(note, '2 broken');
    await user.click(
      within(dialog).getByRole('button', { name: 'Save the count' }),
    );

    expect(
      await screen.findByText('Batch AS2610 put right: 2 packs fewer'),
    ).toBeInTheDocument();
    expect(
      api.to('POST', `/v1/staff/batches/${LATER.id}/count`)[0]?.body,
    ).toEqual({ counted: 30, onShelf: 32, note: '2 broken' });
  });

  it('refuses fewer than the orders waiting to be packed need', async () => {
    const { user, api } = await openPack();
    const dialog = await openDialog('Count', 'AS2610', 'Count batch AS2610');

    await user.type(within(dialog).getByLabelText('Packs counted'), '1');
    await user.type(within(dialog).getByLabelText('Why it differs'), 'Lost');
    await user.click(
      within(dialog).getByRole('button', { name: 'Save the count' }),
    );

    expect(
      within(dialog).getByLabelText('Packs counted'),
    ).toHaveAccessibleDescription(
      expect.stringContaining(
        'Orders waiting to be packed need 2 packs of this batch',
      ),
    );
    expect(api.to('POST', `/v1/staff/batches/${LATER.id}/count`)).toEqual([]);
  });

  it('counts again when an order took packs meanwhile', async () => {
    const next = heldBack();
    const MOVED = { ...LATER, quantity: 29, awaitingPacking: 3, onShelf: 32 };
    const TAKEN = { ...LATER, quantity: 29, awaitingPacking: 2, onShelf: 31 };
    const { user, api } = await openPack({
      answers: {
        [BATCHES(ML_100)]: [
          batchesOf(ML_100, [SOON, LATER]),
          batchesOf(ML_100, [SOON, TAKEN]),
          batchesOf(ML_100, [SOON, MOVED]),
        ],
        [COUNT(LATER)]: [() => json(409, { message: STALE }), next.answer],
      },
    });
    const dialog = await openDialog('Count', 'AS2610', 'Count batch AS2610');
    await user.type(within(dialog).getByLabelText('Packs counted'), '32');
    await user.click(
      within(dialog).getByRole('button', { name: 'Save the count' }),
    );

    // The server refused it, and the batch is read again: it changed.
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The stock changed while you were counting: 31 packs should now be on the shelf, not 32 packs.',
    );
    // Everything else in the dialog shows the batch as it now is.
    expect(dialog).toHaveTextContent('Should be on the shelf: 31 packs');
    expect(
      within(dialog).getByText(
        '29 packs free and 2 packs for orders not yet packed. Leave out the 1 pack already packed in boxes.',
      ),
    ).toBeVisible();
    expect(
      within(dialog).getByLabelText('Packs counted'),
    ).toHaveAccessibleDescription(
      expect.stringContaining('1 pack more than expected'),
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Save the count' }),
    );
    // Nothing is sent: staff check the count against the new number first.
    expect(api.to('POST', `/v1/staff/batches/${LATER.id}/count`)).toHaveLength(
      1,
    );
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent('Should be on the shelf: 31 packs');
    expect(within(dialog).getByLabelText('Packs counted')).toHaveFocus();
    expect(
      within(dialog).getByLabelText('Packs counted'),
    ).toHaveAccessibleDescription(
      '1 pack more than expected: the stock goes up.',
    );

    await user.clear(within(dialog).getByLabelText('Packs counted'));
    await user.type(within(dialog).getByLabelText('Packs counted'), '31');
    await user.click(
      within(dialog).getByRole('button', { name: 'Save the count' }),
    );
    next.release(json(200, { batch: TAKEN, change: 0 }));

    expect(
      await screen.findByText(
        'Batch AS2610: the count matches. Nothing changed.',
      ),
    ).toBeInTheDocument();
    expect(
      api.to('POST', `/v1/staff/batches/${LATER.id}/count`)[1]?.body,
    ).toEqual({ counted: 31, onShelf: 31, note: null });
  });
});

describe("a batch's history", () => {
  const WRITE_OFF = {
    ...MOVEMENT,
    id: '6e7f8a9b-0c1d-4e2f-9a3b-5c6d7e8f9a0b',
    change: -2,
    reason: 'DAMAGED',
    note: 'Leaked in the van',
    createdAt: '2026-11-17T23:45:00.000Z',
  };

  it('shows what happened, newest first, a page at a time', async () => {
    const { user, api } = await openPack({
      answers: {
        [MOVEMENTS(LATER)]: () =>
          json(200, { movements: [WRITE_OFF], nextBefore: WRITE_OFF.id }),
        [`${MOVEMENTS(LATER)}?before=${WRITE_OFF.id}`]: () =>
          json(200, { movements: [MOVEMENT], nextBefore: null }),
      },
    });
    const toggle = screen.getByRole('button', { name: 'History batch AS2610' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Read only once asked for.
    expect(api.to('GET', `/v1/staff/batches/${LATER.id}/movements`)).toEqual(
      [],
    );

    await user.click(toggle);
    const history = await screen.findByRole('list', {
      name: 'History of batch AS2610, newest first',
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(
      within(card('AS2610')).getByRole('button', { name: 'Show older' }),
    );

    await waitFor(() =>
      expect(
        within(history)
          .getAllByRole('listitem')
          .map((row) => row.textContent),
      ).toEqual([
        '−2Written off: damaged · 18 Nov 2026, 05:15Leaked in the van',
        '+30Received · 1 Nov 2026, 14:30',
      ]),
    );
    expect(
      within(card('AS2610')).queryByRole('button', { name: 'Show older' }),
    ).not.toBeInTheDocument();
  });

  it('says when it could not be loaded, and tries again', async () => {
    const { user } = await openPack({
      answers: {
        [MOVEMENTS(LATER)]: [
          () => json(500, { message: 'Internal server error' }),
          () => json(200, { movements: [MOVEMENT], nextBefore: null }),
        ],
      },
    });
    await user.click(
      screen.getByRole('button', { name: 'History batch AS2610' }),
    );

    expect(await within(card('AS2610')).findByRole('alert')).toHaveTextContent(
      'The history could not be loaded.',
    );
    await user.click(
      within(card('AS2610')).getByRole('button', { name: 'Try again' }),
    );
    expect(
      await screen.findByRole('list', {
        name: 'History of batch AS2610, newest first',
      }),
    ).toHaveTextContent('Received');
  });
});
