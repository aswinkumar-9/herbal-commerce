import type { PackUnit } from '../catalog.server.ts';
import { packName } from '../packs.ts';
import { rupees } from '../price.ts';
import { text } from '../text/en.ts';

const words = text.checkout.order;

type Line = {
  sku: string;
  productName: string;
  quantity: number;
  unit: PackUnit;
  packs: number;
  priceRupees: number;
  lineTotalRupees: number;
};

// An order's lines and what they come to, as the API priced them: at
// checkout before it is placed, and on the order's page after. GST is
// inside the prices, never added.
export function OrderSummary({
  headingId,
  heading,
  items,
  itemsTotalRupees,
  itemsGstRupees,
  deliveryChargeRupees,
  totalRupees,
}: {
  headingId: string;
  heading: string;
  items: readonly Line[];
  itemsTotalRupees: number;
  itemsGstRupees: number;
  deliveryChargeRupees: number;
  totalRupees: number;
}) {
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-3xl bg-surface p-6"
    >
      <h2 id={headingId} className="title-1 text-ink">
        {heading}
      </h2>
      <ul className="flex flex-col gap-4">
        {items.map((line) => (
          <li key={line.sku} className="flex justify-between gap-4">
            <span className="flex min-w-0 flex-col gap-1">
              <span className="body-5 break-words text-ink">
                {line.productName}, {packName(line)}
              </span>
              <span className="caption-2 text-ink-muted">
                {words.packs(line.packs, rupees(line.priceRupees))}
              </span>
            </span>
            <span className="body-5 shrink-0 text-ink">
              {rupees(line.lineTotalRupees)}
            </span>
          </li>
        ))}
      </ul>
      <dl className="flex flex-col gap-2 pt-2">
        <div className="flex justify-between gap-4">
          <dt className="body-6 text-ink-muted">{words.items}</dt>
          <dd className="body-6 text-ink">{rupees(itemsTotalRupees)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="body-6 text-ink-muted">{words.delivery}</dt>
          <dd className="body-6 text-ink">
            {deliveryChargeRupees === 0
              ? words.free
              : rupees(deliveryChargeRupees)}
          </dd>
        </div>
        <div className="flex justify-between gap-4 pt-2">
          <dt className="title-2 text-ink">{words.total}</dt>
          <dd className="title-2 text-ink">{rupees(totalRupees)}</dd>
        </div>
      </dl>
      <p className="caption-2 text-ink-muted">
        {words.gst(rupees(itemsGstRupees))}
      </p>
    </section>
  );
}
