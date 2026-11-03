import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { StaffCategoriesController } from './staff-categories.controller';

// The product catalog: categories for now (ADR 0020), then products.
@Module({
  controllers: [CategoriesController, StaffCategoriesController],
  providers: [CategoriesService],
})
export class CatalogModule {}
