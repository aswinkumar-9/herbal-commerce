import { BadRequestException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { productSearchQuerySchema } from './product-search.schemas';
import type { ProductSearchService } from './product-search.service';
import { ProductsController } from './products.controller';
import type { ProductsService } from './products.service';

function setup() {
  const products = { findForShop: jest.fn() };
  const searching = { search: jest.fn() };
  const controller = new ProductsController(
    products as unknown as ProductsService,
    searching as unknown as ProductSearchService,
  );
  return { controller, products, searching };
}

describe('ProductsController', () => {
  it("shows a product's own page, by its slug", async () => {
    const { controller, products } = setup();
    const page = { name: 'Ashwagandha Capsules', slug: 'ashwagandha-capsules' };
    products.findForShop.mockResolvedValue(page);

    await expect(controller.detail('ashwagandha-capsules')).resolves.toEqual(
      page,
    );
    expect(products.findForShop).toHaveBeenCalledWith('ashwagandha-capsules');
  });

  it('searches the shop with the query as checked', async () => {
    const { controller, searching } = setup();
    const found = { products: [], total: 0, page: 1, nextPage: null };
    searching.search.mockResolvedValue(found);
    const query = productSearchQuerySchema.parse({ q: 'tulsi', page: '2' });

    await expect(controller.search(query)).resolves.toBe(found);
    expect(searching.search).toHaveBeenCalledWith({
      q: 'tulsi',
      page: 2,
      limit: 20,
      sort: 'relevance',
    });
  });

  it('checks the search query before the search sees it', () => {
    const args = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      ProductsController,
      'search',
    ) as Record<
      string,
      { pipes: { transform: (value: unknown) => unknown }[] }
    >;
    const [pipe] = Object.values(args)[0].pipes;

    expect(pipe.transform({ q: ' tulsi ' })).toEqual({
      q: 'tulsi',
      page: 1,
      limit: 20,
      sort: 'relevance',
    });
    expect(() => pipe.transform({ sort: 'relevance' })).toThrow(
      BadRequestException,
    );
  });
});
