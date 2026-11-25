import { salesReportQuerySchema } from './reports.schemas';

// The messages a query is refused with, by field.
function refusals(query: object) {
  const result = salesReportQuerySchema.safeParse(query);
  return result.success
    ? []
    : result.error.issues.map((issue) => [issue.path.join('.'), issue.message]);
}

describe('salesReportQuerySchema', () => {
  it('takes a period of days in India, and ignores anything else', () => {
    expect(
      salesReportQuerySchema.parse({
        from: '2026-11-01',
        to: '2026-11-25',
        other: 'x',
      }),
    ).toEqual({ from: '2026-11-01', to: '2026-11-25' });
    expect(refusals({ from: '2026-11-25', to: '2026-11-25' })).toEqual([]);
  });

  it('needs both days, each a real date written like 2026-11-25', () => {
    const message = 'Use a date such as 2026-11-25';
    expect(refusals({})).toEqual([
      ['from', message],
      ['to', message],
    ]);
    for (const day of ['25-11-2026', '2026-11-5', '2026-02-30', '2026-13-01']) {
      expect(refusals({ from: day, to: '2026-11-25' })).toEqual([
        ['from', message],
      ]);
    }
  });

  it('refuses a period that starts after it ends', () => {
    expect(refusals({ from: '2026-11-26', to: '2026-11-25' })).toEqual([
      ['to', 'The period starts after it ends'],
    ]);
  });

  it('takes at most 3660 days', () => {
    expect(refusals({ from: '2016-11-18', to: '2026-11-25' })).toEqual([]);
    expect(refusals({ from: '2016-11-17', to: '2026-11-25' })).toEqual([
      ['to', 'Choose at most 3660 days'],
    ]);
  });
});
