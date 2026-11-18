import { describe, expect, it } from 'vitest';
import { setAccessToken } from '../api/access-token';
import { ApiError } from '../api/api-error';
import { ML_100, SHAMPOO } from '../test/catalog-fixtures';
import { fakeApi, json } from '../test/fake-api';
import {
  LATER,
  LINES,
  MOVEMENT,
  SOON,
  stockLine,
} from '../test/stock-fixtures';
import {
  addMovement,
  countBatch,
  listBatches,
  listMovements,
  listProductStock,
  listStock,
  receiveBatch,
  updateBatch,
} from './stock-api';

const BATCH_FIELDS = {
  batchNumber: 'AS2610',
  manufacturedOn: '2026-10-01',
  expiresOn: '2028-09-30',
  quantity: 30,
  note: null,
};

function signedIn() {
  setAccessToken('t1');
}

describe('the Stock page', () => {
  it('asks for a page with only the filters given', async () => {
    signedIn();
    const api = fakeApi({
      'GET /v1/staff/stock': () =>
        json(200, { lines: LINES, nextAfter: ML_100.id }),
      [`GET /v1/staff/stock?status=low&productId=${SHAMPOO.id}&q=amla+100%25&after=${ML_100.id}&limit=25`]:
        () => json(200, { lines: [], nextAfter: null }),
    });

    await expect(listStock({})).resolves.toEqual({
      lines: LINES,
      nextAfter: ML_100.id,
    });
    await expect(
      listStock({
        status: 'low',
        productId: SHAMPOO.id,
        q: 'amla 100%',
        after: ML_100.id,
        limit: 25,
      }),
    ).resolves.toEqual({ lines: [], nextAfter: null });
    expect(api.unexpected).toEqual([]);
    expect(api.sent.every((r) => r.authorization === 'Bearer t1')).toBe(true);
  });

  it("reads every page of one product's pack sizes", async () => {
    signedIn();
    const [first, second, third] = LINES;
    const api = fakeApi({
      [`GET /v1/staff/stock?productId=${SHAMPOO.id}&limit=100`]: () =>
        json(200, { lines: [first, second], nextAfter: ML_100.id }),
      [`GET /v1/staff/stock?productId=${SHAMPOO.id}&after=${ML_100.id}&limit=100`]:
        () => json(200, { lines: [third], nextAfter: null }),
    });

    await expect(listProductStock(SHAMPOO.id)).resolves.toEqual(LINES);
    expect(api.sent).toHaveLength(2);
  });

  it.each([
    ['a level it does not know', { level: 'EMPTY' }],
    ['a day that is not one', { stopsSellingOn: '1 Dec 2026' }],
    ['packs that are not whole', { free: 2.5 }],
  ])('refuses %s', async (_, stock) => {
    signedIn();
    fakeApi({
      'GET /v1/staff/stock': () =>
        json(200, {
          lines: [stockLine(ML_100, { ...LINES[0]?.stock, ...stock })],
          nextAfter: null,
        }),
    });

    await expect(listStock({})).rejects.toThrow(
      'The server sent an answer the console does not understand.',
    );
  });
});

describe('a pack size on the Stock page', () => {
  it('refuses a unit it does not know', async () => {
    signedIn();
    const line = stockLine(ML_100);
    fakeApi({
      'GET /v1/staff/stock': () =>
        json(200, {
          lines: [{ ...line, variant: { ...line.variant, unit: 'BOTTLES' } }],
          nextAfter: null,
        }),
    });

    await expect(listStock({})).rejects.toThrow(
      'The server sent an answer the console does not understand.',
    );
  });
});

describe('the batches', () => {
  it('lists a pack size’s batches with its stock', async () => {
    signedIn();
    const list = { ...stockLine(ML_100), batches: [SOON, LATER] };
    fakeApi({
      [`GET /v1/staff/variants/${ML_100.id}/batches`]: () =>
        json(200, { ...list, quantity: 40, sellableQuantity: 40 }),
    });

    // As before part 12D, the API also sends quantity and sellableQuantity:
    // the console reads the stock's sums instead.
    await expect(listBatches(ML_100.id)).resolves.toEqual(list);
  });

  it('receives one, corrects its label, changes its stock and counts it', async () => {
    signedIn();
    const api = fakeApi({
      [`POST /v1/staff/variants/${ML_100.id}/batches`]: () => json(201, LATER),
      [`PATCH /v1/staff/batches/${LATER.id}`]: () =>
        json(200, { ...LATER, batchNumber: 'AS2611' }),
      [`POST /v1/staff/batches/${LATER.id}/movements`]: () =>
        json(201, { ...LATER, quantity: 28, onShelf: 30 }),
      [`POST /v1/staff/batches/${LATER.id}/count`]: () =>
        json(200, {
          batch: { ...LATER, quantity: 27, onShelf: 29 },
          change: -1,
        }),
    });

    await expect(receiveBatch(ML_100.id, BATCH_FIELDS)).resolves.toEqual(LATER);
    await expect(
      updateBatch(LATER.id, { batchNumber: 'AS2611' }),
    ).resolves.toMatchObject({ batchNumber: 'AS2611' });
    await expect(
      addMovement(LATER.id, { change: -2, reason: 'DAMAGED', note: null }),
    ).resolves.toMatchObject({ quantity: 28 });
    await expect(
      countBatch(LATER.id, { counted: 29, onShelf: 30, note: 'One missing' }),
    ).resolves.toEqual({
      batch: { ...LATER, quantity: 27, onShelf: 29 },
      change: -1,
    });

    expect(api.sent.map((request) => [request.method, request.body])).toEqual([
      ['POST', BATCH_FIELDS],
      ['PATCH', { batchNumber: 'AS2611' }],
      ['POST', { change: -2, reason: 'DAMAGED', note: null }],
      ['POST', { counted: 29, onShelf: 30, note: 'One missing' }],
    ]);
  });

  it('passes on the API’s refusal of a count that went stale', async () => {
    signedIn();
    const stale =
      "This batch's stock changed while you were counting. Check the new numbers and count again.";
    fakeApi({
      [`POST /v1/staff/batches/${LATER.id}/count`]: () =>
        json(409, { message: stale }),
    });

    await expect(
      countBatch(LATER.id, { counted: 30, onShelf: 32 }),
    ).rejects.toEqual(new ApiError(409, stale));
  });

  it('reads movements newest first, a page at a time', async () => {
    signedIn();
    const api = fakeApi({
      [`GET /v1/staff/batches/${LATER.id}/movements`]: () =>
        json(200, { movements: [MOVEMENT], nextBefore: MOVEMENT.id }),
      [`GET /v1/staff/batches/${LATER.id}/movements?before=${MOVEMENT.id}&limit=20`]:
        () => json(200, { movements: [], nextBefore: null }),
    });

    await expect(listMovements(LATER.id)).resolves.toEqual({
      movements: [MOVEMENT],
      nextBefore: MOVEMENT.id,
    });
    await expect(
      listMovements(LATER.id, { before: MOVEMENT.id, limit: 20 }),
    ).resolves.toEqual({ movements: [], nextBefore: null });
    expect(api.unexpected).toEqual([]);
  });

  it('refuses a reason it does not know', async () => {
    signedIn();
    fakeApi({
      [`GET /v1/staff/batches/${LATER.id}/movements`]: () =>
        json(200, {
          movements: [{ ...MOVEMENT, reason: 'STOLEN' }],
          nextBefore: null,
        }),
    });

    await expect(listMovements(LATER.id)).rejects.toThrow(
      'The server sent an answer the console does not understand.',
    );
  });
});

describe('an ID from the address bar', () => {
  it.each([
    ['..'],
    ['../../auth/logout'],
    [`${LATER.id}/../..`],
    [`${LATER.id}?limit=1`],
    ['%2e%2e'],
    [''],
  ])('never reaches the path: %j', async (id) => {
    signedIn();
    const api = fakeApi({});

    const reads = [
      listBatches(id),
      receiveBatch(id, BATCH_FIELDS),
      updateBatch(id, { batchNumber: 'X1' }),
      listMovements(id),
      addMovement(id, { change: 1, reason: 'RECEIVED' }),
      countBatch(id, { counted: 1, onShelf: 1 }),
    ];

    for (const read of reads) {
      await expect(read).rejects.toEqual(
        new ApiError(404, 'There is no such item.'),
      );
    }
    expect(api.sent).toEqual([]);
  });
});
