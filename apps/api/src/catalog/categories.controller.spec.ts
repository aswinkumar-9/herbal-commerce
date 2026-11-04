import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { ProductsService } from './products.service';

function setup() {
  const shown = { name: 'Hair Care', slug: 'hair-care', description: null };
  const categories = {
    listActive: jest.fn().mockResolvedValue({ categories: [shown] }),
  };
  const page = { category: shown, products: [], nextAfter: null };
  const products = { listForShop: jest.fn().mockResolvedValue(page) };
  const controller = new CategoriesController(
    categories as unknown as CategoriesService,
    products as unknown as ProductsService,
  );
  return { controller, categories, products, shown, page };
}

describe('CategoriesController', () => {
  it('lists only the active categories', async () => {
    const { controller, categories, shown } = setup();

    await expect(controller.list()).resolves.toEqual({ categories: [shown] });
    expect(categories.listActive).toHaveBeenCalledWith();
  });

  it("shows one page of a category's products, by the category's slug", async () => {
    const { controller, products, page } = setup();
    const query = { limit: 5, after: 'tulsi-tea' };

    await expect(controller.listProducts('hair-care', query)).resolves.toEqual(
      page,
    );
    expect(products.listForShop).toHaveBeenCalledWith('hair-care', query);
  });
});
