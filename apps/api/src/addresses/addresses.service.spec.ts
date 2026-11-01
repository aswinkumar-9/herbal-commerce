import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AddressesService, MAX_ADDRESSES } from './addresses.service';

const input = {
  fullName: 'Asha K',
  phone: '9845012345',
  line1: '12, 3rd Cross, Indiranagar',
  city: 'Bengaluru',
  state: 'Karnataka' as const,
  pincode: '560038',
};

function setup(existing = 0) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'user-1' }]),
    address: {
      count: jest.fn().mockResolvedValue(existing),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({ id: 'address-1' }),
    },
  };
  const prisma = {
    address: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  };
  const service = new AddressesService(prisma as unknown as PrismaService);
  return { service, prisma, tx };
}

// The data the address was created with.
function created(tx: ReturnType<typeof setup>['tx']) {
  const [args] = tx.address.create.mock.calls[0] as [
    { data: Record<string, unknown>; select: Record<string, boolean> },
  ];
  return args;
}

describe('AddressesService.list', () => {
  it("lists only this customer's addresses, the default first, then the newest", async () => {
    const { service, prisma } = setup();

    await expect(service.list('user-1')).resolves.toEqual({ addresses: [] });

    const [query] = prisma.address.findMany.mock.calls[0] as [
      { where: object; orderBy: object; select: Record<string, boolean> },
    ];
    expect(query.where).toEqual({ userId: 'user-1' });
    expect(query.orderBy).toEqual([
      { isDefault: 'desc' },
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
    // The answer never says whose address it is: always the caller's.
    expect(query.select).not.toHaveProperty('userId');
  });
});

describe('AddressesService.add', () => {
  it('saves the address for the customer in the token', async () => {
    const { service, tx } = setup();

    await expect(service.add('user-1', input)).resolves.toEqual({
      id: 'address-1',
    });

    expect(created(tx).data).toMatchObject({ ...input, userId: 'user-1' });
    expect(created(tx).select).not.toHaveProperty('userId');
  });

  it('makes the first address the default, even when not asked', async () => {
    const { service, tx } = setup(0);

    await service.add('user-1', { ...input, isDefault: false });

    expect(created(tx).data.isDefault).toBe(true);
  });

  it('keeps the default where it is for a later address, unless asked', async () => {
    const { service, tx } = setup(3);

    await service.add('user-1', input);

    expect(created(tx).data.isDefault).toBe(false);
    expect(tx.address.updateMany).not.toHaveBeenCalled();
  });

  it('moves the default to a later address when asked, taking it from the old one first', async () => {
    const { service, tx } = setup(3);

    await service.add('user-1', { ...input, isDefault: true });

    expect(tx.address.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', isDefault: true },
      data: { isDefault: false },
    });
    expect(created(tx).data.isDefault).toBe(true);
    // Never two defaults at once, which the database would refuse anyway.
    const [unset] = tx.address.updateMany.mock.invocationCallOrder;
    const [added] = tx.address.create.mock.invocationCallOrder;
    expect(unset).toBeLessThan(added);
  });

  it(`refuses an address beyond ${MAX_ADDRESSES} with 409, and saves nothing`, async () => {
    const { service, tx } = setup(MAX_ADDRESSES);

    await expect(service.add('user-1', input)).rejects.toThrow(
      new ConflictException(
        'You can save at most 10 addresses. Remove one first.',
      ),
    );
    expect(tx.address.create).not.toHaveBeenCalled();
  });

  it("locks the customer's row first, so two requests at once take turns", async () => {
    const { service, prisma, tx } = setup(9);

    await service.add('user-1', input);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // A tagged template: the SQL text, and the ID as a separate parameter.
    const [sql, ...values] = tx.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    expect(sql.join('?')).toContain('FOR UPDATE');
    expect(values).toEqual(['user-1']);
    const [locked] = tx.$queryRaw.mock.invocationCallOrder;
    const [counted] = tx.address.count.mock.invocationCallOrder;
    expect(locked).toBeLessThan(counted);
  });
});
