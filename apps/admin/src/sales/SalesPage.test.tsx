import {
  renderHook,
  act,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BRANDS,
  CATEGORIES,
  HAIR,
  HIMALAYA,
  SHAMPOO,
  brandsOf,
  categoriesOf,
  productsOf,
} from '../test/catalog-fixtures';
import { heldBack, openSignedIn } from '../test/console';
import { ASHA, RAVI, json, offline } from '../test/fake-api';
import {
  LAST_30,
  NOTHING,
  SALES,
  SOME,
  reportOf,
  salesOf,
} from '../test/sales-fixtures';
import { useIndiaToday } from './use-india-today';

type Answers = NonNullable<Parameters<typeof openSignedIn>[1]>['answers'];

// 12:15 on 25 Nov 2026 in India.
const NOW = new Date('2026-11-25T06:45:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

function openSales(path = '/sales', answers: Answers = {}) {
  return openSignedIn(path, {
    staff: RAVI,
    answers: {
      [LAST_30]: salesOf('2026-10-27', '2026-11-25', {
        previousTotals: {
          ...SOME,
          salesRupees: 1000,
          orders: 4,
          averageOrderRupees: 400,
          refundedRupees: 0,
          refundedOrders: 0,
          newCustomers: 1,
          returningCustomers: 1,
        },
      }),
      ...answers,
    },
  });
}

// A figure is found by its name, a heading.
const figure = async (name: string) =>
  (await screen.findByRole('heading', { name, level: 2 }))
    .parentElement as HTMLElement;
// Which way a figure's change points, by its icon: the words say it too.
const trend = (figure: HTMLElement) => {
  const icon = figure.querySelector('svg.lucide');
  return icon === null
    ? null
    : (['trending-up', 'trending-down', 'minus'].find((name) =>
        icon.classList.contains(`lucide-${name}`),
      ) ?? 'other');
};
const chip = (name: string) => screen.getByRole('button', { name });
const sentence = (text: string) => (_: string, element: Element | null) =>
  element?.tagName === 'P' && element.textContent === text;

describe('the Sales page', () => {
  it('is in the menu for Super Users, and opens on the last 30 days beside the 30 before', async () => {
    const { api, user } = openSales('/');

    const menu = await screen.findByRole('navigation', { name: 'Main' });
    await screen.findByRole('heading', { name: 'Welcome, Ravi' });
    await user.click(within(menu).getByRole('link', { name: 'Sales' }));

    expect(
      await screen.findByRole('heading', { name: 'Sales', level: 1 }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(document.title).toBe('Sales · Herbal Commerce Admin'),
    );
    expect(within(menu).getByRole('link', { name: 'Sales' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(chip('Last 30 days')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Today')).toHaveAttribute('aria-pressed', 'false');
    expect(
      screen.getByText(
        sentence('27 Oct – 25 Nov 2026, compared with 27 Sep – 26 Oct 2026'),
      ),
    ).toBeInTheDocument();

    const sales = await figure('Sales');
    expect(sales).toHaveTextContent('₹1,374');
    expect(sales).toHaveTextContent('Up 37% from ₹1,000');
    expect(trend(sales)).toBe('trending-up');
    expect(sales).toHaveTextContent(
      'What the products sold for, without GST, less refunds.',
    );
    expect(screen.getByText('GST').nextSibling).toHaveTextContent('₹179');
    expect(screen.getByText('Delivery').nextSibling).toHaveTextContent('₹49');
    expect(screen.getByText('Paid in all').nextSibling).toHaveTextContent(
      '₹1,602',
    );

    const orders = await figure('Orders');
    expect(orders).toHaveTextContent('4Same as before, 4');
    expect(trend(orders)).toBe('minus');
    expect(await figure('Average order')).toHaveTextContent(
      '₹451Up 13% from ₹400',
    );
    const refunds = await figure('Refunds');
    expect(refunds).toHaveTextContent('₹498Up ₹498 from ₹0');
    expect(refunds).toHaveTextContent('1 order refunded in the period');
    expect(await figure('New customers')).toHaveTextContent('2Up 100% from 1');
    expect(await figure('Returning customers')).toHaveTextContent(
      '1Same as before, 1',
    );

    expect(
      screen.getByText(
        'Updated today at 12:10. New payments show within 5 minutes.',
      ),
    ).toBeInTheDocument();
    expect(api.to('GET', LAST_30.slice(4))).toHaveLength(1);
    expect(api.unexpected).toEqual([]);
  });

  it('shows a preset a click away, keeping the last figures, dimmed, until it comes', async () => {
    const thisYear = heldBack();
    const { router, user, api } = openSales('/sales', {
      [SALES('2026-01-01', '2026-11-25')]: thisYear.answer,
    });
    await figure('Sales');

    await user.click(chip('This year'));
    expect(router.state.location.search).toBe('?period=this-year');
    expect(chip('This year')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Last 30 days')).toHaveAttribute('aria-pressed', 'false');
    expect(
      screen.getByText(
        sentence('1 Jan – 25 Nov 2026, compared with 6 Feb – 31 Dec 2025'),
      ),
    ).toBeInTheDocument();
    // The last 30 days stay, dimmed and marked busy.
    const sales = await figure('Sales');
    expect(sales).toHaveTextContent('₹1,374');
    expect(sales.closest('[aria-busy="true"]')).toHaveClass('opacity-60');

    thisYear.release(
      json(
        200,
        reportOf('2026-01-01', '2026-11-25', {
          totals: { ...SOME, salesRupees: 125_000 },
        }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Sales', level: 2 }).parentElement,
      ).toHaveTextContent('₹1,25,000'),
    );
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();

    // The default needs nothing in the address.
    await user.click(chip('Last 30 days'));
    expect(router.state.location.search).toBe('');
    expect(api.unexpected).toEqual([]);
  });

  it('opens on the period the address names', async () => {
    const { api } = openSales('/sales?period=yesterday', {
      [SALES('2026-11-24', '2026-11-24')]: salesOf('2026-11-24', '2026-11-24'),
    });

    expect(await figure('Sales')).toHaveTextContent('₹1,374');
    expect(chip('Yesterday')).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByText(sentence('24 Nov 2026, compared with 23 Nov 2026')),
    ).toBeInTheDocument();
    expect(api.unexpected).toEqual([]);
  });

  it('shows any two days, checked before they are asked for', async () => {
    const { router, user, api } = openSales('/sales', {
      [SALES('2026-11-01', '2026-11-10')]: salesOf('2026-11-01', '2026-11-10'),
    });
    await figure('Sales');

    await user.click(chip('Choose days'));
    expect(chip('Choose days')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Last 30 days')).toHaveAttribute('aria-pressed', 'false');
    const form = screen.getByRole('form', { name: 'Choose the days' });
    expect(chip('Choose days')).toHaveAttribute('aria-controls', form.id);
    const first = within(form).getByLabelText('First day');
    const last = within(form).getByLabelText('Last day');
    // It starts from the period shown, and offers no day after today.
    expect(first).toHaveValue('2026-10-27');
    expect(last).toHaveValue('2026-11-25');
    expect(last).toHaveAttribute('max', '2026-11-25');

    await user.clear(first);
    await user.click(
      within(form).getByRole('button', { name: 'Show these days' }),
    );
    expect(
      await within(form).findByText('Choose the first day'),
    ).toBeInTheDocument();
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute('aria-invalid', 'true');

    await user.type(first, '2026-11-26');
    expect(first).not.toHaveAttribute('aria-invalid');
    await user.click(
      within(form).getByRole('button', { name: 'Show these days' }),
    );
    expect(
      await within(form).findByText('Choose a day on or after the first day'),
    ).toBeInTheDocument();
    expect(last).toHaveFocus();
    expect(router.state.location.search).toBe('');

    await user.clear(first);
    await user.type(first, '2026-11-01');
    await user.clear(last);
    await user.type(last, '2026-11-10');
    await user.click(
      within(form).getByRole('button', { name: 'Show these days' }),
    );

    expect(router.state.location.search).toBe('?from=2026-11-01&to=2026-11-10');
    expect(
      await screen.findByText(
        sentence('1–10 Nov 2026, compared with 22–31 Oct 2026'),
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        api.to('GET', SALES('2026-11-01', '2026-11-10').slice(4)),
      ).toHaveLength(1),
    );
    // The days stay open to change, and a preset closes them.
    expect(screen.getByLabelText('First day')).toHaveValue('2026-11-01');
    await user.click(chip('Today'));
    expect(
      screen.queryByRole('form', { name: 'Choose the days' }),
    ).not.toBeInTheDocument();
    expect(router.state.location.search).toBe('?period=today');
  });

  it('closes the days again when a preset is chosen instead', async () => {
    const { router, user } = openSales('/sales', {
      [SALES('2026-11-19', '2026-11-25')]: salesOf('2026-11-19', '2026-11-25'),
    });
    await figure('Sales');

    await user.click(chip('Choose days'));
    expect(
      screen.getByRole('form', { name: 'Choose the days' }),
    ).toBeInTheDocument();
    await user.click(chip('Last 7 days'));
    expect(
      screen.queryByRole('form', { name: 'Choose the days' }),
    ).not.toBeInTheDocument();
    expect(chip('Last 7 days')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Choose days')).toHaveAttribute('aria-pressed', 'false');
    expect(router.state.location.search).toBe('?period=last-7-days');
  });

  it('opens two days from the address with them chosen, and follows it', async () => {
    const { router } = openSales('/sales?from=2026-11-01&to=2026-11-10', {
      [SALES('2026-11-01', '2026-11-10')]: salesOf('2026-11-01', '2026-11-10'),
      [SALES('2026-11-05', '2026-11-06')]: salesOf('2026-11-05', '2026-11-06'),
    });

    await figure('Sales');
    expect(chip('Choose days')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('First day')).toHaveValue('2026-11-01');
    expect(screen.getByLabelText('Last day')).toHaveValue('2026-11-10');

    // Back and forward, say, to other days.
    await act(() => router.navigate('/sales?from=2026-11-05&to=2026-11-06'));
    expect(screen.getByLabelText('First day')).toHaveValue('2026-11-05');
    expect(screen.getByLabelText('Last day')).toHaveValue('2026-11-06');
  });

  it('says so when nothing was paid or refunded, and when more went back than was sold', async () => {
    const { user } = openSales('/sales?period=today', {
      [SALES('2026-11-25', '2026-11-25')]: salesOf('2026-11-25', '2026-11-25', {
        totals: NOTHING,
        previousTotals: NOTHING,
      }),
      [SALES('2026-11-24', '2026-11-24')]: salesOf('2026-11-24', '2026-11-24', {
        totals: {
          ...NOTHING,
          salesRupees: -428,
          gstRupees: -51,
          paidRupees: -479,
          refundedOrders: 1,
          refundedRupees: 479,
        },
        previousTotals: SOME,
      }),
    });

    expect(await figure('Sales')).toHaveTextContent('₹0Same as before, ₹0');
    const average = await figure('Average order');
    expect(average).toHaveTextContent('No ordersNo orders before either');
    // Nothing to point up or down from.
    expect(trend(average)).toBeNull();
    expect(
      screen.getByText(/Nothing was paid for or refunded in this period/),
    ).toBeInTheDocument();
    // No chart or lists of nothing.
    expect(
      screen.queryByRole('heading', { name: 'Sales each day' }),
    ).not.toBeInTheDocument();

    await user.click(chip('Yesterday'));
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Sales', level: 2 }).parentElement,
      ).toHaveTextContent('−₹428Down ₹1,802 from ₹1,374'),
    );
    expect(trend(await figure('Sales'))).toBe('trending-down');
    expect(screen.getByText('Paid in all').nextSibling).toHaveTextContent(
      '−₹479',
    );
    expect(await figure('Average order')).toHaveTextContent(
      'No orders₹451 before',
    );
    expect(
      screen.queryByText(/Nothing was paid for or refunded/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Sales each day' }),
    ).toBeInTheDocument();
  });

  it('says when the figures have never been worked out', async () => {
    openSales('/sales', {
      [LAST_30]: salesOf('2026-10-27', '2026-11-25', { refreshedAt: null }),
    });

    expect(
      await screen.findByText(
        'The figures are being worked out for the first time. Look again in a minute.',
      ),
    ).toBeInTheDocument();
  });

  it('shows a calm message when the sales cannot be loaded, and tries again', async () => {
    const { user } = openSales('/sales', {
      [LAST_30]: [offline, salesOf('2026-10-27', '2026-11-25')],
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The sales could not be loaded');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await figure('Sales')).toHaveTextContent('₹1,374');
  });

  it('is kept from Admins, in the menu and at its address', async () => {
    openSignedIn('/sales', { staff: ASHA });

    expect(
      await screen.findByRole('heading', {
        name: 'Only Super Users can open this page',
      }),
    ).toBeInTheDocument();
    const menu = screen.getByRole('navigation', { name: 'Main' });
    expect(
      within(menu).queryByRole('link', { name: 'Sales' }),
    ).not.toBeInTheDocument();
  });
});

describe('today in India', () => {
  it('moves on to the next day at midnight there', () => {
    vi.useFakeTimers({ now: new Date('2026-11-25T18:29:00.000Z') });
    const { result } = renderHook(() => useIndiaToday());
    expect(result.current).toBe('2026-11-25');

    act(() => vi.advanceTimersByTime(59_000));
    expect(result.current).toBe('2026-11-25');
    act(() => vi.advanceTimersByTime(2_000));
    expect(result.current).toBe('2026-11-26');
  });
});

const ASH = {
  ...SHAMPOO,
  id: '7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b41',
  name: 'Ashwagandha Capsules',
};
const OILS = {
  ...HAIR,
  id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  name: 'Hair Oils',
  slug: 'hair-oils',
  parentId: HAIR.id,
};
// Ashwagandha alone: its lines' GST, no delivery.
const ASH_ONLY = {
  ...SOME,
  salesRupees: 855,
  gstRupees: 43,
  deliveryRupees: null,
  paidRupees: 898,
  orders: 2,
  averageOrderRupees: 428,
  refundedOrders: 0,
  refundedRupees: 0,
};
const NAMED_ASH = {
  product: { productId: ASH.id, name: 'Ashwagandha Capsules' },
  category: null,
  brand: null,
};
const SEARCH_BOX = 'Narrow to a product, category or brand';
const narrowedTo = () =>
  [...screen.getByRole('list', { name: 'Narrowed to' }).children]
    .map((chip) => chip.textContent)
    .filter((text) => text !== 'Show all sales');

describe('narrowing the Sales page', () => {
  it('finds a product, category or brand by name, and shows only its sales', async () => {
    const { router, user, api } = openSales('/sales', {
      'GET /v1/staff/products?q=ash&limit=5': productsOf([ASH]),
      [CATEGORIES]: categoriesOf([HAIR, OILS]),
      [BRANDS]: brandsOf([HIMALAYA]),
      [SALES('2026-10-27', '2026-11-25', `&productId=${ASH.id}`)]: salesOf(
        '2026-10-27',
        '2026-11-25',
        { filters: NAMED_ASH, totals: ASH_ONLY },
      ),
      [SALES('2026-01-01', '2026-11-25', `&productId=${ASH.id}`)]: salesOf(
        '2026-01-01',
        '2026-11-25',
        { filters: NAMED_ASH, totals: ASH_ONLY },
      ),
    });
    await figure('Sales');
    // The catalog is asked for only once a search starts.
    expect(api.to('GET', '/v1/staff/categories')).toHaveLength(0);

    await user.type(screen.getByRole('searchbox', { name: SEARCH_BOX }), 'ash');
    const matches = await screen.findByRole('list', { name: 'Matches' });
    expect(
      within(matches)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Ashwagandha CapsulesProduct']);
    expect(screen.getByText('1 match')).toBeInTheDocument();

    await user.click(within(matches).getByRole('button'));
    expect(router.state.location.search).toBe(`?productId=${ASH.id}`);
    expect(screen.getByRole('searchbox', { name: SEARCH_BOX })).toHaveValue('');
    expect(
      screen.queryByRole('list', { name: 'Matches' }),
    ).not.toBeInTheDocument();
    expect(narrowedTo()).toEqual(['Product: Ashwagandha Capsules']);

    // Every figure is its alone: no delivery, what was paid for it.
    await waitFor(() =>
      expect(screen.getByText('Not split')).toBeInTheDocument(),
    );
    expect(screen.getByText('Paid for these').nextSibling).toHaveTextContent(
      '₹898',
    );
    expect(await figure('Orders')).toHaveTextContent(
      'Paid in the period, with these in.',
    );
    expect(await figure('Sales')).toHaveTextContent(
      'What these products sold for, without GST, less refunds.',
    );

    // Another period keeps the filter.
    await user.click(chip('This year'));
    expect(router.state.location.search).toBe(
      `?period=this-year&productId=${ASH.id}`,
    );
    await waitFor(() =>
      expect(
        api.to(
          'GET',
          SALES('2026-01-01', '2026-11-25', `&productId=${ASH.id}`).slice(4),
        ),
      ).toHaveLength(1),
    );

    // And taking it off shows every sale again.
    await user.click(
      screen.getByRole('button', { name: 'Show every product' }),
    );
    expect(router.state.location.search).toBe('?period=this-year');
    expect(
      screen.queryByRole('list', { name: 'Narrowed to' }),
    ).not.toBeInTheDocument();
  });

  it('finds categories with their top category, and brands, as well as products', async () => {
    const { user } = openSales('/sales', {
      'GET /v1/staff/products?q=hair&limit=5': productsOf([]),
      [CATEGORIES]: categoriesOf([HAIR, OILS]),
      [BRANDS]: brandsOf([HIMALAYA]),
    });
    await figure('Sales');

    await user.type(
      screen.getByRole('searchbox', { name: SEARCH_BOX }),
      'hair',
    );
    const matches = await screen.findByRole('list', { name: 'Matches' });
    expect(
      within(matches)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Hair CareCategory', 'Hair Care › Hair OilsCategory']);

    await user.clear(screen.getByRole('searchbox', { name: SEARCH_BOX }));
    await user.type(screen.getByRole('searchbox', { name: SEARCH_BOX }), 'zzz');
    expect(
      await screen.findByText('No product, category or brand has these words.'),
    ).toBeInTheDocument();
  });

  it('opens on the filters the address names, as the report names them, and shows all sales again', async () => {
    const filter = `&categoryId=${OILS.id}&brandId=${HIMALAYA.id}`;
    const { router, user } = openSales(
      `/sales?period=this-year&categoryId=${OILS.id}&brandId=${HIMALAYA.id}`,
      {
        [SALES('2026-01-01', '2026-11-25')]: salesOf(
          '2026-01-01',
          '2026-11-25',
        ),
        [SALES('2026-01-01', '2026-11-25', filter)]: salesOf(
          '2026-01-01',
          '2026-11-25',
          {
            filters: {
              product: null,
              category: {
                categoryId: OILS.id,
                name: 'Hair Oils',
                parentName: 'Hair Care',
              },
              brand: { brandId: HIMALAYA.id, name: 'Himalaya' },
            },
            totals: { ...ASH_ONLY },
          },
        ),
      },
    );

    await figure('Sales');
    await waitFor(() =>
      expect(narrowedTo()).toEqual([
        'Category: Hair Care › Hair Oils',
        'Brand: Himalaya',
      ]),
    );

    // Every sale again, in the same period.
    await user.click(screen.getByRole('button', { name: 'Show all sales' }));
    expect(router.state.location.search).toBe('?period=this-year');
  });

  it('keeps the days chosen when narrowing, and says when a filter names nothing known', async () => {
    const GONE = '9f8e7d6c-5b4a-4f3e-8d2c-1b0a9f8e7d6c';
    const days = (filter: string) => SALES('2026-11-01', '2026-11-10', filter);
    const { router, user } = openSales(
      `/sales?from=2026-11-01&to=2026-11-10&brandId=${GONE}`,
      {
        [days(`&brandId=${GONE}`)]: salesOf('2026-11-01', '2026-11-10', {
          filters: {
            product: null,
            category: null,
            brand: { brandId: GONE, name: null },
          },
        }),
        'GET /v1/staff/products?q=hima&limit=5': productsOf([]),
        [CATEGORIES]: categoriesOf([HAIR]),
        [BRANDS]: brandsOf([HIMALAYA]),
        [days(`&brandId=${HIMALAYA.id}`)]: salesOf('2026-11-01', '2026-11-10'),
      },
    );

    await figure('Sales');
    await waitFor(() => expect(narrowedTo()).toEqual(['Brand: Not found']));

    await user.type(
      screen.getByRole('searchbox', { name: SEARCH_BOX }),
      'hima',
    );
    await user.click(
      within(await screen.findByRole('list', { name: 'Matches' })).getByRole(
        'button',
      ),
    );
    expect(router.state.location.search).toBe(
      `?from=2026-11-01&to=2026-11-10&brandId=${HIMALAYA.id}`,
    );
    // Named as the search found it, though the report names none.
    expect(narrowedTo()).toEqual(['Brand: Himalaya']);
  });

  it('adds a filter of another kind to the one in use', async () => {
    const { router, user } = openSales(`/sales?productId=${ASH.id}`, {
      [SALES('2026-10-27', '2026-11-25', `&productId=${ASH.id}`)]: salesOf(
        '2026-10-27',
        '2026-11-25',
        { filters: NAMED_ASH, totals: ASH_ONLY },
      ),
      'GET /v1/staff/products?q=oils&limit=5': productsOf([]),
      [CATEGORIES]: categoriesOf([HAIR, OILS]),
      [BRANDS]: brandsOf([HIMALAYA]),
      [SALES(
        '2026-10-27',
        '2026-11-25',
        `&productId=${ASH.id}&categoryId=${OILS.id}`,
      )]: salesOf('2026-10-27', '2026-11-25', {
        filters: { ...NAMED_ASH, category: null },
        totals: ASH_ONLY,
      }),
    });
    await figure('Sales');

    await user.type(
      screen.getByRole('searchbox', { name: SEARCH_BOX }),
      'oils',
    );
    await user.click(
      within(await screen.findByRole('list', { name: 'Matches' })).getByRole(
        'button',
        { name: /Hair Oils/ },
      ),
    );
    expect(router.state.location.search).toBe(
      `?productId=${ASH.id}&categoryId=${OILS.id}`,
    );
    expect(narrowedTo()).toEqual([
      'Product: Ashwagandha Capsules',
      'Category: Hair Care › Hair Oils',
    ]);
  });
});

const EXPORT = (search: string) =>
  `GET /v1/staff/reports/sales/export?${search}`;
const excel = (name: string) => () =>
  new Response('PK', {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}"`,
    },
  });

// What the page handed the browser to save: the link clicked, its file.
function savedFiles() {
  const saved: { name: string; url: string }[] = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:report');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
    function click(this: HTMLAnchorElement) {
      saved.push({ name: this.download, url: this.href });
    },
  );
  return saved;
}

describe('downloading the Sales report', () => {
  it('saves the period and filters shown as an Excel file, and says so', async () => {
    const saved = savedFiles();
    const { user, api } = openSales(`/sales?period=today&productId=${ASH.id}`, {
      [SALES('2026-11-25', '2026-11-25', `&productId=${ASH.id}`)]: salesOf(
        '2026-11-25',
        '2026-11-25',
        { filters: NAMED_ASH, totals: ASH_ONLY },
      ),
      [EXPORT(`from=2026-11-25&to=2026-11-25&productId=${ASH.id}`)]: excel(
        'herbal-commerce-sales-2026-11-25-to-2026-11-25-narrowed.xlsx',
      ),
    });
    await figure('Sales');

    await user.click(screen.getByRole('button', { name: 'Download as Excel' }));
    expect(
      await screen.findByText(
        'Downloaded herbal-commerce-sales-2026-11-25-to-2026-11-25-narrowed.xlsx',
      ),
    ).toBeInTheDocument();
    expect(saved).toEqual([
      {
        name: 'herbal-commerce-sales-2026-11-25-to-2026-11-25-narrowed.xlsx',
        url: 'blob:report',
      },
    ]);
    // The link is gone from the page at once.
    expect(document.querySelector('a[download]')).toBeNull();
    expect(api.unexpected).toEqual([]);
  });

  it('says why when the file could not be made, and makes it on another try', async () => {
    const saved = savedFiles();
    const { user } = openSales('/sales', {
      [EXPORT('from=2026-10-27&to=2026-11-25')]: [
        () =>
          json(400, {
            message:
              'More than 1,00,000 lines were sold or refunded in this period: download a shorter one',
          }),
        excel('herbal-commerce-sales-2026-10-27-to-2026-11-25.xlsx'),
      ],
    });
    await figure('Sales');

    const button = screen.getByRole('button', { name: 'Download as Excel' });
    await user.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The file could not be made. More than 1,00,000 lines were sold or refunded in this period: download a shorter one',
    );
    expect(saved).toEqual([]);

    await user.click(button);
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
