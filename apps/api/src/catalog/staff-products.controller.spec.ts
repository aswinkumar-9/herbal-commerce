import { ProductsService } from './products.service';
import { StaffProductsController } from './staff-products.controller';

const ID = '3f2b8c1d-5e6a-4b7c-8d9e-0f1a2b3c4d5e';
const CATEGORY = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const context = {
  actorId: '5d1e8c2a-7b3f-4e9a-a1c6-2f8d0b4e7a93',
  ip: '203.0.113.7',
  requestId: 'request-1',
};

function setup() {
  const products = {
    list: jest.fn().mockResolvedValue({ products: [], nextAfter: null }),
    create: jest.fn().mockResolvedValue({ id: ID }),
    update: jest.fn().mockResolvedValue({ id: ID }),
  };
  const controller = new StaffProductsController(
    products as unknown as ProductsService,
  );
  return { controller, products };
}

describe('StaffProductsController', () => {
  it('lists one page of products, with the filters asked for', async () => {
    const { controller, products } = setup();
    const query = { limit: 20, categoryId: CATEGORY };

    await expect(controller.list(query)).resolves.toEqual({
      products: [],
      nextAfter: null,
    });
    expect(products.list).toHaveBeenCalledWith(query);
  });

  it('creates a product, recording who did it', async () => {
    const { controller, products } = setup();
    const input = { categoryId: CATEGORY, name: 'Tulsi Tea', slug: 'tulsi-tea' };

    await expect(controller.create(input, context)).resolves.toEqual({ id: ID });
    expect(products.create).toHaveBeenCalledWith(input, context);
  });

  it('changes a product by its ID, recording who did it', async () => {
    const { controller, products } = setup();

    await expect(
      controller.update(ID, { isActive: true }, context),
    ).resolves.toEqual({ id: ID });
    expect(products.update).toHaveBeenCalledWith(ID, { isActive: true }, context);
  });
});
