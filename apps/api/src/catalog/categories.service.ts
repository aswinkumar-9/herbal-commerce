import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AuditContext } from '../audit/audit-context';
import { AuditService } from '../audit/audit.service';
import type { Prisma } from '../generated/prisma/client';
import {
  isForeignKeyViolation,
  isUniqueViolation,
} from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CategoryInput,
  CategoryUpdateInput,
} from './categories.schemas';
import { changedFields, pick } from './changes';

export const CATEGORY_NOT_FOUND = 'Category not found';
export const SLUG_TAKEN =
  'Another category already has this slug. Choose a different one.';
export const CATEGORY_HAS_PRODUCTS =
  'This category still has products. Move them to another category or delete them first.';

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

// Staff and customers see categories in the same order.
const CATEGORY_ORDER = [
  { position: 'asc' },
  { name: 'asc' },
  { id: 'asc' },
] satisfies Prisma.CategoryOrderByWithRelationInput[];

type Category = Prisma.CategoryGetPayload<{ select: typeof CATEGORY_FIELDS }>;

// What the audit log keeps of a category: everything staff can set.
function auditFields({ name, slug, description, isActive, position }: Category) {
  return { name, slug, description, isActive, position };
}

// Product categories (ADR 0020). Admins and Super Users manage them, only
// Super Users delete them, and every change is written to the audit log in
// the same transaction. Customers see the active ones.
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
      orderBy: CATEGORY_ORDER,
      select: CATEGORY_FIELDS,
    });
    return { categories };
  }

  // What customers see: active categories only, and only what a shop page
  // needs.
  async listActive() {
    const categories = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: CATEGORY_ORDER,
      select: { name: true, slug: true, description: true },
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
        await this.audit.record(tx, {
          ...context,
          action: 'category.created',
          targetType: 'category',
          targetId: created.id,
          after: auditFields(created),
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
        const current = await this.lockedCategory(tx, id);
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

  // Deletes a category for good. Only Super Users may: the route is
  // @SuperUserOnly(). The audit entry keeps what the category was. While the
  // category has products, the database refuses (ON DELETE RESTRICT), and
  // the answer is 409.
  async remove(id: string, context: AuditContext): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await this.lockedCategory(tx, id);
        await tx.category.delete({ where: { id }, select: { id: true } });
        await this.audit.record(tx, {
          ...context,
          action: 'category.deleted',
          targetType: 'category',
          targetId: id,
          before: auditFields(current),
        });
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new ConflictException(CATEGORY_HAS_PRODUCTS);
      }
      throw error;
    }
    this.logger.info(
      { categoryId: id, actorId: context.actorId },
      'Category deleted',
    );
  }

  // Locks the category until the transaction ends, then reads it, or
  // answers 404. One change at a time for each category, so an audit
  // entry's "before" is exactly what the change replaced. The ID is sent as
  // a parameter, never pasted into the SQL.
  private async lockedCategory(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<Category> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM categories WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) {
      throw new NotFoundException(CATEGORY_NOT_FOUND);
    }
    return tx.category.findUniqueOrThrow({
      where: { id },
      select: CATEGORY_FIELDS,
    });
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
