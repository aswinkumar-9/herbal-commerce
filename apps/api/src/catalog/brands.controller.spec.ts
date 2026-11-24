import { BrandsController } from './brands.controller';
import { BrandsService } from './brands.service';

describe('BrandsController', () => {
  it('lists the brands customers can shop by', async () => {
    const shown = { brands: [{ name: 'Himalaya', slug: 'himalaya' }] };
    const brands = { listShown: jest.fn().mockResolvedValue(shown) };
    const controller = new BrandsController(brands as unknown as BrandsService);

    await expect(controller.list()).resolves.toEqual(shown);
    expect(brands.listShown).toHaveBeenCalledWith();
  });
});
