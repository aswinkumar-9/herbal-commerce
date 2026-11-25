import { PrismaService } from '../prisma/prisma.service';
import { SalesSummariesService } from './sales-summaries.service';

function setup(refreshedAt: Date | null) {
  const prisma = {
    salesSummaryRefresh: {
      findUnique: jest
        .fn()
        .mockResolvedValue(refreshedAt ? { refreshedAt } : null),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  const summaries = new SalesSummariesService(
    prisma as unknown as PrismaService,
  );
  // The SQL the database was asked, and the days it was given.
  const asked = () => {
    const [strings, ...values] = prisma.$executeRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    return { sql: strings.join('?'), days: values };
  };
  return { summaries, prisma, asked };
}

describe('SalesSummariesService.refresh', () => {
  it('fills every day the first time, through today in India', async () => {
    const { summaries, prisma, asked } = setup(null);

    await expect(
      summaries.refresh(new Date('2026-11-25T10:00:00Z')),
    ).resolves.toEqual({ everyDay: true });
    expect(prisma.salesSummaryRefresh.findUnique).toHaveBeenCalledWith({
      where: { id: 1 },
      select: { refreshedAt: true },
    });
    expect(asked()).toEqual({
      sql: 'SELECT rebuild_sales_summaries(?::date, ?::date)',
      days: [null, '2026-11-25'],
    });
  });

  it('then rebuilds yesterday and today', async () => {
    const { summaries, asked } = setup(new Date('2026-11-25T09:55:00Z'));

    await expect(
      summaries.refresh(new Date('2026-11-25T10:00:00Z')),
    ).resolves.toEqual({ everyDay: false });
    expect(asked().days).toEqual(['2026-11-24', '2026-11-25']);
  });

  it('counts days in India, not in UTC', async () => {
    // 25 November, 00:01 and 05:29 in India; still the 24th in UTC.
    const { summaries, asked } = setup(new Date('2026-11-24T18:31:00Z'));

    await summaries.refresh(new Date('2026-11-24T23:59:00Z'));
    expect(asked().days).toEqual(['2026-11-24', '2026-11-25']);
  });

  it('just after midnight, also goes back to the day before the last rebuild', async () => {
    // The last rebuild at 23:56 on 24 November in India, this one at 00:01
    // on the 25th: a payment saved meanwhile may be the 24th's, or late.
    const { summaries, asked } = setup(new Date('2026-11-24T18:26:00Z'));

    await summaries.refresh(new Date('2026-11-24T18:31:00Z'));
    expect(asked().days).toEqual(['2026-11-23', '2026-11-25']);
  });

  it('after days without a rebuild, rebuilds every day since', async () => {
    const { summaries, asked } = setup(new Date('2026-11-20T08:00:00Z'));

    await summaries.refresh(new Date('2026-11-25T08:00:00Z'));
    expect(asked().days).toEqual(['2026-11-19', '2026-11-25']);
  });
});
