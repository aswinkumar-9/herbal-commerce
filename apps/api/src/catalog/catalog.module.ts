import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { StaffCategoriesController } from './staff-categories.controller';
import { StaffProductsController } from './staff-products.controller';
import { StaffVariantsController } from './staff-variants.controller';
import { VariantsService } from './variants.service';

// The product catalog: categories (ADR 0020), products (ADR 0021), and
// their pack sizes with prices (ADR 0022).
@Module({
  controllers: [
    CategoriesController,
    ProductsController,
    StaffCategoriesController,
    StaffProductsController,
    StaffVariantsController,
  ],
  providers: [CategoriesService, ProductsService, VariantsService],
})
export class CatalogModule {}
