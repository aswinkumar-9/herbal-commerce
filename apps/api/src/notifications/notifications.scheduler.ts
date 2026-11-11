import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';

const RUN_EVERY_MS = 60 * 1000;

// Sends the waiting emails inside the API (ADR 0029): every minute, the
// first a minute after startup. An email that could not be sent is tried
// again by a later run, when its wait is over. On shutdown, the run going
// on is let finish.
@Injectable()
export class NotificationsScheduler
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private everyMinute?: NodeJS.Timeout;

  constructor(private readonly notifications: NotificationsService) {}

  onApplicationBootstrap(): void {
    this.everyMinute = setInterval(
      () => this.notifications.wake(),
      RUN_EVERY_MS,
    );
    // The timer alone must never keep the process alive.
    this.everyMinute.unref();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.everyMinute);
    await this.notifications.settled();
  }
}
