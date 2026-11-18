import {
  addMonths,
  batchDateIssues,
  EXPIRING_SOON_DAYS,
  expiredIssues,
  isExpiringSoon,
  isSellable,
  MIN_SHELF_LIFE_MONTHS,
  sellableFrom,
  stockLevel,
  stopsSellingOn,
  todayInIndia,
} from './stock-rules';

// A date as the database returns a DATE column: that day, at midnight UTC.
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
// 6 November 2026, 10:00 in India.
const NOW = new Date('2026-11-06T04:30:00.000Z');

describe('todayInIndia', () => {
  it("is India's date, which starts five and a half hours before UTC's", () => {
    expect(todayInIndia(NOW)).toEqual(day('2026-11-06'));
    // 23:59:59 in India: still the 6th.
    expect(todayInIndia(new Date('2026-11-06T18:29:59.999Z'))).toEqual(
      day('2026-11-06'),
    );
    // Midnight in India: already the 7th, while UTC is still on the 6th.
    expect(todayInIndia(new Date('2026-11-06T18:30:00.000Z'))).toEqual(
      day('2026-11-07'),
    );
  });
});

describe('addMonths', () => {
  it('keeps the day, across the end of a year', () => {
    expect(addMonths(day('2026-11-06'), 6)).toEqual(day('2027-05-06'));
    expect(addMonths(day('2026-12-15'), 6)).toEqual(day('2027-06-15'));
  });

  it("uses the later month's last day when it has no such day", () => {
    expect(addMonths(day('2026-08-31'), 6)).toEqual(day('2027-02-28'));
    expect(addMonths(day('2027-08-31'), 6)).toEqual(day('2028-02-29'));
    expect(addMonths(day('2026-12-31'), 6)).toEqual(day('2027-06-30'));
  });
});

describe('sellableFrom and isSellable', () => {
  it('sells a batch with at least 6 months left, not a day less', () => {
    expect(MIN_SHELF_LIFE_MONTHS).toBe(6);
    expect(sellableFrom(NOW)).toEqual(day('2027-05-06'));
    expect(isSellable(day('2027-05-06'), NOW)).toBe(true);
    expect(isSellable(day('2028-01-01'), NOW)).toBe(true);
    expect(isSellable(day('2027-05-05'), NOW)).toBe(false);
  });

  it("moves on at India's midnight", () => {
    const nextDay = new Date('2026-11-06T18:30:00.000Z');
    expect(isSellable(day('2027-05-06'), nextDay)).toBe(false);
    expect(isSellable(day('2027-05-07'), nextDay)).toBe(true);
  });
});

describe('batchDateIssues', () => {
  it('accepts a batch made today or before, expiring after it was made', () => {
    expect(
      batchDateIssues(
        { manufacturedOn: day('2026-11-06'), expiresOn: day('2026-11-07') },
        NOW,
      ),
    ).toEqual([]);
    // An old batch is fine here: only receiving it would check its expiry.
    expect(
      batchDateIssues(
        { manufacturedOn: day('2020-01-01'), expiresOn: day('2021-01-01') },
        NOW,
      ),
    ).toEqual([]);
  });

  it('refuses a manufacturing date still to come, and an expiry not after it', () => {
    expect(
      batchDateIssues(
        { manufacturedOn: day('2026-11-07'), expiresOn: day('2026-11-07') },
        NOW,
      ),
    ).toEqual([
      {
        field: 'manufacturedOn',
        message: 'The manufacturing date cannot be in the future',
      },
      {
        field: 'expiresOn',
        message: 'The expiry date must be after the manufacturing date',
      },
    ]);
    expect(
      batchDateIssues(
        { manufacturedOn: day('2026-10-01'), expiresOn: day('2026-09-30') },
        NOW,
      ),
    ).toEqual([
      {
        field: 'expiresOn',
        message: 'The expiry date must be after the manufacturing date',
      },
    ]);
  });
});

describe('expiredIssues', () => {
  it('refuses a batch that expires today or has expired', () => {
    const expired = [
      { field: 'expiresOn', message: 'This batch has already expired' },
    ];
    expect(expiredIssues(day('2026-11-05'), NOW)).toEqual(expired);
    expect(expiredIssues(day('2026-11-06'), NOW)).toEqual(expired);
    expect(expiredIssues(day('2026-11-07'), NOW)).toEqual([]);
  });
});

describe('stopsSellingOn', () => {
  it('is the day the batch has less than 6 months left', () => {
    expect(stopsSellingOn(day('2028-09-30'))).toEqual(day('2028-04-01'));
    expect(stopsSellingOn(day('2027-05-06'))).toEqual(day('2026-11-07'));
    expect(stopsSellingOn(day('2027-05-05'))).toEqual(day('2026-11-06'));
  });

  it("goes past a month's end when a shorter month ends the 6 months", () => {
    // 29, 30 and 31 August all reach 28 February, so they still sell it.
    expect(stopsSellingOn(day('2027-02-28'))).toEqual(day('2026-09-01'));
    // A leap year's 29 February is reached from 29 August to 31 August.
    expect(stopsSellingOn(day('2028-02-29'))).toEqual(day('2027-09-01'));
    expect(stopsSellingOn(day('2028-02-28'))).toEqual(day('2027-08-29'));
    expect(stopsSellingOn(day('2027-04-30'))).toEqual(day('2026-11-01'));
  });

  it('agrees with isSellable on every day, for expiry dates over four years', () => {
    const DAY = 86_400_000;
    for (let expiry = day('2027-01-01').getTime(); expiry < day('2031-01-01').getTime(); expiry += DAY) {
      const expiresOn = new Date(expiry);
      const stops = stopsSellingOn(expiresOn);
      // The day before, at noon in India, it still sells; that day, it no
      // longer does.
      const noon = (date: Date) => new Date(date.getTime() + 6.5 * 3_600_000);
      expect([expiresOn, isSellable(expiresOn, noon(new Date(stops.getTime() - DAY)))]).toEqual([expiresOn, true]);
      expect([expiresOn, isSellable(expiresOn, noon(stops))]).toEqual([expiresOn, false]);
    }
  });
});

describe('isExpiringSoon', () => {
  it(`is a batch that sells today and stops within ${EXPIRING_SOON_DAYS} days`, () => {
    // Stops on 6 December 2026: in 30 days.
    expect(isExpiringSoon(day('2027-06-05'), NOW)).toBe(true);
    // Stops on 7 December: in 31 days.
    expect(isExpiringSoon(day('2027-06-06'), NOW)).toBe(false);
    // Stops tomorrow.
    expect(isExpiringSoon(day('2027-05-06'), NOW)).toBe(true);
  });

  it('is never a batch that no longer sells', () => {
    expect(isExpiringSoon(day('2027-05-05'), NOW)).toBe(false);
    expect(isExpiringSoon(day('2026-11-01'), NOW)).toBe(false);
  });
});

describe('stockLevel', () => {
  it('is out with nothing to sell, low at its number or fewer, and otherwise enough', () => {
    expect(stockLevel(0, 10)).toBe('OUT');
    expect(stockLevel(1, 10)).toBe('LOW');
    expect(stockLevel(10, 10)).toBe('LOW');
    expect(stockLevel(11, 10)).toBe('OK');
  });

  it('is never low at 0, but still out', () => {
    expect(stockLevel(1, 0)).toBe('OK');
    expect(stockLevel(0, 0)).toBe('OUT');
  });
});
