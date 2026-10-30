import { MailService } from './mail.service';
import { MailMessage } from './mail.types';

describe('MailService', () => {
  const send = jest.fn<Promise<void>, [MailMessage]>();
  const service = new MailService({ send });

  beforeEach(() => send.mockReset().mockResolvedValue(undefined));

  it('sends a verification email containing the link', async () => {
    await service.sendVerificationEmail(
      'a@example.com',
      'Aswin',
      'http://localhost:3001/verify?token=abc',
    );
    const message = send.mock.calls[0][0];
    expect(message.to).toBe('a@example.com');
    expect(message.text).toContain('http://localhost:3001/verify?token=abc');
    expect(message.html).toContain('http://localhost:3001/verify?token=abc');
  });

  it('escapes the name in the HTML body', async () => {
    await service.sendVerificationEmail(
      'a@example.com',
      '<script>alert(1)</script>',
      'http://localhost:3001/verify?token=abc',
    );
    const message = send.mock.calls[0][0];
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
  });

  it('sends the account-exists notice without any link', async () => {
    await service.sendAccountExistsNotice('a@example.com');
    const message = send.mock.calls[0][0];
    expect(message.text).not.toContain('http');
    expect(message.html).not.toContain('href');
  });

  it('sends the reset link and says it is valid for 30 minutes', async () => {
    await service.sendPasswordResetEmail(
      'a@example.com',
      'Aswin',
      'http://localhost:3001/reset-password?token=abc',
    );
    const message = send.mock.calls[0][0];
    expect(message.to).toBe('a@example.com');
    expect(message.subject).toBe('Reset your password');
    expect(message.text).toContain('http://localhost:3001/reset-password?token=abc');
    expect(message.html).toContain('href="http://localhost:3001/reset-password?token=abc"');
    expect(message.text).toContain('30 minutes');
  });

  it('escapes the name in the reset email', async () => {
    await service.sendPasswordResetEmail(
      'a@example.com',
      '<img src=x onerror=alert(1)>',
      'http://localhost:3001/reset-password?token=abc',
    );
    const message = send.mock.calls[0][0];
    expect(message.html).not.toContain('<img');
    expect(message.html).toContain('&lt;img');
  });

  it('sends the password-changed notice without any link', async () => {
    await service.sendPasswordChangedNotice('a@example.com', 'Aswin');
    const message = send.mock.calls[0][0];
    expect(message.subject).toBe('Your password was changed');
    expect(message.text).toContain('signed out on all devices');
    expect(message.text).not.toContain('http');
    expect(message.html).not.toContain('href');
  });

  it('sends the Admin invitation with its link, valid for 72 hours', async () => {
    await service.sendAdminInvitation(
      'dev.admin1@example.com',
      'Dev Admin',
      'http://localhost:3001/staff/accept-invite?token=abc',
    );
    const message = send.mock.calls[0][0];
    expect(message.to).toBe('dev.admin1@example.com');
    expect(message.subject).toBe('You are invited to Herbal Commerce as an Admin');
    expect(message.text).toContain(
      'http://localhost:3001/staff/accept-invite?token=abc',
    );
    expect(message.html).toContain(
      'href="http://localhost:3001/staff/accept-invite?token=abc"',
    );
    expect(message.text).toContain('72 hours');
  });

  it('escapes the name in the invitation', async () => {
    await service.sendAdminInvitation(
      'dev.admin1@example.com',
      '<b onmouseover=alert(1)>',
      'http://localhost:3001/staff/accept-invite?token=abc',
    );
    const message = send.mock.calls[0][0];
    expect(message.html).not.toContain('<b ');
    expect(message.html).toContain('&lt;b onmouseover');
  });
});
