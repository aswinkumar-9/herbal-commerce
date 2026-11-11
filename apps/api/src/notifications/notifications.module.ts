import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { NotificationSender } from './notification-sender';
import { NotificationsScheduler } from './notifications.scheduler';
import { NotificationsService } from './notifications.service';

// The emails about orders (ADR 0029). The orders and the payments save
// them here, in the transaction of the change each tells of. They are
// written and sent every minute, and tried again when sending fails.
@Module({
  imports: [MailModule],
  providers: [NotificationsService, NotificationSender, NotificationsScheduler],
  exports: [NotificationsService],
})
export class NotificationsModule {}
