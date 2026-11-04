import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

describe('ProductsController', () => {
  it("shows a product's own page, by its slug", async () => {
    const page = { name: 'Ashwagandha Capsules', slug: 'ashwagandha-capsules' };
    const products = { findForShop: jest.fn().mockResolvedValue(page) };
    const controller = new ProductsController(
      products as unknown as ProductsService,
    );

    await expect(controller.detail('ashwagandha-capsules')).resolves.toEqual(
      page,
    );
    expect(products.findForShop).toHaveBeenCalledWith('ashwagandha-capsules');
  });
});
