import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;
  const checkAll = jest.fn();

  beforeEach(async () => {
    checkAll.mockReset();
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: { checkAll } }],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it('reports liveness', () => {
    expect(controller.live()).toEqual({ status: 'ok' });
  });

  it('is ready when all dependencies are up', async () => {
    checkAll.mockResolvedValue({ database: 'up', valkey: 'up' });
    await expect(controller.ready()).resolves.toEqual({
      status: 'ok',
      checks: { database: 'up', valkey: 'up' },
    });
  });

  it('returns 503 when a dependency is down', async () => {
    checkAll.mockResolvedValue({ database: 'down', valkey: 'up' });
    await expect(controller.ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
