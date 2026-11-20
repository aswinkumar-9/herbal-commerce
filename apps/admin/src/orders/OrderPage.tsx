import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Ban,
  PackageCheck,
  PenLine,
  Printer,
  SearchX,
  Truck,
  CircleCheck,
  History,
} from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { ApiError } from '../api/api-error';
import { problemMessage } from '../api/problems';
import { useSession } from '../auth/session-context';
import { EmptyList, ListLoading, LoadFailed } from '../catalog/list-states';
import { packName, rupees } from '../catalog/products/pack-size-form';
import { Button, buttonClass } from '../components/Button';
import { useToasts } from '../components/toast-context';
import { useListSearch } from '../list-search';
import { usePageTitle } from '../page-title';
import { momentName } from '../stock/stock-display';
import { GiveBackButton, GivenBack, useGiveBack } from './GiveBack';
import { FAILED_REFUND_HELP, REFUND_REASON_NAMES } from './order-display';
import {
  CancelDialog,
  CorrectShipmentDialog,
  DeliveredDialog,
  Problem,
  STEPPING,
  ShipDialog,
  useStepping,
} from './OrderDialogs';
import { markPacked } from './orders-api';
import type { Order, OrderStatus, Payment } from './orders-api';
import { orderChanged, orderKeys, useOrder } from './orders-queries';
import { RefundTag, StatusTag } from './OrderTags';
import { PackingSlip } from './PackingSlip';

type DialogKind = 'ship' | 'correct' | 'delivered' | 'cancel';

// Until it ships, a Super User may cancel an order.
const CANCELLABLE: readonly OrderStatus[] = [
  'PENDING_PAYMENT',
  'PAID',
  'PACKED',
];

// One order, to pack, ship and deliver it (ADR 0028, ADR 0037):
// /orders/:id. The ID comes from the address bar, so one that is not an ID
// is never sent (orders-api.ts).
export function OrderPage() {
  const { id = '' } = useParams();
  return <OrderView key={id} id={id} />;
}

// Opened from the Refunds tab (RefundsPage), an order leads back there.
function useFromRefunds(): boolean {
  const { state } = useLocation() as { state: unknown };
  return (
    typeof state === 'object' &&
    state !== null &&
    'from' in state &&
    state.from === 'refunds'
  );
}

function OrderView({ id }: { id: string }) {
  const order = useOrder(id);
  const listSearch = useListSearch();
  const fromRefunds = useFromRefunds();
  const back = fromRefunds
    ? { pathname: '/orders/refunds', search: '' }
    : { pathname: '/orders', search: listSearch };
  usePageTitle(order.data ? `Order ${order.data.reference}` : 'Order');
  const missing = order.error instanceof ApiError && order.error.status === 404;

  return (
    <section className="max-w-5xl">
      <Link
        to={back}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink print:hidden"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {fromRefunds ? 'Refunds' : 'Orders'}
      </Link>
      {order.isPending ? (
        <>
          <h1 className="mt-3 text-2xl font-semibold">Order</h1>
          <ListLoading label="Loading the order…" />
        </>
      ) : missing ? (
        <>
          <h1 className="mt-3 text-2xl font-semibold">No such order</h1>
          <EmptyList
            icon={SearchX}
            title="There is no such order"
            action={
              <Link to={back} className={buttonClass()}>
                {fromRefunds ? 'Back to the refunds' : 'Back to the orders'}
              </Link>
            }
          >
            The address is not quite right. Find the order by its reference on
            the Orders page.
          </EmptyList>
        </>
      ) : order.isError ? (
        <>
          <h1 className="mt-3 text-2xl font-semibold">Order</h1>
          <LoadFailed
            title="The order could not be loaded"
            message={problemMessage(order.error)}
            retrying={order.isFetching}
            onRetry={() => void order.refetch()}
          />
        </>
      ) : (
        <OrderDetails order={order.data} />
      )}
    </section>
  );
}

function OrderDetails({ order }: { order: Order }) {
  const { state } = useSession();
  const superUser =
    state.status === 'signed-in' && state.staff.role === 'SUPER_USER';
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const close = () => setDialog(null);

  return (
    <>
      <div className="print:hidden">
        <header className="mt-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">
              Order <span className="font-mono">{order.reference}</span>
            </h1>
            <StatusTag status={order.status} />
            {superUser ? (
              // What staff did to it, in the audit log.
              <Link
                to={`/audit-log?target=${order.id}`}
                state={{ label: `order ${order.reference}` }}
                className={`${buttonClass('ghost', 'sm')} ml-auto`}
              >
                <History aria-hidden="true" className="size-4" />
                History
              </Link>
            ) : null}
          </div>
          <p className="mt-1 text-ink-muted">
            Placed {momentName(order.createdAt)}
          </p>
        </header>

        <NextStep order={order} superUser={superUser} open={setDialog} />

        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1fr_20rem]">
          <Items order={order} />
          <div className="space-y-6">
            <Delivery order={order} />
            <Steps order={order} />
          </div>
        </div>

        {order.payment !== undefined ? (
          <PaymentCard payment={order.payment} reference={order.reference} />
        ) : null}
      </div>

      <PackingSlip order={order} />

      <ShipDialog open={dialog === 'ship'} order={order} onClose={close} />
      <CorrectShipmentDialog
        open={dialog === 'correct'}
        order={order}
        onClose={close}
      />
      <DeliveredDialog
        open={dialog === 'delivered'}
        order={order}
        onClose={close}
      />
      {superUser ? (
        <CancelDialog
          open={dialog === 'cancel'}
          order={order}
          onClose={close}
        />
      ) : null}
    </>
  );
}

function Card({
  title,
  children,
  className = '',
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={`rounded-card border border-line bg-surface p-5 shadow-clay inset-shadow-clay ${className}`}
    >
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

// What the order waits for, and the button that takes it there. A Super
// User may also cancel it until it ships.
function NextStep({
  order,
  superUser,
  open,
}: {
  order: Order;
  superUser: boolean;
  open: (kind: DialogKind) => void;
}) {
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const stepping = useStepping();
  const [problem, setProblem] = useState<string | null>(null);
  const pack = useMutation({
    mutationKey: STEPPING,
    mutationFn: () => markPacked(order.id),
    onSuccess: (saved) => {
      setProblem(null);
      orderChanged(queryClient, saved);
      toasts.show(`${saved.reference} packed`);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: orderKeys.all });
      }
      setProblem(problemMessage(error));
    },
  });

  const slip = (
    <Button icon={Printer} onClick={() => window.print()}>
      Print packing slip
    </Button>
  );
  const steps: Record<OrderStatus, { text: string; actions: ReactNode }> = {
    PENDING_PAYMENT: {
      text: `Waiting for the customer to pay. It holds its stock until ${momentName(order.holdExpiresAt)}, then expires if not paid.`,
      actions: null,
    },
    PAID: {
      text: 'Paid. Pack the items below, then mark it packed. The customer gets an email.',
      actions: (
        <>
          {slip}
          <Button
            variant="primary"
            icon={PackageCheck}
            onClick={() => pack.mutate()}
            busy={pack.isPending}
            busyLabel="Saving…"
            disabled={stepping && !pack.isPending}
          >
            Mark packed
          </Button>
        </>
      ),
    },
    PACKED: {
      text: 'Packed. Hand it to the courier, then mark it shipped with the tracking number.',
      actions: (
        <>
          {slip}
          <Button variant="primary" icon={Truck} onClick={() => open('ship')}>
            Mark shipped
          </Button>
        </>
      ),
    },
    SHIPPED: {
      text: `On its way with ${order.courierName ?? 'the courier'}. Mark it delivered once the courier says it arrived.`,
      actions: (
        <>
          <Button icon={PenLine} onClick={() => open('correct')}>
            Correct the tracking
          </Button>
          <Button
            variant="primary"
            icon={CircleCheck}
            onClick={() => open('delivered')}
          >
            Mark delivered
          </Button>
        </>
      ),
    },
    DELIVERED: {
      text: order.deliveredAt
        ? `Delivered on ${momentName(order.deliveredAt)}. Nothing more to do.`
        : 'Delivered. Nothing more to do.',
      actions: null,
    },
    CANCELLED: {
      text: 'Cancelled before it shipped. Its packs went back into stock, and a paid order’s payment went back in full.',
      actions: null,
    },
    EXPIRED: {
      text: 'Not paid in time. Its packs went back into stock.',
      actions: null,
    },
  };
  const { text, actions } = steps[order.status];
  const cancel =
    superUser && CANCELLABLE.includes(order.status) ? (
      <Button variant="ghost" icon={Ban} onClick={() => open('cancel')}>
        Cancel the order
      </Button>
    ) : null;

  return (
    <div className="mt-6 rounded-card border border-line bg-surface p-5 shadow-clay inset-shadow-clay">
      <h2 className="sr-only">Next step</h2>
      <p>{text}</p>
      {problem ? (
        <div className="mt-3">
          <Problem>{problem}</Problem>
        </div>
      ) : null}
      {actions || cancel ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {actions}
          {cancel ? <div className="sm:ml-auto">{cancel}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

// What to pick and pack, at the prices the customer paid.
function Items({ order }: { order: Order }) {
  return (
    <Card title="Items">
      <ul className="mt-3 divide-y divide-line">
        {order.items.map((item) => (
          <li key={item.sku} className="flex items-start gap-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {item.productName}{' '}
                <span className="text-ink-muted">· {packName(item)}</span>
              </p>
              <p className="mt-0.5 text-xs text-ink-muted">
                <span className="font-mono">{item.sku}</span> · HSN{' '}
                {item.hsnCode} · GST {item.gstRate}%
              </p>
            </div>
            <div className="text-right">
              <p className="font-semibold tabular-nums">
                {item.packs} × {rupees(item.priceRupees)}
              </p>
              <p className="text-sm text-ink-muted tabular-nums">
                {rupees(item.lineTotalRupees)}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <dl className="mt-2 space-y-1 border-t border-line pt-3 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-ink-muted">Items</dt>
          <dd className="tabular-nums">{rupees(order.itemsTotalRupees)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-muted">GST included in the prices</dt>
          <dd className="tabular-nums">{rupees(order.itemsGstRupees)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-muted">Delivery</dt>
          <dd className="tabular-nums">
            {order.deliveryChargeRupees === 0
              ? 'Free'
              : rupees(order.deliveryChargeRupees)}
          </dd>
        </div>
        <div className="flex justify-between gap-4 pt-1 text-base font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums">{rupees(order.totalRupees)}</dd>
        </div>
      </dl>
    </Card>
  );
}

function Delivery({ order: { delivery } }: { order: Order }) {
  return (
    <Card title="Deliver to">
      <address className="mt-2 text-sm leading-relaxed not-italic">
        <span className="block font-medium">{delivery.fullName}</span>
        <span className="block">{delivery.line1}</span>
        {delivery.line2 ? (
          <span className="block">{delivery.line2}</span>
        ) : null}
        <span className="block">
          {delivery.city}, {delivery.state} {delivery.pincode}
        </span>
        <a
          href={`tel:+91${delivery.phone}`}
          className="mt-1 inline-block font-medium text-primary hover:underline"
        >
          {delivery.phone}
        </a>
      </address>
    </Card>
  );
}

// The order's steps so far, each with when it was taken.
function Steps({ order }: { order: Order }) {
  const paidAt = order.payment?.paidAt ?? null;
  const steps: { label: string; at: string | null; detail?: string }[] = [
    { label: 'Placed', at: order.createdAt },
  ];
  if (order.payment !== undefined) {
    steps.push({ label: 'Paid', at: paidAt });
  }
  steps.push(
    { label: 'Packed', at: order.packedAt },
    {
      label: 'Shipped',
      at: order.shippedAt,
      ...(order.courierName && order.trackingNumber
        ? { detail: `${order.courierName} · ${order.trackingNumber}` }
        : {}),
    },
    { label: 'Delivered', at: order.deliveredAt },
  );
  const ended =
    order.status === 'CANCELLED'
      ? 'Cancelled'
      : order.status === 'EXPIRED'
        ? `Expired ${momentName(order.holdExpiresAt)}`
        : null;

  return (
    <Card title="Steps">
      <ol className="mt-3 space-y-3 text-sm">
        {steps.map((step) => (
          <li key={step.label} className="flex gap-3">
            <span
              aria-hidden="true"
              className={`mt-1.5 size-2.5 shrink-0 rounded-full ${
                step.at ? 'bg-primary' : 'border border-line-strong'
              }`}
            />
            <div>
              <p className={step.at ? 'font-medium' : 'text-ink-muted'}>
                {step.label}
              </p>
              <p className="text-ink-muted">
                {step.at ? momentName(step.at) : 'Not yet'}
              </p>
              {step.detail ? (
                <p className="font-mono text-xs break-all">{step.detail}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      {ended ? (
        <p className="mt-3 rounded-lg bg-surface-muted px-3 py-2 text-sm font-medium">
          {ended}
        </p>
      ) : null}
    </Card>
  );
}

// Super Users only: the payment with Razorpay's IDs, and every refund. A
// failed one is marked here as given back by hand, once it is (ADR 0038).
function PaymentCard({
  payment,
  reference,
}: {
  payment: Payment | null;
  reference: string;
}) {
  const giveBack = useGiveBack();
  return (
    <Card title="Payment" className="mt-6">
      {payment === null ? (
        <p className="mt-2 text-sm text-ink-muted">Paying has not started.</p>
      ) : (
        <>
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-ink-muted">Amount</dt>
              <dd className="font-medium tabular-nums">
                {rupees(payment.amountRupees)}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Paid</dt>
              <dd>
                {payment.paidAt ? momentName(payment.paidAt) : 'Not paid yet'}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Razorpay payment</dt>
              <dd className="font-mono text-xs break-all">
                {payment.razorpayPaymentId ?? 'None yet'}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Razorpay order</dt>
              <dd className="font-mono text-xs break-all">
                {payment.razorpayOrderId}
              </dd>
            </div>
          </dl>
          {payment.refunds.length > 0 ? (
            <>
              <h3 className="mt-5 text-sm font-semibold">Refunds</h3>
              <ul className="mt-2 space-y-2">
                {payment.refunds.map((refund) => (
                  <li
                    key={refund.id}
                    className="rounded-lg border border-line px-3 py-2 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium tabular-nums">
                        {rupees(refund.amountRupees)}
                      </span>
                      <RefundTag refund={refund} />
                      <span className="text-ink-muted">
                        {momentName(refund.updatedAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-ink-muted">
                      {REFUND_REASON_NAMES[refund.reason]}
                    </p>
                    {refund.razorpayRefundId ? (
                      <p className="mt-0.5 font-mono text-xs break-all text-ink-muted">
                        {refund.razorpayRefundId}
                      </p>
                    ) : null}
                    {refund.status === 'FAILED' && !refund.givenBackAt ? (
                      <>
                        <p className="mt-2 font-medium text-danger">
                          {FAILED_REFUND_HELP}
                        </p>
                        <div className="mt-2">
                          <GiveBackButton
                            refund={refund}
                            orderReference={reference}
                            onMark={giveBack.mark}
                          />
                        </div>
                      </>
                    ) : null}
                    <GivenBack refund={refund} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
      {giveBack.dialog}
    </Card>
  );
}
