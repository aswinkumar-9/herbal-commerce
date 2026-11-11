import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { productSearchQuerySchema } from './product-search.schemas';
import type { ProductSearchQuery } from './product-search.schemas';
import { ProductSearchService } from './product-search.service';
import { ProductsService } from './products.service';

// The products customers see (ADR 0021), and the shop's search (ADR 0030).
@Controller('products')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly searching: ProductSearchService,
  ) {}

  // Searches the shop by words, partial or misspelt, and by category, type
  // and price, one page at a time. Anyone may search. Products in stock
  // come first.
  @Public()
  @RateLimit('search')
  @Get()
  search(
    @Query(new ZodValidationPipe(productSearchQuerySchema))
    query: ProductSearchQuery,
  ) {
    return this.searching.search(query);
  }

  // A product's own page, with its licence and maker details. Anyone may
  // read it. A hidden or unknown product answers 404.
  @Public()
  @Get(':slug')
  detail(@Param('slug') slug: string) {
    return this.products.findForShop(slug);
  }
}
