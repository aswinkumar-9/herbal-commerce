import { Reflector } from '@nestjs/core';
import { STAFF_ONLY } from '../auth/staff-only.decorator';
import { SUPER_USER_ONLY } from '../auth/super-user-only.decorator';
import type { PaymentsService } from './payments.service';
import { StaffRefundsController } from './staff-refunds.controller';

describe('StaffRefundsController', () => {
  it('lists refunds as asked, for Super Users only, which takes staff tokens only', async () => {
    const page = { refunds: [], nextAfter: null };
    const payments = { listRefunds: jest.fn().mockResolvedValue(page) };
    const controller = new StaffRefundsController(
      payments as unknown as PaymentsService,
    );

    const after = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f101';
    await expect(
      controller.list({ limit: 50, after, status: 'FAILED' }),
    ).resolves.toBe(page);
    expect(payments.listRefunds).toHaveBeenCalledWith({
      limit: 50,
      after,
      status: 'FAILED',
    });
    const reflector = new Reflector();
    expect(reflector.get(STAFF_ONLY, StaffRefundsController)).toBe(true);
    expect(reflector.get(SUPER_USER_ONLY, StaffRefundsController)).toBe(true);
  });
});
