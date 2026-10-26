import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import type { Env } from '../config/env';
import { ValkeyService } from './valkey.service';

// A stand-in for ioredis: it records its options and never opens a connection.
jest.mock('ioredis', () => {
  const { EventEmitter } =
    jest.requireActual<typeof import('node:events')>('node:events');
  class FakeRedis extends EventEmitter {
    status = 'ready';
    quit = jest.fn().mockResolvedValue('OK');
    disconnect = jest.fn();
    constructor(
      readonly url: string,
      readonly options: Record<string, unknown>,
    ) {
      super();
    }
  }
  return { __esModule: true, default: FakeRedis };
});

type FakeValkey = ValkeyService & {
  url: string;
  options: Record<string, unknown>;
  quit: jest.Mock;
  disconnect: jest.Mock;
};

function setup() {
  const config = { get: () => 'redis://localhost:6379' };
  const logger = { info: jest.fn(), warn: jest.fn() };
  const valkey = new ValkeyService(
    config as unknown as ConfigService<Env, true>,
    logger as unknown as PinoLogger,
  ) as FakeValkey;
  return { valkey, logger };
}

describe('ValkeyService', () => {
  it('connects to VALKEY_URL and fails fast while Valkey is unreachable', () => {
    const { valkey } = setup();
    expect(valkey.url).toBe('redis://localhost:6379');
    expect(valkey.options).toMatchObject({
      enableOfflineQueue: false,
      commandTimeout: 1000,
    });
  });

  it('logs once when Valkey goes away and once when it is back', () => {
    const { valkey, logger } = setup();
    const refused = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
    });
    valkey.emit('error', refused);
    valkey.emit('error', refused);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      { errorName: 'Error', code: 'ECONNREFUSED' },
      'Valkey is unreachable',
    );

    valkey.emit('ready');
    valkey.emit('ready');
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it('closes a ready connection gracefully on shutdown', async () => {
    const { valkey } = setup();
    await valkey.onModuleDestroy();
    expect(valkey.quit).toHaveBeenCalled();
    expect(valkey.disconnect).not.toHaveBeenCalled();
  });

  it('drops a connection that is not ready on shutdown', async () => {
    const { valkey } = setup();
    Object.assign(valkey, { status: 'reconnecting' });
    await valkey.onModuleDestroy();
    expect(valkey.disconnect).toHaveBeenCalled();
    expect(valkey.quit).not.toHaveBeenCalled();
  });
});
