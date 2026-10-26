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

  async sendPasswordResetEmail(
    to: string,
    fullName: string,
    resetUrl: string,
  ): Promise<void> {
    await this.transport.send({
      to,
      subject: 'Reset your password',
      text:
        `Hello ${fullName},\n\n` +
        `Use this link to choose a new password (valid for 30 minutes, and only once):\n` +
        `${resetUrl}\n\n` +
        `If you did not ask for this, you can ignore this email. Your password stays the same.`,
      html:
        `<p>Hello ${escapeHtml(fullName)},</p>` +
        `<p>Use this link to choose a new password (valid for 30 minutes, and only once):</p>` +
        `<p><a href="${escapeHtml(resetUrl)}">${escapeHtml(resetUrl)}</a></p>` +
        `<p>If you did not ask for this, you can ignore this email. Your password stays the same.</p>`,
    });
  }

  // Sent after every password reset. No link on purpose: a security notice
  // with a link teaches people to click links in emails.
  async sendPasswordChangedNotice(to: string, fullName: string): Promise<void> {
    await this.transport.send({
      to,
      subject: 'Your password was changed',
      text:
        `Hello ${fullName},\n\n` +
        `The password of your account was just changed, and you were signed out on all devices.\n\n` +
        `If this was you, there is nothing else to do. If it was not, open the app or website ` +
        `yourself, choose "Forgot password" to set a new one, and contact our support.`,
      html:
        `<p>Hello ${escapeHtml(fullName)},</p>` +
        `<p>The password of your account was just changed, and you were signed out on all devices.</p>` +
        `<p>If this was you, there is nothing else to do. If it was not, open the app or website ` +
        `yourself, choose "Forgot password" to set a new one, and contact our support.</p>`,
    });
  }
}
