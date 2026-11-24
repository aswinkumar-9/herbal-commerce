import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { lastValueFrom, of, throwError } from 'rxjs';
import { CatalogChanged } from './catalog-changed.interceptor';
import type { SearchCache } from './search-cache';
import { StaffBrandsController } from './staff-brands.controller';
import { StaffCategoriesController } from './staff-categories.controller';
import { StaffImagesController } from './staff-images.controller';
import { StaffProductsController } from './staff-products.controller';
import { StaffVariantsController } from './staff-variants.controller';

function setup() {
  const searches = { forget: jest.fn() };
  const interceptor = new CatalogChanged(searches as unknown as SearchCache);
  const run = (method: string, handler: CallHandler) =>
    lastValueFrom(
      interceptor.intercept(
        {
          switchToHttp: () => ({ getRequest: () => ({ method }) }),
        } as unknown as ExecutionContext,
        handler,
      ),
    );
  return { searches, run };
}

describe('CatalogChanged', () => {
  it('makes the search forget once a staff change is done', async () => {
    const { searches, run } = setup();
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      searches.forget.mockClear();
      await expect(run(method, { handle: () => of('saved') })).resolves.toBe(
        'saved',
      );
      expect(searches.forget).toHaveBeenCalledTimes(1);
    }
  });

  it('also after a change that failed, so nothing half done is kept', async () => {
    const { searches, run } = setup();
    await expect(
      run('PATCH', { handle: () => throwError(() => new Error('refused')) }),
    ).rejects.toThrow('refused');
    expect(searches.forget).toHaveBeenCalledTimes(1);
  });

  it('leaves the search as it is for a read', async () => {
    const { searches, run } = setup();
    await run('GET', { handle: () => of([]) });
    await run('HEAD', { handle: () => of(null) });
    expect(searches.forget).not.toHaveBeenCalled();
  });

  it('is on every route staff change the catalog by', () => {
    for (const controller of [
      StaffCategoriesController,
      StaffBrandsController,
      StaffProductsController,
      StaffVariantsController,
      StaffImagesController,
    ]) {
      expect(
        Reflect.getMetadata(INTERCEPTORS_METADATA, controller) as unknown[],
      ).toContain(CatalogChanged);
    }
  });
});
