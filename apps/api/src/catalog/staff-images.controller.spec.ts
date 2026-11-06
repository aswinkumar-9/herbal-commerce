import { UnsupportedMediaTypeException } from '@nestjs/common';
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

  it('deletes an image by its ID, recording who did it', async () => {
    const { controller, images } = setup();

    await expect(controller.remove(ID, context)).resolves.toBeUndefined();
    expect(images.remove).toHaveBeenCalledWith(ID, context);
  });
});
