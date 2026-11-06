import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InventoryModule } from '../inventory/inventory.module';
import { MediaModule } from '../media/media.module';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { ImageUploadParser } from './image-upload';
import { ImagesService } from './images.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { StaffCategoriesController } from './staff-categories.controller';
import { StaffImagesController } from './staff-images.controller';
import { StaffProductsController } from './staff-products.controller';
import { StaffVariantsController } from './staff-variants.controller';
import { VariantsService } from './variants.service';

// The product catalog: categories (ADR 0020), products (ADR 0021), their
// pack sizes with prices (ADR 0022), and their images (ADR 0023). The shop
// asks the inventory which packs are in stock (ADR 0024).
@Module({
  imports: [AuthModule, MediaModule, InventoryModule],
  controllers: [
    CategoriesController,
    ProductsController,
    StaffCategoriesController,
    StaffProductsController,
    StaffVariantsController,
    StaffImagesController,
  ],
  providers: [
    CategoriesService,
    ProductsService,
    VariantsService,
    ImagesService,
    ImageUploadParser,
  ],
})
export class CatalogModule implements NestModule {
  // Only the image upload route reads an image body (ADR 0023).
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ImageUploadParser).forRoutes({
      path: 'staff/products/:productId/images',
      method: RequestMethod.POST,
    });
  }
}
