import { packName } from '../catalog/products/pack-size-form';
import { momentName } from '../stock/stock-display';
import type { Order } from './orders-api';

// The packing slip, for the box (ADR 0037): only on paper, never on screen.
// Black on white whatever the computer's theme, on A4 (index.css). What to
// pack and where it goes, with no prices: it is not an invoice, which waits
// until the company is registered.
export function PackingSlip({ order }: { order: Order }) {
  const { delivery } = order;
  const packs = order.items.reduce((sum, item) => sum + item.packs, 0);
  return (
    <section
      aria-label="Packing slip"
      className="hidden bg-white text-black print:block"
    >
      <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-3">
        <div>
          <p className="text-xl font-semibold">Herbal Commerce</p>
          <p className="text-sm">Packing slip. Not a tax invoice.</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-xl font-semibold">{order.reference}</p>
          <p className="text-sm">Placed {momentName(order.createdAt)}</p>
        </div>
      </header>

      <div className="mt-5">
        <p className="text-xs font-semibold tracking-wide uppercase">
          Deliver to
        </p>
        <address className="mt-1 text-base leading-snug not-italic">
          <span className="block font-semibold">{delivery.fullName}</span>
          <span className="block">{delivery.line1}</span>
          {delivery.line2 ? (
            <span className="block">{delivery.line2}</span>
          ) : null}
          <span className="block">
            {delivery.city}, {delivery.state} {delivery.pincode}
          </span>
          <span className="block">Phone {delivery.phone}</span>
        </address>
      </div>

      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-1.5 pr-3 font-semibold">Product</th>
            <th className="py-1.5 pr-3 font-semibold">Pack</th>
            <th className="py-1.5 pr-3 font-semibold">SKU</th>
            <th className="py-1.5 pr-3 text-right font-semibold">Packs</th>
            <th className="w-12 py-1.5 text-center font-semibold">Packed</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item) => (
            <tr key={item.sku} className="border-b border-black/30">
              <td className="py-2 pr-3">{item.productName}</td>
              <td className="py-2 pr-3">{packName(item)}</td>
              <td className="py-2 pr-3 font-mono">{item.sku}</td>
              <td className="py-2 pr-3 text-right text-base font-semibold tabular-nums">
                {item.packs}
              </td>
              <td className="py-2 text-center text-lg leading-none">
                {/* A box to tick by hand. */}☐
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-right text-sm font-semibold">
        Packs in all: <span className="text-base tabular-nums">{packs}</span>
      </p>

      <div className="mt-10 grid grid-cols-2 gap-10 text-sm">
        <p className="border-t border-black pt-1">Packed by</p>
        <p className="border-t border-black pt-1">Checked by</p>
      </div>
    </section>
  );
}
