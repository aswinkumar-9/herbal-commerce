import { BadRequestException, HttpStatus, RequestMethod } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { StaffStockController } from './staff-stock.controller';
import { StockOverviewService } from './stock-overview.service';
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
    count: jest.fn().mockResolvedValue({ batch: { id: BATCH }, change: -2 }),
  };
  const overview = {
    list: jest.fn().mockResolvedValue({ lines: [], nextAfter: null }),
  };
  const controller = new StaffStockController(
    stock as unknown as StockService,
    overview as unknown as StockOverviewService,
  );
  return { controller, stock, overview };
}

// The pipes a handler's arguments go through, by their place.
function pipes(handler: string) {
  const args = Object.values(
    Reflect.getMetadata(ROUTE_ARGS_METADATA, StaffStockController, handler) as Record<
      string,
      { index: number; pipes: PipeTransform[] }
    >,
  );
  return (index: number) =>
    args.find((arg) => arg.index === index)?.pipes[0] as PipeTransform;
}

function route(handler: string) {
  const method = (StaffStockController.prototype as unknown as Record<string, object>)[handler];
  return [
    Reflect.getMetadata(METHOD_METADATA, method) as RequestMethod,
    Reflect.getMetadata(PATH_METADATA, method) as string,
    Reflect.getMetadata(HTTP_CODE_METADATA, method) as HttpStatus | undefined,
  ];
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

  it('lists the pack sizes with their stock, for the Stock page', async () => {
    const { controller, overview } = setup();
    const query = { limit: 100, status: 'low' as const };

    await expect(controller.list(query)).resolves.toEqual({ lines: [], nextAfter: null });
    expect(overview.list).toHaveBeenCalledWith(query);
  });

  it('checks the Stock page query before the service sees it', () => {
    const pipe = pipes('list')(0);

    expect(pipe.transform({ status: 'out', limit: '20', sort: 'x' }, { type: 'query' })).toEqual({
      status: 'out',
      limit: 20,
    });
    expect(() => pipe.transform({ status: 'all' }, { type: 'query' })).toThrow(BadRequestException);
    expect(() => pipe.transform({ productId: '../x' }, { type: 'query' })).toThrow(BadRequestException);
  });

  it("puts right a batch's stock from a count, recording who did it", async () => {
    const { controller, stock } = setup();
    const body = { counted: 117, onShelf: 119, note: 'Shelf count' };

    await expect(controller.count(BATCH, body, context)).resolves.toEqual({
      batch: { id: BATCH },
      change: -2,
    });
    expect(stock.count).toHaveBeenCalledWith(BATCH, body, context);
  });

  it('checks the batch ID and the count before the service sees them', async () => {
    const pipe = pipes('count');
    const param = { type: 'param', data: 'id' } as const;

    await expect(pipe(0).transform(BATCH, param)).resolves.toBe(BATCH);
    await expect(pipe(0).transform('../x', param)).rejects.toThrow(BadRequestException);
    expect(pipe(1).transform({ counted: 3, onShelf: 4, change: 9 }, { type: 'body' })).toEqual({
      counted: 3,
      onShelf: 4,
    });
    expect(() => pipe(1).transform({ counted: -1, onShelf: 4 }, { type: 'body' })).toThrow(
      BadRequestException,
    );
  });

  it("changes a batch's stock, recording who did it", async () => {
    const { controller, stock } = setup();
    const body = { change: -2, reason: 'DAMAGED' as const, note: 'Broken seal' };

    await expect(controller.addMovement(BATCH, body, context)).resolves.toEqual({ id: BATCH });
    expect(stock.addMovement).toHaveBeenCalledWith(BATCH, body, context);
  });
});

describe('StaffStockController routes', () => {
  it('serves the Stock page at GET /v1/staff/stock', () => {
    expect(route('list')).toEqual([RequestMethod.GET, 'stock', undefined]);
  });

  it('takes a count at POST /v1/staff/batches/:id/count, answering 200', () => {
    expect(route('count')).toEqual([RequestMethod.POST, 'batches/:id/count', HttpStatus.OK]);
  });
});
