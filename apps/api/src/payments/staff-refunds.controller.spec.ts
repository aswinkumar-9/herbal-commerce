import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from '../auth/auth-user';
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

  it('marks a failed refund given back by hand, by the signed-in Super User, answering 200', async () => {
    const refund = { id: 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f101' };
    const payments = { giveBackByHand: jest.fn().mockResolvedValue(refund) };
    const controller = new StaffRefundsController(
      payments as unknown as PaymentsService,
    );
    const user = { id: 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c301', role: 'SUPER_USER' };
    const context = { actorId: user.id, ip: '203.0.113.9', requestId: 'req-7' };

    await expect(
      controller.givenBack(
        refund.id,
        { note: 'Bank transfer, UTR 412345678901' },
        user as unknown as AuthUser,
        context,
      ),
    ).resolves.toBe(refund);
    expect(payments.giveBackByHand).toHaveBeenCalledWith(
      refund.id,
      { note: 'Bank transfer, UTR 412345678901' },
      user.id,
      context,
    );
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        (StaffRefundsController.prototype as unknown as Record<string, object>)
          .givenBack,
      ),
    ).toBe(200);
  });
});
