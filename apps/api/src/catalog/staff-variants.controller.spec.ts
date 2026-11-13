import { BadRequestException, RequestMethod } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import {
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { StaffVariantsController } from './staff-variants.controller';
import { VariantsService } from './variants.service';

const ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PRODUCT = '3f2b8c1d-5e6a-4b7c-8d9e-0f1a2b3c4d5e';
const context = {
  actorId: '5d1e8c2a-7b3f-4e9a-a1c6-2f8d0b4e7a93',
  ip: '203.0.113.7',
  requestId: 'request-1',
};
const input = {
  sku: 'ASH-CAP-60',
  quantity: 60,
  unit: 'CAPSULES' as const,
  mrpRupees: 500,
  priceRupees: 450,
};

function setup() {
  const variants = {
    listForProduct: jest.fn().mockResolvedValue({ variants: [] }),
    create: jest.fn().mockResolvedValue({ id: ID }),
    update: jest.fn().mockResolvedValue({ id: ID }),
    remove: jest.fn().mockResolvedValue(undefined),
    reorder: jest.fn().mockResolvedValue({ variants: [] }),
  };
  const controller = new StaffVariantsController(
    variants as unknown as VariantsService,
  );
  return { controller, variants };
}

describe('StaffVariantsController', () => {
  it("lists a product's pack sizes, by the product's ID", async () => {
    const { controller, variants } = setup();

    await expect(controller.list(PRODUCT)).resolves.toEqual({ variants: [] });
    expect(variants.listForProduct).toHaveBeenCalledWith(PRODUCT);
  });

  it('adds a pack size to the product, recording who did it', async () => {
    const { controller, variants } = setup();

    await expect(controller.create(PRODUCT, input, context)).resolves.toEqual({
      id: ID,
    });
    expect(variants.create).toHaveBeenCalledWith(PRODUCT, input, context);
  });

  it('changes a pack size by its ID, recording who did it', async () => {
    const { controller, variants } = setup();

    await expect(
      controller.update(ID, { priceRupees: 400 }, context),
    ).resolves.toEqual({ id: ID });
    expect(variants.update).toHaveBeenCalledWith(
      ID,
      { priceRupees: 400 },
      context,
    );
  });

  it("puts a product's pack sizes in a new order, recording who did it", async () => {
    const { controller, variants } = setup();
    const order = { ids: [ID] };

    await expect(controller.reorder(PRODUCT, order, context)).resolves.toEqual({
      variants: [],
    });
    expect(variants.reorder).toHaveBeenCalledWith(PRODUCT, order, context);
  });

  it('checks the product ID and the order before the service sees them', async () => {
    const args = Object.values(
      Reflect.getMetadata(ROUTE_ARGS_METADATA, StaffVariantsController, 'reorder') as Record<
        string,
        { index: number; pipes: PipeTransform[] }
      >,
    );
    const pipe = (index: number) =>
      args.find((arg) => arg.index === index)?.pipes[0] as PipeTransform;
    const param = { type: 'param', data: 'productId' } as const;

    await expect(pipe(0).transform(PRODUCT, param)).resolves.toBe(PRODUCT);
    await expect(pipe(0).transform('../x', param)).rejects.toThrow(
      BadRequestException,
    );
    expect(pipe(1).transform({ ids: [ID], position: 1 }, { type: 'body' })).toEqual({
      ids: [ID],
    });
    expect(() => pipe(1).transform({ ids: [ID, ID] }, { type: 'body' })).toThrow(
      BadRequestException,
    );
  });

  it('deletes a pack size by its ID, recording who did it', async () => {
    const { controller, variants } = setup();

    await expect(controller.remove(ID, context)).resolves.toBeUndefined();
    expect(variants.remove).toHaveBeenCalledWith(ID, context);
  });
});

describe('StaffVariantsController routes', () => {
  it('serves the new order at PUT /v1/staff/products/:productId/variants/order', () => {
    const handler = (
      StaffVariantsController.prototype as unknown as Record<string, object>
    ).reorder;
    expect([
      Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod,
      Reflect.getMetadata(PATH_METADATA, handler) as string,
    ]).toEqual([RequestMethod.PUT, 'products/:productId/variants/order']);
  });
});
