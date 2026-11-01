import { AddressesController } from './addresses.controller';
import { AddressesService } from './addresses.service';

const USER = { id: 'user-1', sessionId: 'session-1', role: 'CUSTOMER' as const };
const input = {
  fullName: 'Asha K',
  phone: '9845012345',
  line1: '12, 3rd Cross, Indiranagar',
  city: 'Bengaluru',
  state: 'Karnataka' as const,
  pincode: '560038',
};

function setup() {
  const addresses = {
    list: jest.fn().mockResolvedValue({ addresses: [] }),
    add: jest.fn().mockResolvedValue({ id: 'address-1' }),
  };
  const controller = new AddressesController(
    addresses as unknown as AddressesService,
  );
  return { controller, addresses };
}

describe('AddressesController', () => {
  it("lists the caller's own addresses, by the ID in the token", async () => {
    const { controller, addresses } = setup();

    await expect(controller.list(USER)).resolves.toEqual({ addresses: [] });
    expect(addresses.list).toHaveBeenCalledWith('user-1');
  });

  it('adds the address for the caller, by the ID in the token', async () => {
    const { controller, addresses } = setup();

    await expect(controller.add(USER, input)).resolves.toEqual({
      id: 'address-1',
    });
    expect(addresses.add).toHaveBeenCalledWith('user-1', input);
  });
});
