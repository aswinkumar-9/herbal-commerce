import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { ProductsService } from './products.service';

// The products customers see (ADR 0021).
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  // A product's own page, with its licence and maker details. Anyone may
  // read it. A hidden or unknown product answers 404.
  @Public()
  @Get(':slug')
  detail(@Param('slug') slug: string) {
    return this.products.findForShop(slug);
  }
}
