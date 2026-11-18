import {
  BadRequestException,
  RequestMethod,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import {
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { ImagesService } from './images.service';
import { StaffImagesController } from './staff-images.controller';

const ID = '6c5b4a39-2817-4f06-b5e4-d3c2b1a09f8e';
const PRODUCT = '3f2b8c1d-5e6a-4b7c-8d9e-0f1a2b3c4d5e';
const context = {
  actorId: '5d1e8c2a-7b3f-4e9a-a1c6-2f8d0b4e7a93',
  ip: '203.0.113.7',
  requestId: 'request-1',
};

function setup() {
  const images = {
    listForProduct: jest.fn().mockResolvedValue({ images: [] }),
    create: jest.fn().mockResolvedValue({ id: ID }),
    update: jest.fn().mockResolvedValue({ id: ID }),
    remove: jest.fn().mockResolvedValue(undefined),
    reorder: jest.fn().mockResolvedValue({ images: [] }),
  };
  const controller = new StaffImagesController(
    images as unknown as ImagesService,
  );
  return { controller, images };
}

describe('StaffImagesController', () => {
  it("lists a product's images, by the product's ID", async () => {
    const { controller, images } = setup();

    await expect(controller.list(PRODUCT)).resolves.toEqual({ images: [] });
    expect(images.listForProduct).toHaveBeenCalledWith(PRODUCT);
  });

  it('adds the uploaded image to the product, with its type, recording who did it', async () => {
    const { controller, images } = setup();
    const file = Buffer.from('image bytes');

    await expect(
      controller.create(PRODUCT, file, 'image/png', context),
    ).resolves.toEqual({ id: ID });
    expect(images.create).toHaveBeenCalledWith(
      PRODUCT,
      file,
      'image/png',
      context,
    );
  });

  it('answers 415 for a body that is not an image, before any work', () => {
    const { controller, images } = setup();

    expect(() =>
      controller.create(PRODUCT, { photo: 'x' }, 'application/json', context),
    ).toThrow(UnsupportedMediaTypeException);
    expect(images.create).not.toHaveBeenCalled();
  });

  it('changes an image by its ID, recording who did it', async () => {
    const { controller, images } = setup();

    await expect(
      controller.update(ID, { altText: 'Back label' }, context),
    ).resolves.toEqual({ id: ID });
    expect(images.update).toHaveBeenCalledWith(
      ID,
      { altText: 'Back label' },
      context,
    );
  });

  it("puts a product's images in a new order, recording who did it", async () => {
    const { controller, images } = setup();
    const order = { ids: [ID] };

    await expect(controller.reorder(PRODUCT, order, context)).resolves.toEqual({
      images: [],
    });
    expect(images.reorder).toHaveBeenCalledWith(PRODUCT, order, context);
  });

  it('checks the product ID and the order before the service sees them', async () => {
    const args = Object.values(
      Reflect.getMetadata(ROUTE_ARGS_METADATA, StaffImagesController, 'reorder') as Record<
        string,
        { index: number; pipes: PipeTransform[] }
      >,
    );
    const pipe = (index: number) =>
      args.find((arg) => arg.index === index)?.pipes[0] as PipeTransform;
    const param = { type: 'param', data: 'productId' } as const;

    await expect(pipe(0).transform(PRODUCT, param)).resolves.toBe(PRODUCT);
    await expect(pipe(0).transform('../x', param)).rejects.toThrow(
      BadRequestException,
    );
    expect(pipe(1).transform({ ids: [ID], position: 1 }, { type: 'body' })).toEqual({
      ids: [ID],
    });
    expect(() => pipe(1).transform({ ids: [ID, ID] }, { type: 'body' })).toThrow(
      BadRequestException,
    );
  });

  it('deletes an image by its ID, recording who did it', async () => {
    const { controller, images } = setup();

    await expect(controller.remove(ID, context)).resolves.toBeUndefined();
    expect(images.remove).toHaveBeenCalledWith(ID, context);
  });
});

describe('StaffImagesController routes', () => {
  it('serves the new order at PUT /v1/staff/products/:productId/images/order', () => {
    const handler = (
      StaffImagesController.prototype as unknown as Record<string, object>
    ).reorder;
    expect([
      Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod,
      Reflect.getMetadata(PATH_METADATA, handler) as string,
    ]).toEqual([RequestMethod.PUT, 'products/:productId/images/order']);
  });
});
