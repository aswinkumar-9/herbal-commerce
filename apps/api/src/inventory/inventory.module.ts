import { Module } from '@nestjs/common';
import { StaffStockController } from './staff-stock.controller';
import { StockService } from './stock.service';

// Stock of the pack sizes, batch by batch, with every change recorded
// (ADR 0024).
@Module({
  controllers: [StaffStockController],
  providers: [StockService],
  exports: [StockService],
})
export class InventoryModule {}
