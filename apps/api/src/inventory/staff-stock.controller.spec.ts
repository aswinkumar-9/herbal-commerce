import { StaffStockController } from './staff-stock.controller';
import { StockService } from './stock.service';

const VARIANT = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const BATCH = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';
const context = {
  actorId: '5d1e8c2a-7b3f-4e9a-a1c6-2f8d0b4e7a93',
  ip: '203.0.113.7',
  requestId: 'request-1',
};

function setup() {
  const stock = {
    listBatches: jest.fn().mockResolvedValue({ batches: [] }),
    receive: jest.fn().mockResolvedValue({ id: BATCH }),
    updateBatch: jest.fn().mockResolvedValue({ id: BATCH }),
    listMovements: jest.fn().mockResolvedValue({ movements: [] }),
    addMovement: jest.fn().mockResolvedValue({ id: BATCH }),
  };
  const controller = new StaffStockController(stock as unknown as StockService);
  return { controller, stock };
}

describe('StaffStockController', () => {
  it("lists a pack size's batches by the pack's ID", async () => {
    const { controller, stock } = setup();

    await expect(controller.listBatches(VARIANT)).resolves.toEqual({ batches: [] });
    expect(stock.listBatches).toHaveBeenCalledWith(VARIANT);
  });

  it('receives a batch for the pack size, recording who did it', async () => {
    const { controller, stock } = setup();
    const body = {
      batchNumber: 'AB2611',
      manufacturedOn: new Date('2026-10-01T00:00:00.000Z'),
      expiresOn: new Date('2028-09-30T00:00:00.000Z'),
      quantity: 120,
    };

    await expect(controller.receive(VARIANT, body, context)).resolves.toEqual({ id: BATCH });
    expect(stock.receive).toHaveBeenCalledWith(VARIANT, body, context);
  });

  it('corrects a batch by its ID, recording who did it', async () => {
    const { controller, stock } = setup();

    await expect(
      controller.updateBatch(BATCH, { batchNumber: 'AB2612' }, context),
    ).resolves.toEqual({ id: BATCH });
    expect(stock.updateBatch).toHaveBeenCalledWith(BATCH, { batchNumber: 'AB2612' }, context);
  });

  it("lists a batch's movements, one page at a time", async () => {
    const { controller, stock } = setup();

    await expect(controller.listMovements(BATCH, { limit: 50 })).resolves.toEqual({ movements: [] });
    expect(stock.listMovements).toHaveBeenCalledWith(BATCH, { limit: 50 });
  });

  it("changes a batch's stock, recording who did it", async () => {
    const { controller, stock } = setup();
    const body = { change: -2, reason: 'DAMAGED' as const, note: 'Broken seal' };

    await expect(controller.addMovement(BATCH, body, context)).resolves.toEqual({ id: BATCH });
    expect(stock.addMovement).toHaveBeenCalledWith(BATCH, body, context);
  });
});
