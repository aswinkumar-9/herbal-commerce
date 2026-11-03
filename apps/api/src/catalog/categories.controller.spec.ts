import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';

describe('CategoriesController', () => {
  it('lists only the active categories', async () => {
    const shown = { name: 'Hair Care', slug: 'hair-care', description: null };
    const categories = {
      listActive: jest.fn().mockResolvedValue({ categories: [shown] }),
    };
    const controller = new CategoriesController(
      categories as unknown as CategoriesService,
    );

    await expect(controller.list()).resolves.toEqual({ categories: [shown] });
    expect(categories.listActive).toHaveBeenCalledWith();
  });
});
