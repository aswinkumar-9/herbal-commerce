import { ChevronDown, ChevronUp } from 'lucide-react';
import { useId, useState } from 'react';
import { BarList } from '../charts/BarList';
import type { BarListItem } from '../charts/BarList';
import { ColumnChart } from '../charts/ColumnChart';
import { Button } from '../components/Button';
import type { SalesReport } from './sales-api';
import {
  UNIT_NAMES,
  brandItems,
  categoryItems,
  methodItems,
  productItems,
  seriesColumns,
  stateItems,
} from './sales-breakdown';

const CARD =
  'rounded-card border border-line bg-surface p-5 shadow-clay inset-shadow-clay';

// A list this long or shorter shows whole; a longer one shows its best
// until asked for the rest.
const SHOWN_AT_FIRST = 10;

// The period's sales over time, and what they were made of (part 15D, ADR
// 0047): the best products, the categories with their subcategories, the
// best brands, the states the orders went to, and how customers paid.
export function SalesBreakdown({ report }: { report: SalesReport }) {
  const unit = UNIT_NAMES[report.series.unit];
  return (
    <>
      <div className={`${CARD} mt-4`}>
        <h2 className="font-semibold">{unit.title}</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Without GST, less refunds.
          {report.series.unit === 'week' ? ' Weeks start on Monday.' : ''}
        </p>
        <div className="mt-4">
          <ColumnChart
            label={unit.title}
            columns={seriesColumns(report)}
            tableHeaders={[unit.header, 'Sales', 'Orders']}
          />
        </div>
      </div>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
        <TopList
          title="Top products"
          note="The best 10, without GST, less refunds."
          items={productItems(report)}
        />
        <TopList
          title="Categories"
          note="Each with its subcategories under it, whose sales it includes."
          items={categoryItems(report)}
        />
        <TopList
          title="Top brands"
          note="The best 10."
          items={brandItems(report)}
        />
        <TopList
          title="States"
          note="Where the orders were delivered."
          items={stateItems(report)}
        />
        <TopList
          title="Payment methods"
          note="As customers paid on Razorpay."
          items={methodItems(report)}
        />
      </div>
    </>
  );
}

function TopList({
  title,
  note,
  items,
}: {
  title: string;
  note: string;
  items: BarListItem[];
}) {
  const [all, setAll] = useState(false);
  const listId = useId();
  const long = items.length > SHOWN_AT_FIRST;
  const shown = all || !long ? items : items.slice(0, SHOWN_AT_FIRST);
  return (
    <div className={CARD}>
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-ink-muted">{note}</p>
      <div id={listId} className="mt-4">
        {items.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing in this period.</p>
        ) : (
          <BarList label={title} items={shown} />
        )}
      </div>
      {long ? (
        <Button
          variant="ghost"
          size="sm"
          icon={all ? ChevronUp : ChevronDown}
          aria-expanded={all}
          aria-controls={listId}
          onClick={() => setAll((open) => !open)}
          className="mt-3"
        >
          {all ? `Show the best ${SHOWN_AT_FIRST}` : `Show all ${items.length}`}
        </Button>
      ) : null}
    </div>
  );
}
