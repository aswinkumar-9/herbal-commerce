import {
  REFUND_STATUS_NAMES,
  REFUND_STATUS_STYLES,
  STATUS_NAMES,
  STATUS_STYLES,
  countName,
  refundShown,
} from './order-display';
import type { OrderStatus, RefundStatus } from './orders-api';
import { useToPackCount } from './orders-queries';

const TAG =
  'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold shadow-chip inset-shadow-clay';

// An order's status in its colour. The word says it too, for those who
// cannot tell the colours apart.
export function StatusTag({ status }: { status: OrderStatus }) {
  return (
    <span className={`${TAG} ${STATUS_STYLES[status]}`}>
      {STATUS_NAMES[status]}
    </span>
  );
}

// A refund's status, the same way: a failed one given back by hand shows
// as given back.
export function RefundTag({
  refund,
}: {
  refund: { status: RefundStatus; givenBackAt: string | null };
}) {
  const shown = refundShown(refund);
  return (
    <span className={`${TAG} ${REFUND_STATUS_STYLES[shown]}`}>
      {REFUND_STATUS_NAMES[shown]}
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
    <span className="relative ml-auto rounded-full bg-warning-soft px-2 py-0.5 text-[0.6875rem] font-semibold text-warning tabular-nums shadow-chip inset-shadow-clay">
      <span className="sr-only">:</span> {countName(toPack.data)}{' '}
      <span className="sr-only">to pack</span>
    </span>
  );
}
