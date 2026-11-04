import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { StaffCategoriesController } from './staff-categories.controller';
import { StaffProductsController } from './staff-products.controller';

// The product catalog: categories (ADR 0020) and products (ADR 0021).
@Module({
  controllers: [
    CategoriesController,
    ProductsController,
    StaffCategoriesController,
    StaffProductsController,
  ],
  providers: [CategoriesService, ProductsService],
})
export class CatalogModule {}
