import type { Order, ShipmentFields } from './orders-api';

// What staff type when the courier takes an order, checked by the API's
// own rules (ADR 0028) before it is sent: the courier they booked, and its
// tracking number.

export const SHIPMENT_FIELDS = ['courierName', 'trackingNumber'] as const;
export type ShipmentField = (typeof SHIPMENT_FIELDS)[number];
export type ShipmentErrors = Partial<Record<ShipmentField, string>>;

export const COURIER_MAX = 60;
export const TRACKING_MAX = 40;

export const COURIER_RULE = 'Name the courier in 2 to 60 characters';
export const TRACKING_RULE =
  'A tracking number has 4 to 40 letters, digits or hyphens';

// As the API keeps them: the courier without spaces at the ends or runs of
// them, the tracking number without spaces and in capitals.
export const tidyCourier = (text: string) => text.trim().replace(/\s+/g, ' ');
export const tidyTracking = (text: string) =>
  text.replace(/\s+/g, '').toUpperCase();

const TRACKING = /^[A-Z0-9][A-Z0-9-]{3,39}$/;

export function checkShipment(values: ShipmentFields): ShipmentErrors {
  const errors: ShipmentErrors = {};
  const courier = tidyCourier(values.courierName);
  if (courier.length < 2 || courier.length > COURIER_MAX) {
    errors.courierName = COURIER_RULE;
  }
  if (!TRACKING.test(tidyTracking(values.trackingNumber))) {
    errors.trackingNumber = TRACKING_RULE;
  }
  return errors;
}

// The shipment as it will be sent.
export function toShipment(values: ShipmentFields): ShipmentFields {
  return {
    courierName: tidyCourier(values.courierName),
    trackingNumber: tidyTracking(values.trackingNumber),
  };
}

// A correction sends only what changed, compared as the API keeps them.
export function shipmentChanges(
  values: ShipmentFields,
  order: Pick<Order, 'courierName' | 'trackingNumber'>,
): Partial<ShipmentFields> {
  const tidy = toShipment(values);
  const changes: Partial<ShipmentFields> = {};
  if (tidy.courierName !== order.courierName) {
    changes.courierName = tidy.courierName;
  }
  if (tidy.trackingNumber !== order.trackingNumber) {
    changes.trackingNumber = tidy.trackingNumber;
  }
  return changes;
}
