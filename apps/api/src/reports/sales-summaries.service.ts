import { Injectable } from '@nestjs/common';
import { todayInIndia } from '../inventory/stock-rules';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

// A day in India as the database's DATE takes it, such as "2026-11-25".
const dateOf = (day: Date) => day.toISOString().slice(0, 10);

@Injectable()
export class SalesSummariesService {
  constructor(private readonly prisma: PrismaService) {}

  // Rebuilds the sales summaries (ADR 0046) through today in India, from
  // the day before the last rebuild's day: yesterday and today, as a rule.
  // So a payment saved just after a rebuild began is never missed, even
  // across midnight or after the API was down for days. The first time,
  // every day. The database decides what each day holds
  // (rebuild_sales_summaries). Answers whether it was the first time.
  async refresh(now = new Date()): Promise<{ everyDay: boolean }> {
    const last = await this.prisma.salesSummaryRefresh.findUnique({
      where: { id: 1 },
      select: { refreshedAt: true },
    });
    const firstDay = last
      ? dateOf(new Date(todayInIndia(last.refreshedAt).getTime() - DAY_MS))
      : null;
    const lastDay = dateOf(todayInIndia(now));
    await this.prisma
      .$executeRaw`SELECT rebuild_sales_summaries(${firstDay}::date, ${lastDay}::date)`;
    return { everyDay: last === null };
  }
}
