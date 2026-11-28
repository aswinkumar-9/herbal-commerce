import type { UseQueryResult } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';
import { problemMessage } from '../api/problems';
import { LoadFailed } from '../catalog/list-states';
import { packName, rupees } from '../catalog/products/pack-size-form';
import type { BarListItem } from '../charts/BarList';
import { dayName, packs } from '../stock/stock-display';
import { LevelTag } from '../stock/StockTags';
import type { StockReport } from './sales-api';
import { signedCount } from './sales-breakdown';
import { TopList } from './SalesBreakdown';
import { count } from './sales-display';
import { FiguresLoading, LinkTile, TILE } from './SalesFigure';

type PackSize = StockReport['packSizes'][number];

const NAME_LINK =
  'rounded underline decoration-line-strong decoration-1 underline-offset-4 transition-colors duration-150 hover:text-primary hover:decoration-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

const NUMBER_HEAD = 'px-3 py-1.5 text-right font-medium';
const NUMBER =
  'whitespace-nowrap px-3 py-1.5 text-right align-top tabular-nums';
// A column a phone has no room for: its row says it another way there.
const WIDE_ONLY = 'hidden sm:table-cell';

// "Tulsi Tea, 100 g", as the Stock page names a pack size.
const named = (each: Pick<PackSize, 'productName' | 'quantity' | 'unit'>) =>
  `${each.productName}, ${packName(each)}`;

const days = (value: number) => signedCount(value, 'day', 'days');

// How many a day, as a person says it: "2", "0.4", "under 0.1".
export function perDayName(sold: number, days: number): string {
  const rate = sold / days;
  if (rate >= 10) {
    return Math.round(rate).toLocaleString('en-IN');
  }
  const tenths = Math.round(rate * 10) / 10;
  return tenths === 0 ? 'under 0.1' : String(tenths);
}

// What will be left in a batch when it stops selling, at the period's
// rate.
export function leftOverName(batch: StockReport['shelfLife'][number]): string {
  if (batch.daysLeft <= 0) {
    return `All ${packs(batch.packs)}: no longer sold`;
  }
  return batch.leftOver === 0
    ? 'None: all sold first'
    : `About ${packs(batch.leftOver)}`;
}

// The pack sizes on sale that sold and still have stock, the least cover
// first, each a way to its stock. Those out of stock are listed as such.
export function coverItems(report: StockReport): BarListItem[] {
  return report.packSizes
    .filter(
      (each) => each.onSale && each.sellable > 0 && each.daysOfCover !== null,
    )
    .map((each) => ({
      key: each.variantId,
      name: (
        <Link to={`/stock/${each.variantId}`} className={NAME_LINK}>
          {named(each)}
        </Link>
      ),
      value: each.daysOfCover ?? 0,
      figure: days(each.daysOfCover ?? 0),
      note: `${perDayName(each.soldPacks, report.rateDays)} a day`,
    }));
}

// What will be left in a batch, in red beside an icon when any is.
function LeftOver({ batch }: { batch: StockReport['shelfLife'][number] }) {
  return batch.leftOver > 0 ? (
    <span className="flex items-start gap-1.5 text-danger">
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      {leftOverName(batch)}
    </span>
  ) : (
    <>{leftOverName(batch)}</>
  );
}

// The pack sizes on sale out of stock or low, those out first.
export function shortOf(report: StockReport): PackSize[] {
  const short = report.packSizes.filter(
    (each) => each.onSale && each.level !== 'OK',
  );
  return [
    ...short.filter((each) => each.level === 'OUT'),
    ...short.filter((each) => each.level === 'LOW'),
  ];
}

// The stock beside a period's sales, for Super Users (part 15E), read
// live: what is out or low, how many days each pack size on sale lasts at
// the period's rate of sale, and the batches near the end of their selling
// life with what will be left in them. Narrowed to a product, a category or
// a brand; never by state or way of paying.
export function StockTab({
  query,
  byPlace,
}: {
  query: UseQueryResult<StockReport>;
  // Narrowed to a state or a way of paying, which the stock never is.
  byPlace: boolean;
}) {
  if (query.isPending) {
    return <FiguresLoading what="the stock" />;
  }
  if (query.isError && !query.data) {
    return (
      <LoadFailed
        title="The stock could not be loaded"
        message={problemMessage(query.error)}
        retrying={query.isFetching}
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (!query.data) {
    return null;
  }
  return (
    <div
      aria-busy={query.isPlaceholderData || undefined}
      className={`transition-opacity duration-150 ${
        query.isPlaceholderData ? 'opacity-60' : ''
      }`}
    >
      <Stock report={query.data} byPlace={byPlace} />
    </div>
  );
}

function Stock({ report, byPlace }: { report: StockReport; byPlace: boolean }) {
  const { totals, rateDays } = report;
  const cover = coverItems(report);
  const idle = report.packSizes.filter(
    (each) => each.onSale && each.sellable > 0 && each.daysOfCover === null,
  ).length;
  const short = shortOf(report);

  return (
    <>
      <p className="mt-4 max-w-2xl text-sm text-ink-muted">
        The stock now, in the batches that may be sold, beside how fast each
        pack size sold in the period
        {rateDays > 0
          ? `: ${days(rateDays)} to today.`
          : ', which has no days to today yet.'}
        {byPlace
          ? ' A state or a way of paying never narrows the stock: the shop keeps one store for all.'
          : ''}
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <LinkTile
          label="Out of stock"
          value={totals.out}
          note={
            totals.out > 0
              ? 'Pack sizes on sale with nothing that may be sold.'
              : 'Every pack size on sale has stock.'
          }
          alert={totals.out > 0}
          to="/stock?status=out"
          linkText="See them on the Stock page"
        />
        <LinkTile
          label="Low"
          value={totals.low}
          note="At their own low mark or below."
          to="/stock?status=low"
          linkText="See the low ones"
        />
        <LinkTile
          label="Packs that may be sold"
          value={totals.sellablePacks}
          note={`In ${signedCount(totals.packSizes, 'pack size', 'pack sizes')} on sale.`}
        />
        <LinkTile
          label="Worth"
          value={rupees(totals.sellableRupees)}
          note="At today’s prices, GST included."
        />
        <div className="sm:col-span-2">
          <LinkTile
            label="Too near expiry to sell"
            value={totals.unsellablePacks}
            note={
              totals.unsellablePacks > 0
                ? 'Packs in batches with less than 6 months left: write them off or send them back.'
                : 'No pack on the shelf is too near its expiry.'
            }
            alert={totals.unsellablePacks > 0}
          />
        </div>
      </div>

      <div className="mt-4">
        <TopList
          title="Days of cover"
          note={`How long the packs that may be sold last at the period’s rate of sale, the shortest first. Those out of stock are below.${
            idle > 0
              ? ` ${signedCount(idle, 'pack size', 'pack sizes')} on sale with stock did not sell in the period.`
              : ''
          }`}
          items={cover}
          empty="Nothing on sale sold in this period."
          fewer="Show the 10 shortest"
        />
      </div>

      <div className={`${TILE} mt-4`}>
        <h2 className="font-semibold">Out of stock or low</h2>
        <p className="mt-1 text-sm text-ink-muted">
          The pack sizes on sale to order more of, those out first.
        </p>
        {short.length === 0 ? (
          <p className="mt-4 text-sm text-ink-muted">
            Every pack size on sale has more than its low mark.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Out of stock or low</caption>
              <thead className="bg-surface-muted text-xs text-ink-muted">
                <tr>
                  <th scope="col" className="px-3 py-1.5 font-medium">
                    Pack size
                  </th>
                  <th scope="col" className={NUMBER_HEAD}>
                    May be sold
                  </th>
                  <th scope="col" className={`${NUMBER_HEAD} ${WIDE_ONLY}`}>
                    Low at
                  </th>
                  <th scope="col" className={`${NUMBER_HEAD} ${WIDE_ONLY}`}>
                    Sold in the period
                  </th>
                  <th scope="col" className={NUMBER_HEAD}>
                    Cover
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {short.map((each) => (
                  <tr key={each.variantId}>
                    <th scope="row" className="px-3 py-1.5 font-normal">
                      <span className="flex flex-wrap items-center gap-2">
                        <Link
                          to={`/stock/${each.variantId}`}
                          className={NAME_LINK}
                        >
                          {named(each)}
                        </Link>
                        <LevelTag level={each.level} />
                      </span>
                      {/* On a phone, the columns it has no room for. */}
                      <span className="mt-1 block text-xs text-ink-muted sm:hidden">
                        Low at {count(each.lowStockAt)}, sold{' '}
                        {signedCount(each.soldPacks, 'pack', 'packs')}
                      </span>
                    </th>
                    <td className={NUMBER}>{count(each.sellable)}</td>
                    <td className={`${NUMBER} ${WIDE_ONLY}`}>
                      {count(each.lowStockAt)}
                    </td>
                    <td className={`${NUMBER} ${WIDE_ONLY}`}>
                      {signedCount(each.soldPacks, 'pack', 'packs')}
                    </td>
                    <td className={NUMBER}>
                      {each.daysOfCover === null
                        ? 'Did not sell'
                        : days(each.daysOfCover)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={`${TILE} mt-4`}>
        <h2 className="font-semibold">Running out of shelf life</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Batches that stop selling within 90 days, or have, still holding
          packs: a batch stops selling 6 months before it expires. What is left
          is at the period’s rate, the first to expire selling first.
        </p>
        {report.shelfLife.length === 0 ? (
          <p className="mt-4 text-sm text-ink-muted">
            No batch stops selling in the next 90 days.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Running out of shelf life</caption>
              <thead className="bg-surface-muted text-xs text-ink-muted">
                <tr>
                  <th scope="col" className="px-3 py-1.5 font-medium">
                    Batch
                  </th>
                  <th scope="col" className={NUMBER_HEAD}>
                    Packs
                  </th>
                  <th scope="col" className="px-3 py-1.5 font-medium">
                    Stops selling
                  </th>
                  <th
                    scope="col"
                    className={`px-3 py-1.5 font-medium ${WIDE_ONLY}`}
                  >
                    Left then
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {report.shelfLife.map((batch) => (
                  <tr key={batch.batchId}>
                    <th scope="row" className="px-3 py-1.5 font-normal">
                      <Link
                        to={`/stock/${batch.variantId}`}
                        className={NAME_LINK}
                      >
                        {named(batch)}
                      </Link>
                      <span className="block text-xs text-ink-muted">
                        Batch {batch.batchNumber}, expires{' '}
                        {dayName(batch.expiresOn)}
                      </span>
                    </th>
                    <td className={NUMBER}>{count(batch.packs)}</td>
                    <td className="px-3 py-1.5 align-top">
                      {batch.daysLeft > 0
                        ? `${dayName(batch.stopsSellingOn)}, in ${days(batch.daysLeft)}`
                        : `Stopped on ${dayName(batch.stopsSellingOn)}`}
                      {/* On a phone, what is left goes under it. */}
                      <span className="mt-1 block sm:hidden">
                        <LeftOver batch={batch} />
                      </span>
                    </td>
                    <td className={`px-3 py-1.5 align-top ${WIDE_ONLY}`}>
                      <LeftOver batch={batch} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
