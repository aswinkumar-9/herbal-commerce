import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { BrandsService } from './brands.service';

// The brands customers can shop by (part 15B), for the shop's brand filter.
@Controller('brands')
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  // Anyone may read them, signed in or not. Only the brands with a live
  // product, by name.
  @Public()
  @Get()
  list() {
    return this.brands.listShown();
  }
}
