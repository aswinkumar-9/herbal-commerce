import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AuditContext } from '../audit/audit-context';
import { AuditService } from '../audit/audit.service';
import type { Prisma } from '../generated/prisma/client';
import { isUniqueViolation } from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CategoryInput,
  CategoryUpdateInput,
} from './categories.schemas';

export const CATEGORY_NOT_FOUND = 'Category not found';
export const SLUG_TAKEN =
  'Another category already has this slug. Choose a different one.';

const CATEGORY_FIELDS = {
  id: true,
  name: true,
  slug: true,
  description: true,
  isActive: true,
  position: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CategorySelect;

type Category = Prisma.CategoryGetPayload<{ select: typeof CATEGORY_FIELDS }>;
type Field = keyof CategoryUpdateInput;
type Changes = Partial<Pick<Category, Field>>;

// The fields the change gives a new value. Sending a field with the value
// it already has is no change.
function changedFields(current: Category, input: CategoryUpdateInput): Field[] {
  return (Object.keys(input) as Field[]).filter(
    (field) => input[field] !== undefined && input[field] !== current[field],
  );
}

function pick(from: Changes, fields: Field[]): Changes {
  return Object.fromEntries(
    fields.map((field) => [field, from[field]]),
  ) as Changes;
}

// Product categories (ADR 0020). Admins and Super Users manage them, and
// every change is written to the audit log in the same transaction.
@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @InjectPinoLogger(CategoriesService.name)
    private readonly logger: PinoLogger,
  ) {}

  // Every category, hidden ones too, in the order customers will see them.
  // A catalog has only a few, so there is no paging.
  async list(): Promise<{ categories: Category[] }> {
    const categories = await this.prisma.category.findMany({
      orderBy: [{ position: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      select: CATEGORY_FIELDS,
    });
    return { categories };
  }

  async create(
    input: CategoryInput,
    context: AuditContext,
  ): Promise<Category> {
    const category = await this.saving(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.category.create({
          data: input,
          select: CATEGORY_FIELDS,
        });
        // In the same transaction: no category without its audit entry.
        const { name, slug, description, isActive, position } = created;
        await this.audit.record(tx, {
          ...context,
          action: 'category.created',
          targetType: 'category',
          targetId: created.id,
          after: { name, slug, description, isActive, position },
        });
        return created;
      }),
    );
    this.logger.info(
      { categoryId: category.id, actorId: context.actorId },
      'Category created',
    );
    return category;
  }

  // Changes only the fields given. A field set to the value it already has
  // is no change, and a request with no real change is not audited.
  async update(
    id: string,
    input: CategoryUpdateInput,
    context: AuditContext,
  ): Promise<Category> {
    const { category, changed } = await this.saving(() =>
      this.prisma.$transaction(async (tx) => {
        // One change at a time for each category, so the audit entry's
        // "before" is exactly what this change replaced. The ID is sent as
        // a parameter, never pasted into the SQL.
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM categories WHERE id = ${id}::uuid FOR UPDATE`;
        if (locked.length === 0) {
          throw new NotFoundException(CATEGORY_NOT_FOUND);
        }
        const current = await tx.category.findUniqueOrThrow({
          where: { id },
          select: CATEGORY_FIELDS,
        });
        const fields = changedFields(current, input);
        if (fields.length === 0) {
          return { category: current, changed: false };
        }
        const before = pick(current, fields);
        const after = pick(input, fields);
        const updated = await tx.category.update({
          where: { id },
          data: after,
          select: CATEGORY_FIELDS,
        });
        await this.audit.record(tx, {
          ...context,
          action: 'category.updated',
          targetType: 'category',
          targetId: id,
          before,
          after,
        });
        return { category: updated, changed: true };
      }),
    );
    if (changed) {
      this.logger.info(
        { categoryId: id, actorId: context.actorId },
        'Category changed',
      );
    }
    return category;
  }

  // A slug used by another category answers 409. The unique index decides,
  // so two requests at the same moment cannot both take it.
  private async saving<T>(save: () => Promise<T>): Promise<T> {
    try {
      return await save();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(SLUG_TAKEN);
      }
      throw error;
    }
  }
}
