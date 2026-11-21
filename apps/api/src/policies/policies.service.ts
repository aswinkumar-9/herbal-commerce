import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AuditContext } from '../audit/audit-context';
import { AuditService } from '../audit/audit.service';
import type { Prisma } from '../generated/prisma/client';
import type { PolicyKind } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import type {
  DiscardQuery,
  PublishInput,
  SaveDraftInput,
} from './policies.schemas';
import { POLICY_PAGES, policyKindOf, policyPageOf } from './policy-pages';
import type { PolicyPageName } from './policy-pages';

const UNKNOWN_PAGE = 'Policy page not found';
const NOT_PUBLISHED = 'This page has not been published yet';
const VERSION_NOT_FOUND = 'Version not found';
const PAGE_CHANGED =
  'This page was saved, published or discarded since you opened it. Open it again to see the newest text.';
const NO_DRAFT = 'There is no draft to publish.';
const SAME_AS_PUBLISHED =
  'Nothing to publish: the draft is the same as the text on the website.';

// Who saved or published: staff see each other's names, customers never.
const PERSON = { select: { id: true, fullName: true } } as const;

const VERSION_SUMMARY = {
  version: true,
  publishedAt: true,
  publishedBy: PERSON,
} as const;

type Person = { id: string; fullName: string };

export interface PolicyVersionSummary {
  version: number;
  publishedAt: Date;
  publishedBy: Person;
}

export interface PolicyPageSummary {
  page: PolicyPageName;
  revision: number;
  draft: { updatedAt: Date; updatedBy: Person } | null;
  published: PolicyVersionSummary | null;
}

export interface PolicyPageDetail {
  page: PolicyPageName;
  revision: number;
  draft: { body: string; updatedAt: Date; updatedBy: Person } | null;
  published: (PolicyVersionSummary & { body: string }) | null;
}

// The website's policy pages (ADR 0040). Super Users prepare a page's text
// as a draft that only they see, then publish it. Every published version
// is kept for good; customers see the newest. Each save, discard and
// publish names the revision it was made on, and is written to the audit
// log in the same transaction.
@Injectable()
export class PoliciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @InjectPinoLogger(PoliciesService.name)
    private readonly logger: PinoLogger,
  ) {}

  // A page as customers see it: its newest version. Anyone may read it.
  async published(page: string) {
    const kind = this.kindOf(page);
    const latest = await this.prisma.policyVersion.findFirst({
      where: { kind },
      orderBy: { version: 'desc' },
      select: { version: true, body: true, publishedAt: true },
    });
    if (!latest) {
      throw new NotFoundException(NOT_PUBLISHED);
    }
    return { page: policyPageOf(kind), ...latest };
  }

  // Every page for Super Users, in the website's order: whether it has a
  // draft, and its newest version, without the texts.
  async list(): Promise<{ pages: PolicyPageSummary[] }> {
    const rows = await this.prisma.policyPage.findMany({
      select: {
        kind: true,
        revision: true,
        draftUpdatedAt: true,
        draftUpdatedBy: PERSON,
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
          select: VERSION_SUMMARY,
        },
      },
    });
    const pages = POLICY_PAGES.map((page): PolicyPageSummary => {
      const row = rows.find((found) => policyPageOf(found.kind) === page);
      return {
        page,
        revision: row?.revision ?? 0,
        draft:
          row?.draftUpdatedAt && row.draftUpdatedBy
            ? { updatedAt: row.draftUpdatedAt, updatedBy: row.draftUpdatedBy }
            : null,
        published: row?.versions[0] ?? null,
      };
    });
    return { pages };
  }

  // One page for Super Users: its draft and its newest version, with both
  // texts.
  async detail(page: string): Promise<PolicyPageDetail> {
    const kind = this.kindOf(page);
    const row = await this.prisma.policyPage.findUnique({
      where: { kind },
      select: {
        revision: true,
        draft: true,
        draftUpdatedAt: true,
        draftUpdatedBy: PERSON,
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
          select: { ...VERSION_SUMMARY, body: true },
        },
      },
    });
    return {
      page: policyPageOf(kind),
      revision: row?.revision ?? 0,
      draft:
        row?.draft != null && row.draftUpdatedAt && row.draftUpdatedBy
          ? {
              body: row.draft,
              updatedAt: row.draftUpdatedAt,
              updatedBy: row.draftUpdatedBy,
            }
          : null,
      published: row?.versions[0] ?? null,
    };
  }

  // Every version customers have been shown, newest first.
  async versions(page: string): Promise<{ versions: PolicyVersionSummary[] }> {
    const kind = this.kindOf(page);
    const versions = await this.prisma.policyVersion.findMany({
      where: { kind },
      orderBy: { version: 'desc' },
      select: VERSION_SUMMARY,
    });
    return { versions };
  }

  // One version, with its text: what customers were shown from that day.
  async version(page: string, version: number) {
    const kind = this.kindOf(page);
    const found = await this.prisma.policyVersion.findUnique({
      where: { kind_version: { kind, version } },
      select: { ...VERSION_SUMMARY, body: true },
    });
    if (!found) {
      throw new NotFoundException(VERSION_NOT_FOUND);
    }
    return { page: policyPageOf(kind), ...found };
  }

  // Saves the draft. The same text again is no change, and is not audited.
  async saveDraft(
    page: string,
    input: SaveDraftInput,
    context: AuditContext,
  ): Promise<PolicyPageDetail> {
    const kind = this.kindOf(page);
    const actorId = this.actorOf(context);
    const saved = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockedPage(tx, kind, input.revision);
      if (current.draft === input.body) {
        return false;
      }
      await tx.policyPage.update({
        where: { kind },
        data: {
          draft: input.body,
          draftUpdatedAt: new Date(),
          draftUpdatedById: actorId,
          revision: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        ...context,
        action: 'policy.draft_saved',
        targetType: 'policy_page',
        targetId: policyPageOf(kind),
        before: { revision: current.revision },
        after: {
          revision: current.revision + 1,
          characters: input.body.length,
        },
      });
      return true;
    });
    if (saved) {
      this.logger.info(
        { page: policyPageOf(kind), actorId },
        'Policy draft saved',
      );
    }
    return this.detail(page);
  }

  // Throws the draft away. A page without one is no change.
  async discardDraft(
    page: string,
    query: DiscardQuery,
    context: AuditContext,
  ): Promise<PolicyPageDetail> {
    const kind = this.kindOf(page);
    const actorId = this.actorOf(context);
    const discarded = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockedPage(tx, kind, query.revision);
      if (current.draft === null) {
        return false;
      }
      await tx.policyPage.update({
        where: { kind },
        data: {
          draft: null,
          draftUpdatedAt: null,
          draftUpdatedById: null,
          revision: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        ...context,
        action: 'policy.draft_discarded',
        targetType: 'policy_page',
        targetId: policyPageOf(kind),
        before: {
          revision: current.revision,
          characters: current.draft.length,
        },
        after: { revision: current.revision + 1 },
      });
      return true;
    });
    if (discarded) {
      this.logger.info(
        { page: policyPageOf(kind), actorId },
        'Policy draft discarded',
      );
    }
    return this.detail(page);
  }

  // Puts the draft on the website as the page's next version, and empties
  // the draft. Refused when there is no draft, or it says what the website
  // already shows.
  async publish(
    page: string,
    input: PublishInput,
    context: AuditContext,
  ): Promise<PolicyPageDetail> {
    const kind = this.kindOf(page);
    const actorId = this.actorOf(context);
    const version = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockedPage(tx, kind, input.revision);
      if (current.draft === null) {
        throw new ConflictException(NO_DRAFT);
      }
      const latest = await tx.policyVersion.findFirst({
        where: { kind },
        orderBy: { version: 'desc' },
        select: { version: true, body: true },
      });
      if (latest?.body === current.draft) {
        throw new ConflictException(SAME_AS_PUBLISHED);
      }
      const next = (latest?.version ?? 0) + 1;
      await tx.policyVersion.create({
        data: {
          kind,
          version: next,
          body: current.draft,
          publishedById: actorId,
        },
      });
      await tx.policyPage.update({
        where: { kind },
        data: {
          draft: null,
          draftUpdatedAt: null,
          draftUpdatedById: null,
          revision: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        ...context,
        action: 'policy.published',
        targetType: 'policy_page',
        targetId: policyPageOf(kind),
        before: {
          revision: current.revision,
          version: latest?.version ?? null,
        },
        after: {
          revision: current.revision + 1,
          version: next,
          characters: current.draft.length,
        },
      });
      return next;
    });
    this.logger.info(
      { page: policyPageOf(kind), version, actorId },
      'Policy page published',
    );
    return this.detail(page);
  }

  private kindOf(page: string): PolicyKind {
    const kind = policyKindOf(page);
    if (!kind) {
      throw new NotFoundException(UNKNOWN_PAGE);
    }
    return kind;
  }

  // Staff routes always know who is calling; without that, refuse rather
  // than save a change nobody made.
  private actorOf(context: AuditContext): string {
    if (!context.actorId) {
      throw new ForbiddenException('Only a Super User may do this.');
    }
    return context.actorId;
  }

  // The page's row, made if this is its first change, and locked for the
  // rest of the transaction, so changes to one page take turns. The change
  // must be made on the page's current revision.
  private async lockedPage(
    tx: Prisma.TransactionClient,
    kind: PolicyKind,
    revision: number,
  ): Promise<{ revision: number; draft: string | null }> {
    await tx.$executeRaw`
      INSERT INTO policy_pages (kind) VALUES (${kind}::"PolicyKind")
      ON CONFLICT (kind) DO NOTHING`;
    const [current] = await tx.$queryRaw<
      { revision: number; draft: string | null }[]
    >`
      SELECT revision, draft FROM policy_pages
       WHERE kind = ${kind}::"PolicyKind" FOR UPDATE`;
    if (!current || current.revision !== revision) {
      throw new ConflictException(PAGE_CHANGED);
    }
    return current;
  }
}
