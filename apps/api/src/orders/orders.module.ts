import { Module } from '@nestjs/common';
import { AddressesModule } from '../addresses/addresses.module';
import { CartModule } from '../cart/cart.module';
import { CatalogModule } from '../catalog/catalog.module';
import { InventoryModule } from '../inventory/inventory.module';
import { OrderExpiryScheduler } from './order-expiry.scheduler';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

// Customers' orders (ADR 0026). An order asks the addresses for where it
// goes, the cart for what is in it, the catalog for the packs and their
// prices, and the inventory for the stock. Unpaid orders expire every
// minute.
@Module({
  imports: [AddressesModule, CartModule, CatalogModule, InventoryModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderExpiryScheduler],
})
export class OrdersModule {}
