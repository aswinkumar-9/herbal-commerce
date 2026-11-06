import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { cartItemSchema } from './cart.schemas';
import type { CartItemInput } from './cart.schemas';
import { CartService } from './cart.service';

// The signed-in customer's cart (ADR 0025). The customer always comes from
// the access token, never from the URL or the body. A pack size is named by
// its SKU, as the shop shows it.
@Controller('me/cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  view(@CurrentUser() user: AuthUser) {
    return this.cart.view(user.id);
  }

  // Sets how many packs of the pack size the cart holds: adds it, or
  // changes its packs. Sending the same again changes nothing.
  @Put('items/:sku')
  setPacks(
    @CurrentUser() user: AuthUser,
    @Param('sku') sku: string,
    @Body(new ZodValidationPipe(cartItemSchema)) body: CartItemInput,
  ) {
    return this.cart.setPacks(user.id, sku, body.packs);
  }

  @Delete('items/:sku')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('sku') sku: string) {
    return this.cart.remove(user.id, sku);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  empty(@CurrentUser() user: AuthUser) {
    return this.cart.empty(user.id);
  }
}
