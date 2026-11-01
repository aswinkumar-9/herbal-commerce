import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AddressInput } from './addresses.schemas';

export const MAX_ADDRESSES = 10;
const TOO_MANY =
  `You can save at most ${MAX_ADDRESSES} addresses. Remove one first.`;

// What the customer sees of an address. The userId stays out: it is always
// the customer's own.
const ADDRESS_FIELDS = {
  id: true,
  fullName: true,
  phone: true,
  line1: true,
  line2: true,
  city: true,
  state: true,
  pincode: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AddressSelect;

// A customer's delivery addresses (ADR 0019). Every query names the
// customer, so nobody can reach someone else's address (BOLA).
@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  // The default address first, then the newest.
  async list(userId: string) {
    const addresses = await this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      select: ADDRESS_FIELDS,
    });
    return { addresses };
  }

  // The first address becomes the default, whatever was asked. A later one
  // only when asked, and then the old default stops being it.
  async add(userId: string, input: AddressInput) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockAddressesOf(tx, userId);
      const count = await tx.address.count({ where: { userId } });
      if (count >= MAX_ADDRESSES) {
        throw new ConflictException(TOO_MANY);
      }
      const isDefault = count === 0 || input.isDefault === true;
      if (isDefault) {
        await tx.address.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.address.create({
        data: { ...input, userId, isDefault },
        select: ADDRESS_FIELDS,
      });
    });
  }

  // One change at a time for each customer: this locks their account row
  // until the transaction ends. Two requests at once (a double tap) then
  // cannot both pass the limit, or both become the default. The ID is sent
  // as a parameter, never pasted into the SQL.
  private async lockAddressesOf(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    await tx.$queryRaw`
      SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
  }
}
