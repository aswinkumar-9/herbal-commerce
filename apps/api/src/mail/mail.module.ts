import { Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { MAIL_TRANSPORT } from './mail.types';
import { SmtpMailTransport } from './smtp-mail.transport';

@Module({
  providers: [
    { provide: MAIL_TRANSPORT, useClass: SmtpMailTransport },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
