import { STATUS_NAMES, STATUS_STYLES, countName } from './order-display';
import type { OrderStatus } from './orders-api';
import { useToPackCount } from './orders-queries';

// An order's status in its colour. The word says it too, for those who
// cannot tell the colours apart.
export function StatusTag({ status }: { status: OrderStatus }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold shadow-chip inset-shadow-clay ${STATUS_STYLES[status]}`}
    >
      {STATUS_NAMES[status]}
    </span>
  );
}

// Beside Orders in the menu: how many paid orders wait to be packed,
// looked at again every minute. Nothing when there are none, or when the
// count can't be read: the Orders page says why.
export function ToPackCount() {
  const toPack = useToPackCount();
  if (!toPack.data || toPack.data.count === 0) {
    return null;
  }
  // Read out as "Orders: 2 to pack". The spaces sit outside the hidden
  // words, where they are kept; on screen they fall at the ends of the line.
  return (
    <span className="relative ml-auto rounded-full bg-warning-soft px-2 text-[0.6875rem] font-semibold text-warning tabular-nums shadow-chip inset-shadow-clay">
      <span className="sr-only">:</span> {countName(toPack.data)}{' '}
      <span className="sr-only">to pack</span>
    </span>
  );
}
