import { CartController } from './cart.controller';
import type { CartService } from './cart.service';

const USER = {
  id: 'user-1',
  sessionId: 'session-1',
  role: 'CUSTOMER' as const,
};
const empty = { items: [], packs: 0, subtotalRupees: 0, mrpTotalRupees: 0 };

function setup() {
  const cart = {
    view: jest.fn().mockResolvedValue(empty),
    setPacks: jest.fn().mockResolvedValue(empty),
    remove: jest.fn().mockResolvedValue(undefined),
    empty: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new CartController(cart as unknown as CartService);
  return { controller, cart };
}

describe('CartController', () => {
  it("shows the caller's own cart, by the ID in the token", async () => {
    const { controller, cart } = setup();

    await expect(controller.view(USER)).resolves.toEqual(empty);
    expect(cart.view).toHaveBeenCalledWith('user-1');
  });

  it("sets the packs of a pack size in the caller's cart, by its SKU", async () => {
    const { controller, cart } = setup();

    await expect(
      controller.setPacks(USER, 'ASH-CAP-60', { packs: 2 }),
    ).resolves.toEqual(empty);
    expect(cart.setPacks).toHaveBeenCalledWith('user-1', 'ASH-CAP-60', 2);
  });

  it("takes a pack size out of the caller's cart, by its SKU", async () => {
    const { controller, cart } = setup();

    await expect(
      controller.remove(USER, 'ASH-CAP-60'),
    ).resolves.toBeUndefined();
    expect(cart.remove).toHaveBeenCalledWith('user-1', 'ASH-CAP-60');
  });

  it("empties the caller's cart", async () => {
    const { controller, cart } = setup();

    await expect(controller.empty(USER)).resolves.toBeUndefined();
    expect(cart.empty).toHaveBeenCalledWith('user-1');
  });
});
