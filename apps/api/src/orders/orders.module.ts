import { Module } from '@nestjs/common';
import { AddressesModule } from '../addresses/addresses.module';
import { CartModule } from '../cart/cart.module';
import { CatalogModule } from '../catalog/catalog.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PaymentsModule } from '../payments/payments.module';
import { OrderExpiryScheduler } from './order-expiry.scheduler';
import { OrderPaymentsService } from './order-payments.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

// Customers' orders (ADR 0026). An order asks the addresses for where it
// goes, the cart for what is in it, the catalog for the packs and their
// prices, the inventory for the stock, and the payments for their Razorpay
// order (ADR 0027). Unpaid orders expire every minute.
@Module({
  imports: [
    AddressesModule,
    CartModule,
    CatalogModule,
    InventoryModule,
    PaymentsModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService, OrderPaymentsService, OrderExpiryScheduler],
})
export class OrdersModule {}
