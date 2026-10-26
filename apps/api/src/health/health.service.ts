import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ValkeyService } from '../valkey/valkey.service';

export type CheckResult = 'up' | 'down';

// 'up' if the check answers within 2 seconds, 'down' otherwise.
async function withTimeout(check: PromiseLike<unknown>): Promise<CheckResult> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      check,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), 2000);
      }),
    ]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly valkey: ValkeyService,
  ) {}

  async checkAll(): Promise<{ database: CheckResult; valkey: CheckResult }> {
    const [database, valkey] = await Promise.all([
      withTimeout(this.prisma.$queryRaw`SELECT 1`),
      // The shared connection, the same one the rest of the API uses.
      withTimeout(this.valkey.ping()),
    ]);
    return { database, valkey };
  }
}
