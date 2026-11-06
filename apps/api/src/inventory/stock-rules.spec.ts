import {
  addMonths,
  batchDateIssues,
  expiredIssues,
  isSellable,
  MIN_SHELF_LIFE_MONTHS,
  sellableFrom,
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
