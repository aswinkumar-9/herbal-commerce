import { Module } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { StaffCategoriesController } from './staff-categories.controller';

// The product catalog: categories for now (ADR 0020), then products.
@Module({
  controllers: [StaffCategoriesController],
  providers: [CategoriesService],
})
export class CatalogModule {}
