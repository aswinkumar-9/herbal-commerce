import { Module } from '@nestjs/common';
import { AddressesController } from './addresses.controller';
import { AddressesService } from './addresses.service';

// Customers' delivery addresses (ADR 0019).
@Module({
  controllers: [AddressesController],
  providers: [AddressesService],
})
export class AddressesModule {}
