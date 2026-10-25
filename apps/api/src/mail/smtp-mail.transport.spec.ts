import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import type { Env } from '../config/env';
import { SmtpMailTransport } from './smtp-mail.transport';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

// Returns the options the transport passes to nodemailer in one environment.
function smtpOptions(nodeEnv: Env['NODE_ENV']): unknown {
  const values: Partial<Env> = {
    NODE_ENV: nodeEnv,
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: 587,
    MAIL_FROM: 'Shop <no-reply@example.com>',
  };
  const config = { get: (key: keyof Env) => values[key] };
  jest.mocked(createTransport).mockClear();
  new SmtpMailTransport(config as unknown as ConfigService<Env, true>);
  return jest.mocked(createTransport).mock.calls[0][0];
}

describe('SmtpMailTransport', () => {
  it('refuses to send mail without TLS in production', () => {
    expect(smtpOptions('production')).toMatchObject({
      requireTLS: true,
      ignoreTLS: false,
    });
  });

  it('skips TLS only for local development (Mailpit)', () => {
    expect(smtpOptions('development')).toMatchObject({
      requireTLS: false,
      ignoreTLS: true,
    });
  });
});
