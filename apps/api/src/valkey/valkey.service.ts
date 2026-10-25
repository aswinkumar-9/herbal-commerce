import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Env } from '../config/env';

// The one Valkey connection the whole API shares.
@Injectable()
export class ValkeyService extends Redis implements OnModuleDestroy {
  // Log changes only, not every reconnect attempt while Valkey is down.
  private reachable = true;

  constructor(
    config: ConfigService<Env, true>,
    @InjectPinoLogger(ValkeyService.name) logger: PinoLogger,
  ) {
    super(config.get('VALKEY_URL', { infer: true }), {
      connectTimeout: 2000,
      // While Valkey is unreachable, commands fail at once instead of waiting
      // in a queue, so no request hangs on it.
      enableOfflineQueue: false,
      commandTimeout: 1000,
    });
    this.on('error', (error: Error) => {
      if (this.reachable) {
        this.reachable = false;
        // Only the name and code: messages can contain connection details.
        logger.warn(
          { errorName: error.name, code: (error as { code?: unknown }).code },
          'Valkey is unreachable',
        );
      }
    });
    this.on('ready', () => {
      if (!this.reachable) {
        this.reachable = true;
        logger.info('Valkey is reachable again');
      }
    });
  }

  async onModuleDestroy() {
    // quit() waits for pending replies; without a connection there are none.
    if (this.status === 'ready') {
      await this.quit();
    } else {
      this.disconnect();
    }
  }
}
