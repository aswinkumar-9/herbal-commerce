import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openSignedIn } from '../test/console';
import { RAVI, json } from '../test/fake-api';
import { LAST_30, SALES, salesOf } from '../test/sales-fixtures';
import type { StockReport } from './sales-api';
import { leftOverName, perDayName } from './StockTab';

// 12:20 on 25 Nov 2026 in India, 5 minutes after the stock was read.
const NOW = new Date('2026-11-25T06:50:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

const STOCK = (from: string, to: string, filter = '') =>
  `GET /v1/staff/reports/stock?from=${from}&to=${to}${filter}`;

type PackSize = StockReport['packSizes'][number];
type Batch = StockReport['shelfLife'][number];

const packSize = (
  variantId: string,
  productName: string,
  changes: Partial<PackSize>,
): PackSize => ({
  variantId,
  productId: `p-${variantId}`,
  productName,
  sku: variantId.toUpperCase(),
  quantity: 60,
  unit: 'CAPSULES',
  onSale: true,
  sellable: 0,
  lowStockAt: 10,
  level: 'OK',
  soldPacks: 0,
  daysOfCover: null,
  ...changes,
});
const batch = (
  batchId: string,
  variantId: string,
  productName: string,
  changes: Partial<Batch>,
): Batch => ({
  batchId,
  variantId,
  productName,
  sku: variantId.toUpperCase(),
  quantity: 60,
  unit: 'CAPSULES',
  batchNumber: batchId.toUpperCase(),
  expiresOn: '2027-06-10',
  stopsSellingOn: '2026-12-11',
  packs: 1,
  daysLeft: 16,
  leftOver: 0,
  ...changes,
});

function stockOf(
  from: string,
  to: string,
  changes: Partial<StockReport> = {},
): StockReport {
  return {
    period: { from, to },
    readAt: '2026-11-25T06:45:00.000Z',
    rateDays: 25,
    totals: {
      packSizes: 4,
      out: 1,
      low: 1,
      sellablePacks: 70,
      sellableRupees: 24042,
      unsellablePacks: 5,
    },
    packSizes: [
      packSize('ash', 'Ashwagandha Capsules', {
        sellable: 50,
        soldPacks: 60,
        daysOfCover: 25,
      }),
      packSize('tulsi', 'Tulsi Tea', {
        quantity: 100,
        unit: 'G',
        sellable: 8,
        level: 'LOW',
        soldPacks: 3,
        daysOfCover: 80,
      }),
      packSize('brahmi', 'Brahmi Oil', {
        quantity: 100,
        unit: 'ML',
        level: 'OUT',
        // Out of stock though it sold: not in the cover list.
        soldPacks: 4,
        daysOfCover: 0,
      }),
      packSize('giloy', 'Giloy Tablets', {
        unit: 'TABLETS',
        sellable: 12,
      }),
      packSize('neem', 'Neem Soap', {
        quantity: 1,
        unit: 'PIECES',
        onSale: false,
        level: 'OUT',
      }),
      packSize('amla', 'Amla Juice', {
        quantity: 500,
        unit: 'ML',
        level: 'OUT',
      }),
    ],
    shelfLife: [
      batch('b0', 'ash', 'Ashwagandha Capsules', {
        expiresOn: '2027-04-30',
        stopsSellingOn: '2026-11-01',
        packs: 5,
        daysLeft: -24,
        leftOver: 5,
      }),
      batch('b1', 'ash', 'Ashwagandha Capsules', { packs: 20 }),
      batch('b3', 'tulsi', 'Tulsi Tea', {
        quantity: 100,
        unit: 'G',
        expiresOn: '2027-06-20',
        stopsSellingOn: '2026-12-21',
        packs: 8,
        daysLeft: 26,
        leftOver: 1,
      }),
    ],
    ...changes,
  };
}

type Answers = NonNullable<Parameters<typeof openSignedIn>[1]>['answers'];

function openStock(path = '/sales/stock', answers: Answers = {}) {
  return openSignedIn(path, {
    staff: RAVI,
    answers: {
      [LAST_30]: salesOf('2026-10-27', '2026-11-25'),
      [STOCK('2026-10-27', '2026-11-25')]: () =>
        json(200, stockOf('2026-10-27', '2026-11-25')),
      ...answers,
    },
  });
}

const tile = async (name: string) =>
  (await screen.findByRole('heading', { name, level: 2 }))
    .parentElement as HTMLElement;

const rowsOf = (table: HTMLElement) =>
  within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.textContent);

describe('the stock tab', () => {
  it('counts what is out, low, may be sold and is too near expiry, each a way to its list', async () => {
    openStock();

    const out = await tile('Out of stock');
    expect(out).toHaveTextContent(
      '1Pack sizes on sale with nothing that may be sold.',
    );
    // In red, its words beside an icon.
    expect(
      within(out).getByText(/nothing that may be sold/).parentElement,
    ).toHaveClass('text-danger');
    expect(
      within(out).getByRole('link', { name: 'See them on the Stock page' }),
    ).toHaveAttribute('href', '/stock?status=out');
    const low = await tile('Low');
    expect(low).toHaveTextContent('1At their own low mark or below.');
    expect(
      within(low).getByRole('link', { name: 'See the low ones' }),
    ).toHaveAttribute('href', '/stock?status=low');
    expect(await tile('Packs that may be sold')).toHaveTextContent(
      '70In 4 pack sizes on sale.',
    );
    expect(await tile('Worth')).toHaveTextContent(
      '₹24,042At today’s prices, GST included.',
    );
    const tooNear = await tile('Too near expiry to sell');
    expect(tooNear).toHaveTextContent(
      '5Packs in batches with less than 6 months left: write them off or send them back.',
    );
    expect(
      within(tooNear).getByText(/write them off/).parentElement,
    ).toHaveClass('text-danger');
    expect(
      screen.getByText(
        /beside how fast each pack size sold in the period: 25 days to today\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Live: read today at 12:15. Looks again every minute.'),
    ).toBeInTheDocument();
    expect(document.title).toContain('Stock against sales');
    const tabs = screen.getByRole('navigation', { name: 'Sales' });
    expect(within(tabs).getByRole('link', { name: 'Stock' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('shows how many days each pack size on sale lasts, the shortest first, each a way to its stock', async () => {
    openStock();

    const list = await screen.findByRole('list', { name: 'Days of cover' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual([
      'Ashwagandha Capsules, 60 capsules25 days · 2.4 a day',
      'Tulsi Tea, 100 g80 days · 0.1 a day',
    ]);
    expect(
      within(list).getByRole('link', {
        name: 'Ashwagandha Capsules, 60 capsules',
      }),
    ).toHaveAttribute('href', '/stock/ash');
    expect(
      screen.getByText(
        /1 pack size on sale with stock did not sell in the period\./,
      ),
    ).toBeInTheDocument();
  });

  it('shows the 10 shortest covers, the rest on asking', async () => {
    const many = stockOf('2026-10-27', '2026-11-25');
    const { user } = openStock('/sales/stock', {
      [STOCK('2026-10-27', '2026-11-25')]: () =>
        json(200, {
          ...many,
          packSizes: Array.from({ length: 11 }, (_, i) =>
            packSize(`p${i}`, `Product ${String(i).padStart(2, '0')}`, {
              sellable: 10 + i,
              soldPacks: 25,
              daysOfCover: 10 + i,
            }),
          ),
        }),
    });

    const list = await screen.findByRole('list', { name: 'Days of cover' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    await user.click(screen.getByRole('button', { name: 'Show all 11' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(11);
    await user.click(
      screen.getByRole('button', { name: 'Show the 10 shortest' }),
    );
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
  });

  it('lists the pack sizes on sale to order more of, those out first', async () => {
    openStock();

    const table = await screen.findByRole('table', {
      name: 'Out of stock or low',
    });
    // Every column as the page has them: a phone shows the low mark and
    // the packs sold under the name instead of in their own columns.
    expect(rowsOf(table)).toEqual([
      'Brahmi Oil, 100 mlOut of stockLow at 10, sold 4 packs0104 packs0 days',
      'Amla Juice, 500 mlOut of stockLow at 10, sold 0 packs0100 packsDid not sell',
      'Tulsi Tea, 100 gLowLow at 10, sold 3 packs8103 packs80 days',
    ]);
    expect(within(table).getByText(/Low at 10, sold 4 packs/)).toHaveClass(
      'sm:hidden',
    );
    for (const name of ['Low at', 'Sold in the period']) {
      expect(within(table).getByRole('columnheader', { name })).toHaveClass(
        'hidden',
        'sm:table-cell',
      );
    }
    expect(
      within(table).getByRole('link', { name: 'Brahmi Oil, 100 ml' }),
    ).toHaveAttribute('href', '/stock/brahmi');
  });

  it('warns of the batches near the end of their selling life, and what will be left in them', async () => {
    openStock();

    const table = await screen.findByRole('table', {
      name: 'Running out of shelf life',
    });
    // What is left shows under the day on a phone, in its column wider.
    expect(rowsOf(table)).toEqual([
      'Ashwagandha Capsules, 60 capsulesBatch B0, expires 30 Apr 20275Stopped on 1 Nov 2026All 5 packs: no longer soldAll 5 packs: no longer sold',
      'Ashwagandha Capsules, 60 capsulesBatch B1, expires 10 Jun 20272011 Dec 2026, in 16 daysNone: all sold firstNone: all sold first',
      'Tulsi Tea, 100 gBatch B3, expires 20 Jun 2027821 Dec 2026, in 26 daysAbout 1 packAbout 1 pack',
    ]);
    const [onPhone, wider] = within(table).getAllByText('About 1 pack');
    expect(onPhone).toHaveClass('text-danger');
    expect(onPhone?.parentElement).toHaveClass('sm:hidden');
    expect(wider).toHaveClass('text-danger');
    expect(
      within(table).getByRole('columnheader', { name: 'Left then' }),
    ).toHaveClass('hidden', 'sm:table-cell');
    for (const none of within(table).getAllByText('None: all sold first')) {
      expect(none).not.toHaveClass('text-danger');
    }
  });

  it('says so when all is well, and when nothing sold', async () => {
    const calm = stockOf('2026-10-27', '2026-11-25');
    openStock('/sales/stock', {
      [STOCK('2026-10-27', '2026-11-25')]: () =>
        json(200, {
          ...calm,
          rateDays: 0,
          totals: { ...calm.totals, out: 0, low: 0, unsellablePacks: 0 },
          packSizes: [
            packSize('ash', 'Ashwagandha Capsules', { sellable: 50 }),
          ],
          shelfLife: [],
        }),
    });

    const out = await tile('Out of stock');
    expect(out).toHaveTextContent('0Every pack size on sale has stock.');
    expect(within(out).getByText(/Every pack size/)).toHaveClass(
      'text-ink-muted',
    );
    expect(await tile('Too near expiry to sell')).toHaveTextContent(
      '0No pack on the shelf is too near its expiry.',
    );
    expect(
      screen.getByText('Nothing on sale sold in this period.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Every pack size on sale has more than its low mark.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('No batch stops selling in the next 90 days.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/, which has no days to today yet\./),
    ).toBeInTheDocument();
  });

  it('says a state or a way of paying never narrows the stock', async () => {
    openStock('/sales/stock?method=UPI', {
      [SALES('2026-10-27', '2026-11-25', '&method=UPI')]: salesOf(
        '2026-10-27',
        '2026-11-25',
      ),
      [STOCK('2026-10-27', '2026-11-25', '&method=UPI')]: () =>
        json(200, stockOf('2026-10-27', '2026-11-25')),
    });

    expect(
      await screen.findByText(
        /A state or a way of paying never narrows the stock: the shop keeps one store for all\./,
      ),
    ).toBeInTheDocument();
  });

  it('looks again every minute, and keeps the period in its tab’s link', async () => {
    const { queryClient } = openStock();

    await tile('Out of stock');
    const [stock] = queryClient
      .getQueryCache()
      .findAll({ queryKey: ['sales', 'stock'] });
    expect(
      (stock?.options as { refetchInterval?: unknown } | undefined)
        ?.refetchInterval,
    ).toBe(60_000);
    const tabs = screen.getByRole('navigation', { name: 'Sales' });
    expect(within(tabs).getByRole('link', { name: 'Stock' })).toHaveAttribute(
      'href',
      '/sales/stock',
    );
  });

  it('keeps the period in the Stock tab’s link from another tab', async () => {
    const days = '?from=2026-11-01&to=2026-11-25';
    openSignedIn(`/sales${days}`, {
      staff: RAVI,
      answers: {
        [SALES('2026-11-01', '2026-11-25')]: salesOf(
          '2026-11-01',
          '2026-11-25',
        ),
      },
    });

    const tabs = await screen.findByRole('navigation', { name: 'Sales' });
    expect(within(tabs).getByRole('link', { name: 'Stock' })).toHaveAttribute(
      'href',
      `/sales/stock${days}`,
    );
  });

  it('says calmly when the stock cannot be loaded, and tries again', async () => {
    const { user } = openStock('/sales/stock', {
      [STOCK('2026-10-27', '2026-11-25')]: () =>
        json(500, { message: 'Internal server error' }),
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The stock could not be loaded');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'The stock could not be loaded',
      ),
    );
  });
});

describe('how many a day', () => {
  it('says it whole from 10, else to a tenth', () => {
    expect(perDayName(60, 30)).toBe('2');
    expect(perDayName(3, 30)).toBe('0.1');
    expect(perDayName(1, 30)).toBe('under 0.1');
    expect(perDayName(7, 2)).toBe('3.5');
    expect(perDayName(375, 30)).toBe('13');
  });
});

describe('what a batch will have left', () => {
  const some = batch('b1', 'ash', 'Ashwagandha Capsules', {
    packs: 20,
    daysLeft: 16,
  });
  it('says all its packs once it has stopped selling, none or about how many before', () => {
    expect(leftOverName({ ...some, daysLeft: 0, leftOver: 20 })).toBe(
      'All 20 packs: no longer sold',
    );
    expect(leftOverName({ ...some, leftOver: 0 })).toBe('None: all sold first');
    expect(leftOverName({ ...some, leftOver: 1 })).toBe('About 1 pack');
  });
});
