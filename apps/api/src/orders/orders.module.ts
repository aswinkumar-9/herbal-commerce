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
import { RazorpayWebhooksController } from './razorpay-webhooks.controller';
import { RazorpayWebhooksService } from './razorpay-webhooks.service';
import { StaffOrdersController } from './staff-orders.controller';
import { StaffOrdersService } from './staff-orders.service';

// Customers' orders (ADR 0026). An order asks the addresses for where it
// goes, the cart for what is in it, the catalog for the packs and their
// prices, the inventory for the stock, and the payments for their Razorpay
// order (ADR 0027). Razorpay's webhooks settle payments too. Unpaid orders
// expire every minute. Staff see every order (ADR 0028).
@Module({
  imports: [
    AddressesModule,
    CartModule,
    CatalogModule,
    InventoryModule,
    PaymentsModule,
  ],
  controllers: [
    OrdersController,
    RazorpayWebhooksController,
    StaffOrdersController,
  ],
  providers: [
    OrdersService,
    OrderPaymentsService,
    RazorpayWebhooksService,
    OrderExpiryScheduler,
    StaffOrdersService,
  ],
})
export class OrdersModule {}
