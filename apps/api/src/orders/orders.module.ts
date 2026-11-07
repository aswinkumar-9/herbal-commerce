import { Module } from '@nestjs/common';
import { AddressesModule } from '../addresses/addresses.module';
import { CartModule } from '../cart/cart.module';
import { CatalogModule } from '../catalog/catalog.module';
import { InventoryModule } from '../inventory/inventory.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

// Customers' orders (ADR 0026). An order asks the addresses for where it
// goes, the cart for what is in it, the catalog for the packs and their
// prices, and the inventory for the stock.
@Module({
  imports: [AddressesModule, CartModule, CatalogModule, InventoryModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
