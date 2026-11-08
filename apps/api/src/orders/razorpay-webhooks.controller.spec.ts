import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { RazorpayWebhooksController } from './razorpay-webhooks.controller';
import type { RazorpayWebhooksService } from './razorpay-webhooks.service';

describe('RazorpayWebhooksController', () => {
  it('passes the body exactly as it arrived, and the signature, to the service', async () => {
    const webhooks = { receive: jest.fn().mockResolvedValue(undefined) };
    const controller = new RazorpayWebhooksController(
      webhooks as unknown as RazorpayWebhooksService,
    );
    const rawBody = Buffer.from('{"event":"payment.captured"}');

    await expect(
      controller.receive({ rawBody } as RawBodyRequest<Request>, 'signature'),
    ).resolves.toBeUndefined();
    expect(webhooks.receive).toHaveBeenCalledWith(rawBody, 'signature');
  });
});
