import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { BrandsService } from './brands.service';
import { StaffBrandsController } from './staff-brands.controller';

const ID = '3f6c1a2e-9b4d-4c7e-8a15-6d2f0e9b7c41';
const context = {
  actorId: '5d1e8c2a-7b3f-4e9a-a1c6-2f8d0b4e7a93',
  ip: '203.0.113.7',
  requestId: 'request-1',
};

function setup() {
  const brands = {
    list: jest.fn().mockResolvedValue({ brands: [] }),
    create: jest.fn().mockResolvedValue({ id: ID }),
    update: jest.fn().mockResolvedValue({ id: ID }),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new StaffBrandsController(
    brands as unknown as BrandsService,
  );
  return { controller, brands };
}

describe('StaffBrandsController', () => {
  it('lists every brand', async () => {
    const { controller, brands } = setup();

    await expect(controller.list()).resolves.toEqual({ brands: [] });
    expect(brands.list).toHaveBeenCalledWith();
  });

  it('creates a brand, recording who did it', async () => {
    const { controller, brands } = setup();
    const input = { name: 'Himalaya', slug: 'himalaya' };

    await expect(controller.create(input, context)).resolves.toEqual({
      id: ID,
    });
    expect(brands.create).toHaveBeenCalledWith(input, context);
  });

  it('changes a brand by its ID, recording who did it', async () => {
    const { controller, brands } = setup();

    await expect(
      controller.update(ID, { name: 'Himalaya Herbals' }, context),
    ).resolves.toEqual({ id: ID });
    expect(brands.update).toHaveBeenCalledWith(
      ID,
      { name: 'Himalaya Herbals' },
      context,
    );
  });

  it('deletes a brand by its ID, recording who did it', async () => {
    const { controller, brands } = setup();

    await expect(controller.remove(ID, context)).resolves.toBeUndefined();
    expect(brands.remove).toHaveBeenCalledWith(ID, context);
  });
});

// The HTTP method and path a handler is served at, by its name.
function route(name: string) {
  const handler = (
    StaffBrandsController.prototype as unknown as Record<string, object>
  )[name];
  return [
    Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod,
    Reflect.getMetadata(PATH_METADATA, handler) as string,
  ];
}

describe('StaffBrandsController routes', () => {
  it('serves /v1/staff/brands, and each brand by its ID', () => {
    expect(Reflect.getMetadata(PATH_METADATA, StaffBrandsController)).toBe(
      'staff/brands',
    );
    expect(route('list')).toEqual([RequestMethod.GET, '/']);
    expect(route('create')).toEqual([RequestMethod.POST, '/']);
    expect(route('update')).toEqual([RequestMethod.PATCH, ':id']);
    expect(route('remove')).toEqual([RequestMethod.DELETE, ':id']);
  });
});
