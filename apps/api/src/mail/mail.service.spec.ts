import { MailService } from './mail.service';
import { MailMessage } from './mail.types';

describe('MailService', () => {
  const send = jest.fn<Promise<void>, [MailMessage]>();
  const service = new MailService({ send });

  beforeEach(() => send.mockReset().mockResolvedValue(undefined));

  it('sends a verification email containing the link', async () => {
    await service.sendVerificationEmail(
      'a@example.com',
      'Asha',
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
});
