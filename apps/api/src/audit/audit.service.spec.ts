import { AuditService, AuditWriter } from './audit.service';

function setup() {
  const tx = {
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
  };
  return { service: new AuditService(), tx, writer: tx as unknown as AuditWriter };
}

// What the service passed to the database.
const written = (create: jest.Mock) =>
  (create.mock.calls[0][0] as { data: Record<string, unknown> }).data;

describe('AuditService.record', () => {
  it('writes the entry with the client it is given, so it joins that transaction', async () => {
    const { service, tx, writer } = setup();

    await service.record(writer, {
      action: 'super_user.created',
      targetType: 'user',
      targetId: 'user-1',
      after: { email: 'super@example.com', role: 'SUPER_USER' },
    });

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        action: 'super_user.created',
        targetType: 'user',
        targetId: 'user-1',
        after: { email: 'super@example.com', role: 'SUPER_USER' },
      },
    });
  });

  it('replaces passwords, tokens and secrets at any depth, and keeps the rest', async () => {
    const { service, tx, writer } = setup();

    await service.record(writer, {
      action: 'test.redaction',
      after: {
        email: 'super@example.com',
        password: 'never-store-me',
        profile: { passwordHash: '$argon2id$abc', name: 'Super' },
        keys: [{ apiSecret: 's3cr3t-value', label: 'main' }],
        refreshToken: 'raw-token-value',
      },
    });

    const data = written(tx.auditLog.create);
    expect(data.after).toEqual({
      email: 'super@example.com',
      password: '[REDACTED]',
      profile: { passwordHash: '[REDACTED]', name: 'Super' },
      keys: [{ apiSecret: '[REDACTED]', label: 'main' }],
      refreshToken: '[REDACTED]',
    });
    expect(JSON.stringify(data)).not.toMatch(
      /never-store-me|argon2id|s3cr3t-value|raw-token-value/,
    );
  });

  it('stores dates as ISO strings', async () => {
    const { service, tx, writer } = setup();

    await service.record(writer, {
      action: 'test.dates',
      before: { emailVerifiedAt: new Date('2026-10-27T00:00:00Z') },
    });

    expect(written(tx.auditLog.create).before).toEqual({
      emailVerifiedAt: '2026-10-27T00:00:00.000Z',
    });
  });
});
