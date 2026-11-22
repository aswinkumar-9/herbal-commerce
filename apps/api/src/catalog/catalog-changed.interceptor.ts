import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, finalize } from 'rxjs';
import { SearchCache } from './search-cache';

// On the staff's catalog routes: after anything but a read, the shop's
// search forgets what it kept (SearchCache), so a new product, price, photo
// or category shows in the search at once. Also after a change that
// failed: forgetting costs one fresh read, and nothing half done is kept.
@Injectable()
export class CatalogChanged implements NestInterceptor {
  constructor(private readonly searches: SearchCache) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const { method } = context.switchToHttp().getRequest<Request>();
    if (method === 'GET' || method === 'HEAD') {
      return next.handle();
    }
    return next.handle().pipe(finalize(() => this.searches.forget()));
  }
}
