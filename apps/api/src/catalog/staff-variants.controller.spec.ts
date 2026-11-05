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
  mrpPaise: 50000,
  pricePaise: 45000,
};

function setup() {
  const variants = {
    listForProduct: jest.fn().mockResolvedValue({ variants: [] }),
    create: jest.fn().mockResolvedValue({ id: ID }),
    update: jest.fn().mockResolvedValue({ id: ID }),
    remove: jest.fn().mockResolvedValue(undefined),
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
      controller.update(ID, { pricePaise: 40000 }, context),
    ).resolves.toEqual({ id: ID });
    expect(variants.update).toHaveBeenCalledWith(
      ID,
      { pricePaise: 40000 },
      context,
    );
  });

  it('deletes a pack size by its ID, recording who did it', async () => {
    const { controller, variants } = setup();

    await expect(controller.remove(ID, context)).resolves.toBeUndefined();
    expect(variants.remove).toHaveBeenCalledWith(ID, context);
  });
});
