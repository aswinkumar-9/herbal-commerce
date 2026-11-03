import { CategoriesService } from './categories.service';
import { StaffCategoriesController } from './staff-categories.controller';

const ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const context = {
  actorId: '5d1e8c2a-7b3f-4e9a-a1c6-2f8d0b4e7a93',
  ip: '203.0.113.7',
  requestId: 'request-1',
};

function setup() {
  const categories = {
    list: jest.fn().mockResolvedValue({ categories: [] }),
    create: jest.fn().mockResolvedValue({ id: ID }),
    update: jest.fn().mockResolvedValue({ id: ID }),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new StaffCategoriesController(
    categories as unknown as CategoriesService,
  );
  return { controller, categories };
}

describe('StaffCategoriesController', () => {
  it('lists every category', async () => {
    const { controller, categories } = setup();

    await expect(controller.list()).resolves.toEqual({ categories: [] });
    expect(categories.list).toHaveBeenCalledWith();
  });

  it('creates a category, recording who did it', async () => {
    const { controller, categories } = setup();
    const input = { name: 'Hair Care', slug: 'hair-care' };

    await expect(controller.create(input, context)).resolves.toEqual({
      id: ID,
    });
    expect(categories.create).toHaveBeenCalledWith(input, context);
  });

  it('changes a category by its ID, recording who did it', async () => {
    const { controller, categories } = setup();

    await expect(
      controller.update(ID, { isActive: true }, context),
    ).resolves.toEqual({ id: ID });
    expect(categories.update).toHaveBeenCalledWith(
      ID,
      { isActive: true },
      context,
    );
  });

  it('deletes a category by its ID, recording who did it', async () => {
    const { controller, categories } = setup();

    await expect(controller.remove(ID, context)).resolves.toBeUndefined();
    expect(categories.remove).toHaveBeenCalledWith(ID, context);
  });
});
