import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

export type CheckResult = 'up' | 'down';

@Injectable()
export class HealthService {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {}

  async checkAll(): Promise<{ database: CheckResult; valkey: CheckResult }> {
    const [database, valkey] = await Promise.all([
      this.checkDatabase(),
      this.checkValkey(),
    ]);
    return { database, valkey };
  }

  private async checkDatabase(): Promise<CheckResult> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
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

  private async checkValkey(): Promise<CheckResult> {
    const client = new Redis(this.config.get('VALKEY_URL', { infer: true }), {
      lazyConnect: true,
      connectTimeout: 2000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    client.on('error', () => undefined);
    try {
      await client.connect();
      await client.ping();
      return 'up';
    } catch {
      return 'down';
    } finally {
      client.disconnect();
    }
  }
}
