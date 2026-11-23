import { PoliciesController } from './policies.controller';
import { PoliciesService } from './policies.service';
import { StaffPoliciesController } from './staff-policies.controller';

const context = {
  actorId: '5d1e8c2a-7b3f-4e9a-a1c6-2f8d0b4e7a93',
  ip: '203.0.113.7',
  requestId: 'request-1',
};

function setup() {
  const answer = { page: 'privacy' };
  const policies = {
    published: jest.fn().mockResolvedValue(answer),
    list: jest.fn().mockResolvedValue({ pages: [] }),
    detail: jest.fn().mockResolvedValue(answer),
    saveDraft: jest.fn().mockResolvedValue(answer),
    discardDraft: jest.fn().mockResolvedValue(answer),
    publish: jest.fn().mockResolvedValue(answer),
    versions: jest.fn().mockResolvedValue({ versions: [] }),
    version: jest.fn().mockResolvedValue(answer),
  };
  const service = policies as unknown as PoliciesService;
  return {
    customers: new PoliciesController(service),
    staff: new StaffPoliciesController(service),
    policies,
    answer,
  };
}

describe('PoliciesController', () => {
  it("gives a page's published text by its name", async () => {
    const { customers, policies, answer } = setup();

    await expect(customers.published('privacy')).resolves.toBe(answer);
    expect(policies.published).toHaveBeenCalledWith('privacy');
  });
});

describe('StaffPoliciesController', () => {
  it('lists the pages, and gives one with its draft', async () => {
    const { staff, policies, answer } = setup();

    await expect(staff.list()).resolves.toEqual({ pages: [] });
    await expect(staff.detail('terms')).resolves.toBe(answer);
    expect(policies.detail).toHaveBeenCalledWith('terms');
  });

  it('saves, discards and publishes, recording who did it', async () => {
    const { staff, policies } = setup();
    const body = { body: 'Text', revision: 2 };

    await staff.saveDraft('terms', body, context);
    await staff.discardDraft('terms', { revision: 3 }, context);
    await staff.publish('terms', { revision: 4 }, context);

    expect(policies.saveDraft).toHaveBeenCalledWith('terms', body, context);
    expect(policies.discardDraft).toHaveBeenCalledWith(
      'terms',
      { revision: 3 },
      context,
    );
    expect(policies.publish).toHaveBeenCalledWith(
      'terms',
      { revision: 4 },
      context,
    );
  });

  it('lists the versions, and gives one', async () => {
    const { staff, policies } = setup();

    await staff.versions('refunds', { limit: 20, before: 5 });
    await staff.version('refunds', 2);

    expect(policies.versions).toHaveBeenCalledWith('refunds', {
      limit: 20,
      before: 5,
    });
    expect(policies.version).toHaveBeenCalledWith('refunds', 2);
  });
});
