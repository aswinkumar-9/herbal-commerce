import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { InventoryModule } from '../inventory/inventory.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';

// Signed-in customers' carts (ADR 0025). The cart asks the catalog about
// pack sizes and the inventory about stock.
@Module({
  imports: [CatalogModule, InventoryModule],
  controllers: [CartController],
  providers: [CartService],
})
export class CartModule {}
