import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Client } from 'pg';
import { Env } from '../config/env';

export type CheckResult = 'up' | 'down';

@Injectable()
export class HealthService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  async checkAll(): Promise<{ database: CheckResult; valkey: CheckResult }> {
    const [database, valkey] = await Promise.all([
      this.checkDatabase(),
      this.checkValkey(),
    ]);
    return { database, valkey };
  }

  private async checkDatabase(): Promise<CheckResult> {
    const client = new Client({
      connectionString: this.config.get('DATABASE_URL', { infer: true }),
      connectionTimeoutMillis: 2000,
    });
    client.on('error', () => undefined);
    try {
      await client.connect();
      await client.query('SELECT 1');
      return 'up';
    } catch {
      return 'down';
    } finally {
      await client.end().catch(() => undefined);
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
