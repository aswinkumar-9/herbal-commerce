import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { PoliciesService } from './policies.service';

const SUPER = {
  id: '5d1e8c2a-7b3f-4e9a-a1c6-2f8d0b4e7a93',
  fullName: 'Meera Rao',
};
const context = {
  actorId: SUPER.id,
  ip: '203.0.113.7',
  requestId: 'request-1',
};
const savedAt = new Date('2026-11-21T09:15:00.000Z');
const publishedAt = new Date('2026-11-20T10:00:00.000Z');
const DRAFT = '## Who we are\n\nA shop that sells herbs.';
const LIVE = '## Who we are\n\nA shop.';

function setup({
  locked = { revision: 4, draft: DRAFT as string | null },
  latest = { version: 2, body: LIVE } as {
    version: number;
    body: string;
  } | null,
} = {}) {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    $queryRaw: jest.fn().mockResolvedValue(locked ? [locked] : []),
    policyPage: { update: jest.fn().mockResolvedValue({}) },
    policyVersion: {
      findFirst: jest.fn().mockResolvedValue(latest),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    policyPage: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    policyVersion: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const logger = { info: jest.fn() };
  const service = new PoliciesService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    logger as unknown as PinoLogger,
  );
  return { service, prisma, tx, audit, logger };
}

// The words a query was given.
function firstCall(mock: jest.Mock): Record<string, unknown> {
  return (mock.mock.calls[0] as [Record<string, unknown>])[0];
}

// The SQL a tagged template ran, with its values.
function sqlOf(
  mock: jest.Mock,
  index = 0,
): { text: string; values: unknown[] } {
  const [strings, ...values] = mock.mock.calls[index] as [
    TemplateStringsArray,
    ...unknown[],
  ];
  return { text: strings.join('?').replace(/\s+/g, ' ').trim(), values };
}

describe('PoliciesService.published', () => {
  it("gives a page's newest version, without who published it", async () => {
    const { service, prisma } = setup();
    prisma.policyVersion.findFirst.mockResolvedValue({
      version: 3,
      body: LIVE,
      publishedAt,
    });

    await expect(service.published('privacy')).resolves.toEqual({
      page: 'privacy',
      version: 3,
      body: LIVE,
      publishedAt,
    });
    const query = firstCall(prisma.policyVersion.findFirst);
    expect(query.where).toEqual({ kind: 'PRIVACY' });
    expect(query.orderBy).toEqual({ version: 'desc' });
    expect(Object.keys(query.select as object).sort()).toEqual([
      'body',
      'publishedAt',
      'version',
    ]);
  });

  it('answers 404 for a page never published', async () => {
    const { service } = setup();

    await expect(service.published('terms')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('answers 404 for an unknown page, without asking the database', async () => {
    const { service, prisma } = setup();

    for (const page of ['about', 'PRIVACY', 'constructor', '__proto__']) {
      await expect(service.published(page)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    }
    expect(prisma.policyVersion.findFirst).not.toHaveBeenCalled();
  });
});

describe('PoliciesService.list', () => {
  it('lists all five pages in order, with a draft and the newest version where there are', async () => {
    const { service, prisma } = setup();
    prisma.policyPage.findMany.mockResolvedValue([
      {
        kind: 'TERMS',
        revision: 6,
        draftUpdatedAt: savedAt,
        draftUpdatedBy: SUPER,
        versions: [{ version: 2, publishedAt, publishedBy: SUPER }],
      },
      {
        kind: 'PRIVACY',
        revision: 1,
        draftUpdatedAt: null,
        draftUpdatedBy: null,
        versions: [],
      },
    ]);

    const { pages } = await service.list();

    expect(pages).toEqual([
      { page: 'privacy', revision: 1, draft: null, published: null },
      {
        page: 'terms',
        revision: 6,
        draft: { updatedAt: savedAt, updatedBy: SUPER },
        published: { version: 2, publishedAt, publishedBy: SUPER },
      },
      { page: 'refunds', revision: 0, draft: null, published: null },
      { page: 'shipping', revision: 0, draft: null, published: null },
      { page: 'contact', revision: 0, draft: null, published: null },
    ]);
    // No texts in the list.
    const query = firstCall(prisma.policyPage.findMany);
    expect(JSON.stringify(query)).not.toMatch(/"(draft|body)"/);
  });
});

describe('PoliciesService.detail', () => {
  it('gives the draft and the text on the website', async () => {
    const { service, prisma } = setup();
    prisma.policyPage.findUnique.mockResolvedValue({
      revision: 4,
      draft: DRAFT,
      draftUpdatedAt: savedAt,
      draftUpdatedBy: SUPER,
      versions: [{ version: 2, publishedAt, publishedBy: SUPER, body: LIVE }],
    });

    await expect(service.detail('refunds')).resolves.toEqual({
      page: 'refunds',
      revision: 4,
      draft: { body: DRAFT, updatedAt: savedAt, updatedBy: SUPER },
      published: { version: 2, publishedAt, publishedBy: SUPER, body: LIVE },
    });
    expect(firstCall(prisma.policyPage.findUnique).where).toEqual({
      kind: 'REFUNDS',
    });
  });

  it('gives an empty page at revision 0 before anyone has saved it', async () => {
    const { service } = setup();

    await expect(service.detail('contact')).resolves.toEqual({
      page: 'contact',
      revision: 0,
      draft: null,
      published: null,
    });
  });

  it('answers 404 for an unknown page', async () => {
    const { service, prisma } = setup();

    await expect(service.detail('cookies')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.policyPage.findUnique).not.toHaveBeenCalled();
  });
});

describe('PoliciesService.versions and version', () => {
  it('lists the versions, newest first, without the texts', async () => {
    const { service, prisma } = setup();
    const versions = [{ version: 2, publishedAt, publishedBy: SUPER }];
    prisma.policyVersion.findMany.mockResolvedValue(versions);

    await expect(service.versions('shipping', { limit: 20 })).resolves.toEqual({
      versions,
      nextBefore: null,
    });
    const query = firstCall(prisma.policyVersion.findMany);
    expect(query.where).toEqual({ kind: 'SHIPPING' });
    expect(query.orderBy).toEqual({ version: 'desc' });
    expect(Object.keys(query.select as object)).not.toContain('body');
  });

  it('gives them a page at a time, the older ones below the last shown', async () => {
    const { service, prisma } = setup();
    const version = (number: number) => ({
      version: number,
      publishedAt,
      publishedBy: SUPER,
    });
    // One more than asked for: an older page exists.
    prisma.policyVersion.findMany.mockResolvedValueOnce([
      version(9),
      version(8),
      version(7),
    ]);

    await expect(service.versions('shipping', { limit: 2 })).resolves.toEqual({
      versions: [version(9), version(8)],
      nextBefore: 8,
    });
    expect(firstCall(prisma.policyVersion.findMany).take).toBe(3);

    prisma.policyVersion.findMany.mockResolvedValueOnce([version(7)]);
    await expect(
      service.versions('shipping', { limit: 2, before: 8 }),
    ).resolves.toEqual({ versions: [version(7)], nextBefore: null });
    expect(prisma.policyVersion.findMany.mock.calls[1][0].where).toEqual({
      kind: 'SHIPPING',
      version: { lt: 8 },
    });
  });

  it('gives one version with its text', async () => {
    const { service, prisma } = setup();
    const found = { version: 1, publishedAt, publishedBy: SUPER, body: LIVE };
    prisma.policyVersion.findUnique.mockResolvedValue(found);

    await expect(service.version('privacy', 1)).resolves.toEqual({
      page: 'privacy',
      ...found,
    });
    expect(firstCall(prisma.policyVersion.findUnique).where).toEqual({
      kind_version: { kind: 'PRIVACY', version: 1 },
    });
  });

  it('answers 404 for a version that does not exist, or an unknown page', async () => {
    const { service } = setup();

    await expect(service.version('privacy', 9)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.versions('nope', { limit: 20 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PoliciesService.saveDraft', () => {
  it('saves the draft on its revision, with who and when, and audits it without the text', async () => {
    const { service, tx, audit, logger } = setup({
      locked: { revision: 4, draft: 'Older draft' },
    });

    await service.saveDraft('privacy', { body: DRAFT, revision: 4 }, context);

    // The page's row is made if need be, then locked.
    expect(sqlOf(tx.$executeRaw).text).toBe(
      'INSERT INTO policy_pages (kind) VALUES (?::"PolicyKind") ON CONFLICT (kind) DO NOTHING',
    );
    expect(sqlOf(tx.$executeRaw).values).toEqual(['PRIVACY']);
    expect(sqlOf(tx.$queryRaw).text).toMatch(/FOR UPDATE$/);
    expect(sqlOf(tx.$queryRaw).values).toEqual(['PRIVACY']);

    const update = firstCall(tx.policyPage.update);
    expect(update.where).toEqual({ kind: 'PRIVACY' });
    expect(update.data).toEqual({
      draft: DRAFT,
      draftUpdatedAt: expect.any(Date) as Date,
      draftUpdatedById: SUPER.id,
      revision: { increment: 1 },
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...context,
      action: 'policy.draft_saved',
      targetType: 'policy_page',
      targetId: 'privacy',
      before: { revision: 4 },
      after: { revision: 5, characters: DRAFT.length },
    });
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('herbs');
    expect(logger.info).toHaveBeenCalledWith(
      { page: 'privacy', actorId: SUPER.id },
      'Policy draft saved',
    );
  });

  it('refuses a change made on an older revision, with 409, changing nothing', async () => {
    const { service, tx, audit } = setup({
      locked: { revision: 5, draft: null },
    });

    await expect(
      service.saveDraft('privacy', { body: DRAFT, revision: 4 }, context),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.policyPage.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('treats the same text again as no change, and does not audit it', async () => {
    const { service, tx, audit, logger } = setup();

    await service.saveDraft('privacy', { body: DRAFT, revision: 4 }, context);

    expect(tx.policyPage.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('answers with the page as it now is', async () => {
    const { service, prisma } = setup();

    await expect(
      service.saveDraft('terms', { body: 'New', revision: 4 }, context),
    ).resolves.toEqual({
      page: 'terms',
      revision: 0,
      draft: null,
      published: null,
    });
    expect(firstCall(prisma.policyPage.findUnique).where).toEqual({
      kind: 'TERMS',
    });
  });

  it('refuses without a known caller, and an unknown page, before any transaction', async () => {
    const { service, prisma } = setup();

    await expect(
      service.saveDraft(
        'privacy',
        { body: DRAFT, revision: 4 },
        { ip: '203.0.113.7' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.saveDraft('about', { body: DRAFT, revision: 4 }, context),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('PoliciesService.discardDraft', () => {
  it('throws the draft away and audits it', async () => {
    const { service, tx, audit } = setup();

    await service.discardDraft('shipping', { revision: 4 }, context);

    const update = firstCall(tx.policyPage.update);
    expect(update.where).toEqual({ kind: 'SHIPPING' });
    expect(update.data).toEqual({
      draft: null,
      draftUpdatedAt: null,
      draftUpdatedById: null,
      revision: { increment: 1 },
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...context,
      action: 'policy.draft_discarded',
      targetType: 'policy_page',
      targetId: 'shipping',
      before: { revision: 4, characters: DRAFT.length },
      after: { revision: 5 },
    });
  });

  it('changes nothing when there is no draft', async () => {
    const { service, tx, audit } = setup({
      locked: { revision: 4, draft: null },
    });

    await service.discardDraft('shipping', { revision: 4 }, context);

    expect(tx.policyPage.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('refuses an older revision with 409', async () => {
    const { service, tx } = setup();

    await expect(
      service.discardDraft('shipping', { revision: 3 }, context),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.policyPage.update).not.toHaveBeenCalled();
  });
});

describe('PoliciesService.publish', () => {
  it('puts the draft on the website as the next version, empties the draft, and audits it', async () => {
    const { service, tx, audit, logger } = setup();

    await service.publish('privacy', { revision: 4 }, context);

    expect(firstCall(tx.policyVersion.findFirst)).toEqual({
      where: { kind: 'PRIVACY' },
      orderBy: { version: 'desc' },
      select: { version: true, body: true },
    });
    expect(tx.policyVersion.create).toHaveBeenCalledWith({
      data: {
        kind: 'PRIVACY',
        version: 3,
        body: DRAFT,
        publishedById: SUPER.id,
      },
    });
    expect(firstCall(tx.policyPage.update).data).toEqual({
      draft: null,
      draftUpdatedAt: null,
      draftUpdatedById: null,
      revision: { increment: 1 },
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...context,
      action: 'policy.published',
      targetType: 'policy_page',
      targetId: 'privacy',
      before: { revision: 4, version: 2 },
      after: { revision: 5, version: 3, characters: DRAFT.length },
    });
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('herbs');
    expect(logger.info).toHaveBeenCalledWith(
      { page: 'privacy', version: 3, actorId: SUPER.id },
      'Policy page published',
    );
  });

  it("makes a page's first publish version 1", async () => {
    const { service, tx, audit } = setup({ latest: null });

    await service.publish('contact', { revision: 4 }, context);

    expect(firstCall(tx.policyVersion.create)).toEqual({
      data: {
        kind: 'CONTACT',
        version: 1,
        body: DRAFT,
        publishedById: SUPER.id,
      },
    });
    expect(
      (audit.record.mock.calls[0] as [unknown, { before: object }])[1].before,
    ).toEqual({ revision: 4, version: null });
  });

  it('refuses with 409 when there is no draft', async () => {
    const { service, tx, audit } = setup({
      locked: { revision: 4, draft: null },
    });

    await expect(
      service.publish('privacy', { revision: 4 }, context),
    ).rejects.toThrow('There is no draft to publish.');
    expect(tx.policyVersion.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('refuses with 409 when the draft says what the website already shows', async () => {
    const { service, tx } = setup({ latest: { version: 2, body: DRAFT } });

    await expect(
      service.publish('privacy', { revision: 4 }, context),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.policyVersion.create).not.toHaveBeenCalled();
    expect(tx.policyPage.update).not.toHaveBeenCalled();
  });

  it('refuses a revision other than the one previewed, with 409', async () => {
    const { service, tx } = setup();

    await expect(
      service.publish('privacy', { revision: 5 }, context),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.policyVersion.findFirst).not.toHaveBeenCalled();
    expect(tx.policyVersion.create).not.toHaveBeenCalled();
  });
});
