import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { PrismaService } from '../prisma/prisma.service';
import { SuperUserService } from './super-user.service';

type CreateUserArgs = {
  data: {
    email: string;
    role: string;
    passwordHash: string;
    emailVerifiedAt: Date;
  };
};

const input = {
  email: 'super@example.com',
  fullName: 'Dev Super',
  password: 'a-long-staff-password-1',
};

function setup() {
  const tx = {
    user: {
      create: jest.fn().mockResolvedValue({
        id: 'user-1',
        email: input.email,
        fullName: input.fullName,
        role: 'SUPER_USER',
      }),
    },
  };
  const prisma = {
    user: {
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  };
  const passwords = { hash: jest.fn().mockResolvedValue('$argon2id$staff-hash') };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new SuperUserService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordService,
    audit as unknown as AuditService,
  );
  return { service, prisma, tx, passwords, audit };
}

describe('SuperUserService.create', () => {
  it('creates a verified Super User with a hashed password, audited in the same transaction', async () => {
    const { service, tx, passwords, audit } = setup();

    await expect(service.create(input)).resolves.toEqual({ id: 'user-1' });

    expect(passwords.hash).toHaveBeenCalledWith(input.password);
    const { data } = tx.user.create.mock.calls[0][0] as CreateUserArgs;
    expect(data).toMatchObject({
      email: input.email,
      role: 'SUPER_USER',
      passwordHash: '$argon2id$staff-hash',
    });
    expect(data.emailVerifiedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(data)).not.toContain(input.password);

    // The same transaction client, so user and entry are saved together.
    expect(audit.record).toHaveBeenCalledWith(tx, {
      action: 'super_user.created',
      targetType: 'user',
      targetId: 'user-1',
      after: { email: input.email, fullName: input.fullName, role: 'SUPER_USER' },
    });
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(input.password);
  });

  it('refuses a fourth Super User before doing any work', async () => {
    const { service, prisma, passwords } = setup();
    prisma.user.count.mockResolvedValue(3);

    await expect(service.create(input)).rejects.toThrow(
      'There are already 3 Super Users',
    );
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { role: 'SUPER_USER' },
    });
    expect(passwords.hash).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses an email that already has an account, so a customer never becomes staff', async () => {
    const { service, prisma, passwords } = setup();
    prisma.user.findUnique.mockResolvedValue({ id: 'customer-1' });

    await expect(service.create(input)).rejects.toThrow('already exists');
    expect(passwords.hash).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('treats the same email created at the same moment as already existing', async () => {
    const { service, tx, audit } = setup();
    tx.user.create.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );

    await expect(service.create(input)).rejects.toThrow('already exists');
    expect(audit.record).not.toHaveBeenCalled();
  });
});
