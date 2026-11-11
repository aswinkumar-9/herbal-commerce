import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

// The emails about orders (ADR 0029). The orders and the payments save
// them here, in the transaction of the change each tells of.
@Module({
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
