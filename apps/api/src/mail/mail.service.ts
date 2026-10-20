import { Inject, Injectable } from '@nestjs/common';
import { MAIL_TRANSPORT } from './mail.types';
import type { MailTransport } from './mail.types';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

@Injectable()
export class MailService {
  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
  ) {}

  async sendVerificationEmail(
    to: string,
    fullName: string,
    verificationUrl: string,
  ): Promise<void> {
    await this.transport.send({
      to,
      subject: 'Verify your email address',
      text:
        `Hello ${fullName},\n\n` +
        `Please verify your email address using this link (valid for 24 hours):\n` +
        `${verificationUrl}\n\n` +
        `If you did not create an account, you can ignore this email.`,
      html:
        `<p>Hello ${escapeHtml(fullName)},</p>` +
        `<p>Please verify your email address (the link is valid for 24 hours):</p>` +
        `<p><a href="${escapeHtml(verificationUrl)}">${escapeHtml(verificationUrl)}</a></p>` +
        `<p>If you did not create an account, you can ignore this email.</p>`,
    });
  }

  // Sent when someone tries to register an email that already has an account.
  async sendAccountExistsNotice(to: string): Promise<void> {
    await this.transport.send({
      to,
      subject: 'Sign-up attempt for your email address',
      text:
        'Someone tried to create an account with this email address, but an account already exists. ' +
        'If this was you, please sign in instead. If not, you can ignore this email.',
      html:
        '<p>Someone tried to create an account with this email address, but an account already exists.</p>' +
        '<p>If this was you, please sign in instead. If not, you can ignore this email.</p>',
    });
  }
}
