import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { validationFailed } from '../catalog/validation-failed';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { idempotencyKeySchema, placeOrderSchema } from './orders.schemas';
import type { PlaceOrderInput } from './orders.schemas';
import { OrdersService } from './orders.service';

// The signed-in customer's checkout and orders (ADR 0026). The customer
// always comes from the access token, never from the URL or the body.
@Controller('me')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  // What the cart would cost as an order now.
  @Get('checkout')
  quote(@CurrentUser() user: AuthUser) {
    return this.orders.quote(user.id);
  }

  // Places an order from the cart. The Idempotency-Key header, a new UUID
  // for each order, makes a retried request answer the same order.
  @Post('orders')
  @HttpCode(HttpStatus.CREATED)
  @RateLimit('placeOrder')
  place(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(placeOrderSchema)) body: PlaceOrderInput,
  ) {
    const key = idempotencyKeySchema.safeParse(idempotencyKey);
    if (!key.success) {
      throw validationFailed([
        { field: 'Idempotency-Key', message: key.error.issues[0].message },
      ]);
    }
    return this.orders.place(user.id, key.data, body);
  }
}
