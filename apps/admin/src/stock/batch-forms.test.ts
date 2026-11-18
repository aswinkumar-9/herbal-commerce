import { describe, expect, it } from 'vitest';
import { LATER, SOON } from '../test/stock-fixtures';
import type { Batch } from './stock-api';
import {
  NEW_DELIVERY,
  addMonths,
  batchState,
  checkChange,
  checkCount,
  checkLabel,
  checkReceive,
  countHint,
  expiryHint,
  isDay,
  isEmpty,
  labelChanges,
  labelValues,
  tidyBatchNumber,
  toBatchFields,
  toCount,
  toMovement,
  todayInIndia,
} from './batch-forms';
import type { ReceiveValues } from './batch-forms';

// 18 November 2026, 10:00 in India.
const NOW = new Date('2026-11-18T04:30:00.000Z');
const BATCH = LATER as Batch;

const delivery: ReceiveValues = {
  batchNumber: ' as 2611 ',
  manufacturedOn: '2026-11-01',
  expiresOn: '2028-10-31',
  quantity: '1,200',
  note: '  Invoice 42 ',
};

describe('days', () => {
  it('reads today in India, which starts at 18:30 UTC', () => {
    expect(todayInIndia(new Date('2026-11-18T18:29:59.999Z'))).toBe(
      '2026-11-18',
    );
    expect(todayInIndia(new Date('2026-11-18T18:30:00.000Z'))).toBe(
      '2026-11-19',
    );
  });

  it.each([
    ['2028-02-29', true],
    ['2027-02-29', false],
    ['2026-13-01', false],
    ['2026-1-1', false],
    ['', false],
  ])('knows whether %j is a day', (text, day) => {
    expect(isDay(text)).toBe(day);
  });

  it.each([
    ['2026-11-18', 6, '2027-05-18'],
    ['2026-08-31', 6, '2027-02-28'],
    ['2027-08-31', 6, '2028-02-29'],
    ['2026-03-31', -1, '2026-02-28'],
    ['2026-12-15', 1, '2027-01-15'],
  ])('moves %s by %i months to %s', (day, months, moved) => {
    expect(addMonths(day, months)).toBe(moved);
  });
});

describe('where a batch stands', () => {
  it('sells, stops selling soon, no longer sells, or has expired', () => {
    expect(batchState(BATCH, NOW)).toBe('selling');
    expect(batchState(SOON as Batch, NOW)).toBe('soon');
    // Within 30 days, counted in whole days.
    expect(batchState({ ...BATCH, stopsSellingOn: '2026-12-18' }, NOW)).toBe(
      'soon',
    );
    expect(batchState({ ...BATCH, stopsSellingOn: '2026-12-19' }, NOW)).toBe(
      'selling',
    );
    expect(
      batchState({ ...BATCH, sellable: false, expiresOn: '2027-02-01' }, NOW),
    ).toBe('stopped');
    expect(
      batchState({ ...BATCH, sellable: false, expiresOn: '2026-11-18' }, NOW),
    ).toBe('expired');
    expect(
      batchState({ ...BATCH, sellable: false, expiresOn: '2026-11-19' }, NOW),
    ).toBe('stopped');
  });

  it('is empty with nothing in it and nothing held for orders', () => {
    const none = { ...BATCH, quantity: 0, awaitingPacking: 0, packed: 0 };
    expect(isEmpty(none)).toBe(true);
    expect(isEmpty({ ...none, quantity: 1 })).toBe(false);
    expect(isEmpty({ ...none, awaitingPacking: 1 })).toBe(false);
    expect(isEmpty({ ...none, packed: 1 })).toBe(false);
  });
});

describe('receiving a delivery', () => {
  it('passes one filled in right, and sends it tidied', () => {
    expect(checkReceive(delivery, NOW)).toEqual({});
    expect(toBatchFields(delivery)).toEqual({
      batchNumber: 'AS2611',
      manufacturedOn: '2026-11-01',
      expiresOn: '2028-10-31',
      quantity: 1200,
      note: 'Invoice 42',
    });
    expect(toBatchFields({ ...delivery, note: '  ' }).note).toBeNull();
    expect(tidyBatchNumber(' ab 26/11.a-1 ')).toBe('AB26/11.A-1');
  });

  it('asks for every field of an empty one but the note', () => {
    expect(checkReceive(NEW_DELIVERY, NOW)).toEqual({
      batchNumber: 'Enter the batch number',
      manufacturedOn: 'Enter the manufacturing date',
      expiresOn: 'Enter the expiry date',
      quantity: 'Enter how many packs came',
    });
  });

  it.each([
    ['A'.repeat(41), 'A batch number has at most 40 characters'],
    ['/AB1', 'A batch number has letters, digits, "/", "." and "-"'],
    ['AB_1', 'A batch number has letters, digits, "/", "." and "-"'],
    ['   ', 'Enter the batch number'],
  ])('refuses the batch number %j', (batchNumber, message) => {
    expect(checkReceive({ ...delivery, batchNumber }, NOW)).toEqual({
      batchNumber: message,
    });
  });

  it('takes a batch number of 40 characters once its spaces are gone', () => {
    expect(
      checkReceive({ ...delivery, batchNumber: ` ${'A'.repeat(40)} ` }, NOW),
    ).toEqual({});
  });

  it('checks the dates as the API does', () => {
    expect(
      checkReceive({ ...delivery, manufacturedOn: '2026-11-19' }, NOW),
    ).toEqual({
      manufacturedOn: 'The manufacturing date cannot be in the future',
    });
    expect(
      checkReceive({ ...delivery, manufacturedOn: '2026-11-18' }, NOW),
    ).toEqual({});
    expect(checkReceive({ ...delivery, expiresOn: '2026-11-01' }, NOW)).toEqual(
      { expiresOn: 'The expiry date must be after the manufacturing date' },
    );
    expect(
      checkReceive(
        { ...delivery, manufacturedOn: '2024-01-01', expiresOn: '2026-11-18' },
        NOW,
      ),
    ).toEqual({ expiresOn: 'This batch has already expired' });
    expect(
      checkReceive(
        { ...delivery, manufacturedOn: '2024-01-01', expiresOn: '2026-11-19' },
        NOW,
      ),
    ).toEqual({});
    expect(
      checkReceive(
        { ...delivery, manufacturedOn: '2026-02-30', expiresOn: 'soon' },
        NOW,
      ),
    ).toEqual({
      manufacturedOn: 'Use a date like 2026-10-31',
      expiresOn: 'Use a date like 2028-09-30',
    });
  });

  it.each([
    ['0', 'Between 1 and 10,00,000 packs'],
    ['1000001', 'Between 1 and 10,00,000 packs'],
    ['2.5', 'A whole number of packs, like 120'],
    ['-3', 'A whole number of packs, like 120'],
  ])('refuses %j packs', (quantity, message) => {
    expect(checkReceive({ ...delivery, quantity }, NOW)).toEqual({
      quantity: message,
    });
  });

  it('warns before receiving a batch that will never be sold', () => {
    expect(expiryHint('2027-05-17', NOW)).toBe(
      'Under 6 months left: this batch will not be sold.',
    );
    expect(expiryHint('2027-05-18', NOW)).toBe('As printed on the label.');
    expect(expiryHint('2026-11-18', NOW)).toBe('As printed on the label.');
    expect(expiryHint('', NOW)).toBe('As printed on the label.');
  });
});

describe('correcting a label', () => {
  it('starts from the batch, and sends only what changed', () => {
    const start = labelValues(BATCH);
    expect(start).toEqual({
      batchNumber: 'AS2610',
      manufacturedOn: '2026-10-01',
      expiresOn: '2028-09-30',
    });
    expect(checkLabel(start, NOW)).toEqual({});
    expect(labelChanges({ ...start, batchNumber: ' as 2610' }, BATCH)).toEqual(
      {},
    );
    expect(
      labelChanges(
        { ...start, batchNumber: 'as2611', expiresOn: '2028-10-31' },
        BATCH,
      ),
    ).toEqual({ batchNumber: 'AS2611', expiresOn: '2028-10-31' });
    expect(
      labelChanges({ ...start, manufacturedOn: '2026-09-30' }, BATCH),
    ).toEqual({ manufacturedOn: '2026-09-30' });
  });

  it('allows a label whose batch has expired, as the API does', () => {
    expect(
      checkLabel(
        {
          batchNumber: 'AS2401',
          manufacturedOn: '2024-01-01',
          expiresOn: '2026-01-01',
        },
        NOW,
      ),
    ).toEqual({});
  });
});

describe('changing the stock', () => {
  it('writes off at most the free packs', () => {
    const writeOff = { kind: 'DAMAGED', packs: '31', note: '' } as const;
    expect(checkChange(writeOff, BATCH)).toEqual({
      packs: 'At most 30 packs: the free packs of this batch',
    });
    expect(checkChange({ ...writeOff, packs: '30' }, BATCH)).toEqual({});
    expect(
      checkChange(
        { ...writeOff, kind: 'EXPIRED', packs: '2' },
        {
          ...BATCH,
          quantity: 1,
        },
      ),
    ).toEqual({ packs: 'At most 1 pack: the free packs of this batch' });
    expect(checkChange(writeOff, { ...BATCH, quantity: 0 })).toEqual({
      packs: 'This batch has no free packs to write off',
    });
  });

  it('adds any number of packs, from 1', () => {
    const more = { kind: 'RECEIVED', packs: '500', note: '' } as const;
    expect(checkChange(more, BATCH)).toEqual({});
    expect(checkChange({ ...more, packs: '' }, BATCH)).toEqual({
      packs: 'Enter how many packs',
    });
    expect(checkChange({ ...more, packs: '0' }, BATCH)).toEqual({
      packs: 'Between 1 and 10,00,000 packs',
    });
    expect(checkChange({ ...more, packs: 'two' }, BATCH)).toEqual({
      packs: 'A whole number of packs, like 2',
    });
  });

  it('sends a write-off as fewer packs, more of a batch as more', () => {
    expect(toMovement({ kind: 'DAMAGED', packs: '2', note: ' ' })).toEqual({
      change: -2,
      reason: 'DAMAGED',
      note: null,
    });
    expect(
      toMovement({ kind: 'EXPIRED', packs: '1,000', note: 'Past date' }),
    ).toEqual({ change: -1000, reason: 'EXPIRED', note: 'Past date' });
    expect(toMovement({ kind: 'RECEIVED', packs: '10', note: '' })).toEqual({
      change: 10,
      reason: 'RECEIVED',
      note: null,
    });
  });
});

describe('counting a shelf', () => {
  const held = { awaitingPacking: 2 };

  it('takes a count that matches, 0 too, without a note', () => {
    expect(checkCount({ counted: '32', note: '' }, held, 32)).toEqual({});
    expect(
      checkCount({ counted: '0', note: '' }, { awaitingPacking: 0 }, 0),
    ).toEqual({});
    expect(toCount({ counted: '32', note: '' }, 32)).toEqual({
      counted: 32,
      onShelf: 32,
      note: null,
    });
  });

  it('asks why a count differs', () => {
    expect(checkCount({ counted: '30', note: ' ' }, held, 32)).toEqual({
      note: 'Say why the count differs',
    });
    expect(checkCount({ counted: '30', note: '2 broken' }, held, 32)).toEqual(
      {},
    );
    expect(toCount({ counted: '30', note: ' 2 broken ' }, 32)).toEqual({
      counted: 30,
      onShelf: 32,
      note: '2 broken',
    });
  });

  it('refuses fewer than the orders waiting to be packed need', () => {
    expect(checkCount({ counted: '1', note: 'Lost' }, held, 32)).toEqual({
      counted:
        'Orders waiting to be packed need 2 packs of this batch, more than you counted. Check those orders first.',
    });
    expect(checkCount({ counted: '2', note: 'Lost' }, held, 32)).toEqual({});
  });

  it.each([
    ['', 'Enter how many packs you counted'],
    ['3.5', 'A whole number of packs, like 30'],
    ['1000001', 'Between 0 and 10,00,000 packs'],
  ])('refuses the count %j', (counted, message) => {
    expect(checkCount({ counted, note: 'x' }, held, 32)).toEqual({
      counted: message,
    });
  });

  it('says what the count will do as staff type it', () => {
    expect(countHint({ counted: '32', note: '' }, 32)).toBe(
      'It matches: nothing will change.',
    );
    expect(countHint({ counted: '33', note: '' }, 32)).toBe(
      '1 pack more than expected: the stock goes up.',
    );
    expect(countHint({ counted: '30', note: '' }, 32)).toBe(
      '2 packs fewer than expected: the stock goes down.',
    );
    for (const counted of ['', 'x', '1000001']) {
      expect(countHint({ counted, note: '' }, 32)).toBe(
        'Count the packs on the shelf, not those packed in boxes.',
      );
    }
  });
});
