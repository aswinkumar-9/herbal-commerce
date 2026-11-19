import {
  useIsMutating,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ApiError } from '../api/api-error';
import { fieldProblems, problemMessage } from '../api/problems';
import { rupees } from '../catalog/products/pack-size-form';
import { Button } from '../components/Button';
import { Dialog, DialogActions } from '../components/Dialog';
import { Field } from '../components/Field';
import { useToasts } from '../components/toast-context';
import {
  cancelOrder,
  correctShipment,
  markDelivered,
  markShipped,
} from './orders-api';
import type { Order, ShipmentFields } from './orders-api';
import { orderChanged, orderKeys } from './orders-queries';
import {
  COURIER_MAX,
  SHIPMENT_FIELDS,
  TRACKING_MAX,
  checkShipment,
  shipmentChanges,
  toShipment,
} from './shipment-form';
import type { ShipmentErrors, ShipmentField } from './shipment-form';

// The dialogs that take an order a step on (ADR 0028, ADR 0037): handed to
// the courier, its tracking put right, delivered, or cancelled by a Super
// User. Each says what happens, and the customer is emailed at each step.

export const STEPPING = ['order-step'] as const;

export function useStepping(): boolean {
  return useIsMutating({ mutationKey: STEPPING }) > 0;
}

interface DialogProps {
  open: boolean;
  order: Order;
  onClose: () => void;
}

export function Problem({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"
    >
      {children}
    </p>
  );
}

// A step the API refused because the order moved on meanwhile, maybe by
// someone else: the page reads the order again, and the dialog says why.
function useRefused() {
  const queryClient = useQueryClient();
  return (error: unknown) => {
    if (error instanceof ApiError && error.status === 409) {
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
    }
    return problemMessage(error);
  };
}

// Handed to the courier: who took it, and its tracking number.
export function ShipDialog({ open, order, onClose }: DialogProps) {
  const busy = useStepping();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      locked={busy}
      size="md"
      title={`Ship order ${order.reference}`}
      description={
        <p>
          Once the courier has the box. The customer gets an email with the
          courier and the tracking number.
        </p>
      }
    >
      <ShipmentForm order={order} onDone={onClose} correcting={false} />
    </Dialog>
  );
}

// A typing mistake in the courier or the tracking number, while the order
// is on its way.
export function CorrectShipmentDialog({ open, order, onClose }: DialogProps) {
  const busy = useStepping();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      locked={busy}
      size="md"
      title={`Correct the tracking of ${order.reference}`}
      description={
        <p>
          Only for a typing mistake. If anything changes, the customer gets an
          email with the new details.
        </p>
      }
    >
      <ShipmentForm order={order} onDone={onClose} correcting />
    </Dialog>
  );
}

function ShipmentForm({
  order,
  onDone,
  correcting,
}: {
  order: Order;
  onDone: () => void;
  correcting: boolean;
}) {
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const why = useRefused();
  const [values, setValues] = useState<ShipmentFields>({
    courierName: correcting ? (order.courierName ?? '') : '',
    trackingNumber: correcting ? (order.trackingNumber ?? '') : '',
  });
  const [errors, setErrors] = useState<ShipmentErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const boxes = useRef<Partial<Record<ShipmentField, HTMLInputElement | null>>>(
    {},
  );
  const focusFirst = (found: ShipmentErrors) => {
    const first = SHIPMENT_FIELDS.find((name) => found[name]);
    if (first) {
      boxes.current[first]?.focus();
    }
  };

  const save = useMutation({
    mutationKey: STEPPING,
    mutationFn: (shipment: Partial<ShipmentFields>) =>
      correcting
        ? correctShipment(order.id, shipment)
        : markShipped(order.id, shipment as ShipmentFields),
    onSuccess: (saved) => {
      orderChanged(queryClient, saved);
      toasts.show(
        correcting
          ? `Tracking of ${saved.reference} corrected`
          : `${saved.reference} is on its way`,
      );
      onDone();
    },
    onError: (error) => {
      const fields = fieldProblems(error);
      const shown: ShipmentErrors = {};
      for (const name of SHIPMENT_FIELDS) {
        if (fields[name]) {
          shown[name] = fields[name];
        }
      }
      setErrors(shown);
      setProblem(Object.keys(shown).length > 0 ? null : why(error));
      focusFirst(shown);
    },
  });

  function set(name: ShipmentField, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
    if (errors[name]) {
      setErrors((current) => ({ ...current, [name]: undefined }));
    }
    setProblem(null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) {
      return;
    }
    const found = checkShipment(values);
    setErrors(found);
    setProblem(null);
    if (Object.keys(found).length > 0) {
      focusFirst(found);
      return;
    }
    if (!correcting) {
      save.mutate(toShipment(values));
      return;
    }
    const changes = shipmentChanges(values, order);
    if (Object.keys(changes).length === 0) {
      onDone();
      return;
    }
    save.mutate(changes);
  }

  return (
    <form noValidate onSubmit={submit} className="mt-5 space-y-5">
      {problem ? <Problem>{problem}</Problem> : null}
      <Field
        ref={(element) => {
          boxes.current.courierName = element;
        }}
        label="Courier"
        value={values.courierName}
        onChange={(event) => set('courierName', event.target.value)}
        maxLength={COURIER_MAX + 20}
        autoComplete="off"
        hint="The company you booked, such as the name on its receipt."
        error={errors.courierName}
      />
      <Field
        ref={(element) => {
          boxes.current.trackingNumber = element;
        }}
        label="Tracking number"
        value={values.trackingNumber}
        onChange={(event) => set('trackingNumber', event.target.value)}
        maxLength={TRACKING_MAX + 20}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        hint="As on the courier's receipt. Saved in capitals, without spaces."
        error={errors.trackingNumber}
      />
      <DialogActions>
        <Button onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          busy={save.isPending}
          busyLabel="Saving…"
        >
          {correcting ? 'Save changes' : 'Mark shipped'}
        </Button>
      </DialogActions>
    </form>
  );
}

// Once the courier says it arrived. It can't be undone, and the customer
// is told.
export function DeliveredDialog({ open, order, onClose }: DialogProps) {
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const why = useRefused();
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation({
    mutationKey: STEPPING,
    mutationFn: () => markDelivered(order.id),
    onSuccess: (saved) => {
      orderChanged(queryClient, saved);
      toasts.show(`${saved.reference} delivered`);
      onClose();
    },
    onError: (error) => setProblem(why(error)),
  });
  const close = () => {
    setProblem(null);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      locked={save.isPending}
      title={`Mark ${order.reference} delivered?`}
      description={
        <p>
          Only once {order.courierName ?? 'the courier'} says it arrived. The
          customer gets an email saying so, and it can’t be undone.
        </p>
      }
      actions={
        <>
          <Button onClick={close} disabled={save.isPending}>
            Not yet
          </Button>
          <Button
            variant="primary"
            onClick={() => save.mutate()}
            busy={save.isPending}
            busyLabel="Saving…"
          >
            Mark delivered
          </Button>
        </>
      }
    >
      {problem ? (
        <div className="mt-4">
          <Problem>{problem}</Problem>
        </div>
      ) : null}
    </Dialog>
  );
}

// Super Users only, until the order ships. Says everything that follows:
// the stock goes back, a paid order's money goes back in full, and the
// customer is told.
export function CancelDialog({ open, order, onClose }: DialogProps) {
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const why = useRefused();
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation({
    mutationKey: STEPPING,
    mutationFn: () => cancelOrder(order.id),
    onSuccess: (saved) => {
      orderChanged(queryClient, saved);
      toasts.show(`${saved.reference} cancelled`);
      onClose();
    },
    onError: (error) => setProblem(why(error)),
  });
  const close = () => {
    setProblem(null);
    onClose();
  };
  const paid = order.status === 'PAID' || order.status === 'PACKED';
  return (
    <Dialog
      open={open}
      onClose={close}
      locked={save.isPending}
      tone="danger"
      title={`Cancel order ${order.reference}?`}
      description={
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Its packs go back into stock at once.
            {order.status === 'PACKED'
              ? ' Unpack the box, and put them back on the shelf.'
              : ''}
          </li>
          {paid ? (
            <li>
              The customer gets {rupees(order.totalRupees)} back in full,
              through Razorpay. Razorpay keeps its fee, about 2.36% of the
              order.
            </li>
          ) : (
            <li>
              Nothing has been paid. If a payment still comes, it goes back on
              its own.
            </li>
          )}
          <li>The customer gets an email saying it is cancelled.</li>
          <li>It can’t be undone.</li>
        </ul>
      }
      actions={
        <>
          <Button onClick={close} disabled={save.isPending}>
            Keep the order
          </Button>
          <Button
            variant="danger"
            onClick={() => save.mutate()}
            busy={save.isPending}
            busyLabel="Cancelling…"
          >
            Cancel the order
          </Button>
        </>
      }
    >
      {problem ? (
        <div className="mt-4">
          <Problem>{problem}</Problem>
        </div>
      ) : null}
    </Dialog>
  );
}
