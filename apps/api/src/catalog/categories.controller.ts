import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CategoriesService } from './categories.service';
import { shopProductListQuerySchema } from './products.schemas';
import type { ShopProductListQuery } from './products.schemas';
import { ProductsService } from './products.service';

// The categories customers see (ADR 0020), and the products in each
// (ADR 0021).
@Controller('categories')
export class CategoriesController {
  constructor(
    private readonly categories: CategoriesService,
    private readonly products: ProductsService,
  ) {}

  // Anyone may read them, signed in or not. Active categories only, in the
  // order staff chose.
  @Public()
  @Get()
  list() {
    return this.categories.listActive();
  }

  // A category's page: the category and its active products, one page at a
  // time. Anyone may read it. A hidden or unknown category answers 404.
  @Public()
  @Get(':slug/products')
  listProducts(
    @Param('slug') slug: string,
    @Query(new ZodValidationPipe(shopProductListQuerySchema))
    query: ShopProductListQuery,
  ) {
    return this.products.listForShop(slug, query);
  }
}
