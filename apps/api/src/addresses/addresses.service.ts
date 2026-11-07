import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AddressInput, AddressUpdateInput } from './addresses.schemas';

export const MAX_ADDRESSES = 10;
const TOO_MANY =
  `You can save at most ${MAX_ADDRESSES} addresses. Remove one first.`;
// Also for an address of another customer: it is not theirs to know about.
const NOT_FOUND = 'Address not found';

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

// What an order copies of an address (ADR 0026).
const DELIVERY_FIELDS = {
  fullName: true,
  phone: true,
  line1: true,
  line2: true,
  city: true,
  state: true,
  pincode: true,
} satisfies Prisma.AddressSelect;

export type DeliveryAddress = Prisma.AddressGetPayload<{
  select: typeof DELIVERY_FIELDS;
}>;

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

  // Changes only the fields given. Making it the default takes the default
  // from the old one first.
  async update(userId: string, id: string, input: AddressUpdateInput) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockAddressesOf(tx, userId);
      const address = await this.findOwn(tx, userId, id);
      if (input.isDefault && !address.isDefault) {
        await tx.address.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.address.update({
        where: { id, userId },
        data: input,
        select: ADDRESS_FIELDS,
      });
    });
  }

  // Removing the default makes the newest remaining address the default,
  // so a customer with addresses always has one.
  async remove(userId: string, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockAddressesOf(tx, userId);
      const address = await this.findOwn(tx, userId, id);
      await tx.address.delete({ where: { id, userId } });
      if (!address.isDefault) {
        return;
      }
      const newest = await tx.address.findFirst({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
      if (newest) {
        await tx.address.update({
          where: { id: newest.id },
          data: { isDefault: true },
        });
      }
    });
  }

  // The customer's own address, for an order to copy (ADR 0026), or 404,
  // like someone else's.
  async deliveryAddress(userId: string, id: string): Promise<DeliveryAddress> {
    const address = await this.prisma.address.findFirst({
      where: { id, userId },
      select: DELIVERY_FIELDS,
    });
    if (!address) {
      throw new NotFoundException(NOT_FOUND);
    }
    return address;
  }

  // The customer's own address, or 404. Someone else's address gets the
  // same answer as one that does not exist.
  private async findOwn(
    tx: Prisma.TransactionClient,
    userId: string,
    id: string,
  ): Promise<{ isDefault: boolean }> {
    const address = await tx.address.findFirst({
      where: { id, userId },
      select: { isDefault: true },
    });
    if (!address) {
      throw new NotFoundException(NOT_FOUND);
    }
    return address;
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
