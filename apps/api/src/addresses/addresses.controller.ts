import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { addressSchema, addressUpdateSchema } from './addresses.schemas';
import type { AddressInput, AddressUpdateInput } from './addresses.schemas';
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

  // The ID only picks one of the caller's own addresses: anyone else's
  // gets 404.
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(addressUpdateSchema)) body: AddressUpdateInput,
  ) {
    return this.addresses.update(user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.addresses.remove(user.id, id);
  }
}
