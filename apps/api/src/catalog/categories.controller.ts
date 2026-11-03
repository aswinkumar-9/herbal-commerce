import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { CategoriesService } from './categories.service';

// The categories customers see (ADR 0020).
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  // Anyone may read them, signed in or not. Active categories only, in the
  // order staff chose.
  @Public()
  @Get()
  list() {
    return this.categories.listActive();
  }
}
