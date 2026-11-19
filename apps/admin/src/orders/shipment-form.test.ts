import { describe, expect, it } from 'vitest';
import {
  COURIER_RULE,
  TRACKING_RULE,
  checkShipment,
  shipmentChanges,
  toShipment,
} from './shipment-form';

describe('what staff type when the courier takes an order', () => {
  it('takes the courier and the tracking number as the API keeps them', () => {
    const typed = {
      courierName: '  Blue   Dart ',
      trackingNumber: 'ee 1490 8112-3456',
    };
    expect(checkShipment(typed)).toEqual({});
    expect(toShipment(typed)).toEqual({
      courierName: 'Blue Dart',
      trackingNumber: 'EE14908112-3456',
    });
  });

  it.each([
    ['', COURIER_RULE],
    ['   D   ', COURIER_RULE],
    ['x'.repeat(61), COURIER_RULE],
  ])('refuses the courier %j', (courierName, error) => {
    expect(
      checkShipment({ courierName, trackingNumber: 'EE1490' }).courierName,
    ).toBe(error);
  });

  it('takes a courier of 2 and of 60 characters', () => {
    for (const courierName of ['DD', 'x'.repeat(60)]) {
      expect(checkShipment({ courierName, trackingNumber: 'EE1490' })).toEqual(
        {},
      );
    }
  });

  it.each(['', 'EE1', '-EE1490', 'EE#1490', 'E'.repeat(41)])(
    'refuses the tracking number %j',
    (trackingNumber) => {
      expect(
        checkShipment({ courierName: 'Delhivery', trackingNumber })
          .trackingNumber,
      ).toBe(TRACKING_RULE);
    },
  );

  it('takes a tracking number of 4 and of 40', () => {
    for (const trackingNumber of ['EE14', 'E'.repeat(40)]) {
      expect(
        checkShipment({ courierName: 'Delhivery', trackingNumber }),
      ).toEqual({});
    }
  });
});

describe('a correction', () => {
  const shipped = {
    courierName: 'Delhivery',
    trackingNumber: 'EE149081123456',
  };

  it('sends only what changed, compared as the API keeps them', () => {
    expect(
      shipmentChanges(
        { courierName: ' Delhivery ', trackingNumber: 'ee 1490 8112 3456' },
        shipped,
      ),
    ).toEqual({});
    expect(
      shipmentChanges(
        { courierName: 'Delhivery', trackingNumber: 'EE149081123457' },
        shipped,
      ),
    ).toEqual({ trackingNumber: 'EE149081123457' });
    expect(
      shipmentChanges(
        { courierName: 'Blue Dart', trackingNumber: 'BD1234' },
        shipped,
      ),
    ).toEqual({ courierName: 'Blue Dart', trackingNumber: 'BD1234' });
  });
});
