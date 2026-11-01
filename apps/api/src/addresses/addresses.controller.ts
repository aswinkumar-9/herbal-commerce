import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { addressSchema } from './addresses.schemas';
import type { AddressInput } from './addresses.schemas';
import { AddressesService } from './addresses.service';

// The signed-in customer's delivery addresses. The customer always comes
// from the access token, never from the URL or the body.
@Controller('me/addresses')
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.addresses.list(user.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  add(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(addressSchema)) body: AddressInput,
  ) {
    return this.addresses.add(user.id, body);
  }
}
