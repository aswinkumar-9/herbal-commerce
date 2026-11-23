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
  CategoryOrderInput,
  CategoryUpdateInput,
} from './categories.schemas';
import { changedFields, pick } from './changes';
import { validationFailed } from './validation-failed';

export const CATEGORY_NOT_FOUND = 'Category not found';
export const SLUG_TAKEN =
  'Another category already has this slug. Choose a different one.';
export const CATEGORY_HAS_PRODUCTS =
  'This category still has products. Move them to another category or delete them first.';
export const CATEGORIES_CHANGED =
  'The categories changed while you were ordering them. Reload and try again.';
export const CATEGORY_HAS_SUBCATEGORIES =
  'This category still has subcategories. Move them to another category or delete them first.';
// Only two levels (part 15A): a category sits inside a top category, or in
// none.
const NO_SUCH_PARENT = {
  field: 'parentId',
  message: 'No category with this ID',
};
const PARENT_IS_SUBCATEGORY = {
  field: 'parentId',
  message:
    'This is a subcategory. Choose a top category: there are only two levels.',
};
const OWN_PARENT = {
  field: 'parentId',
  message: 'A category cannot sit inside itself',
};
const KEEPS_SUBCATEGORIES = {
  field: 'parentId',
  message:
    'This category has subcategories, so it cannot sit inside another. Move them first.',
};

const CATEGORY_FIELDS = {
  id: true,
  name: true,
  slug: true,
  description: true,
  isActive: true,
  position: true,
  parentId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CategorySelect;

// What a shop page shows of a category.
export const SHOP_CATEGORY_FIELDS = {
  name: true,
  slug: true,
  description: true,
} satisfies Prisma.CategorySelect;

// Staff and customers see categories in the same order, within each level.
export const CATEGORY_ORDER = [
  { position: 'asc' },
  { name: 'asc' },
  { id: 'asc' },
] satisfies Prisma.CategoryOrderByWithRelationInput[];

type Category = Prisma.CategoryGetPayload<{ select: typeof CATEGORY_FIELDS }>;

// Where a locked category sits: inside a top category, or in none.
interface Placement {
  id: string;
  parentId: string | null;
}

// What the audit log keeps of a category: everything staff can set.
function auditFields({
  name,
  slug,
  description,
  isActive,
  position,
  parentId,
}: Category) {
  return { name, slug, description, isActive, position, parentId };
}

// Top categories in order, each followed by its own subcategories in
// order, so the list reads as the shop shows it. Sorted, not grouped, so no
// category can ever be left out.
function treeOrder(sorted: Category[]): Category[] {
  const rank = new Map(sorted.map(({ id }, index) => [id, index]));
  const place = ({ id, parentId }: Category) =>
    (rank.get(parentId ?? id) ?? 0) * (sorted.length + 1) +
    (parentId === null ? 0 : (rank.get(id) ?? 0) + 1);
  return [...sorted].sort((a, b) => place(a) - place(b));
}

// A category may sit only inside a top category that exists: there are
// only two levels. The parent's row is locked, so this stays true until
// the transaction ends.
function checkParent(parent: Placement | undefined): void {
  if (!parent) {
    throw validationFailed([NO_SUCH_PARENT]);
  }
  if (parent.parentId !== null) {
    throw validationFailed([PARENT_IS_SUBCATEGORY]);
  }
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

  // Every category, hidden ones too, in the order customers will see them:
  // each top category followed by its subcategories. A catalog has only a
  // few, so there is no paging.
  async list(): Promise<{ categories: Category[] }> {
    const categories = await this.prisma.category.findMany({
      orderBy: CATEGORY_ORDER,
      select: CATEGORY_FIELDS,
    });
    return { categories: treeOrder(categories) };
  }

  // What customers see: the active top categories, each with its active
  // subcategories, and only what a shop page needs. A subcategory of a
  // hidden top category is hidden with it.
  async listActive() {
    const categories = await this.prisma.category.findMany({
      where: { isActive: true, parentId: null },
      orderBy: CATEGORY_ORDER,
      select: {
        ...SHOP_CATEGORY_FIELDS,
        subcategories: {
          where: { isActive: true },
          orderBy: CATEGORY_ORDER,
          select: SHOP_CATEGORY_FIELDS,
        },
      },
    });
    return { categories };
  }

  async create(
    input: CategoryInput,
    context: AuditContext,
  ): Promise<Category> {
    const category = await this.saving(() =>
      this.prisma.$transaction(async (tx) => {
        if (input.parentId) {
          const rows = await this.locked(tx, [input.parentId]);
          checkParent(rows.get(input.parentId));
        }
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
  // is no change, and a request with no real change is not audited. A
  // category moves into a top category only while it has no subcategories
  // of its own: there are only two levels.
  async update(
    id: string,
    input: CategoryUpdateInput,
    context: AuditContext,
  ): Promise<Category> {
    const { category, changed } = await this.saving(() =>
      this.prisma.$transaction(async (tx) => {
        const { current, parent } = await this.lockedCategory(
          tx,
          id,
          input.parentId,
        );
        const fields = changedFields(current, input);
        if (fields.length === 0) {
          return { category: current, changed: false };
        }
        if (fields.includes('parentId') && input.parentId) {
          if (input.parentId === id) {
            throw validationFailed([OWN_PARENT]);
          }
          checkParent(parent);
          if (await this.hasSubcategories(tx, id)) {
            throw validationFailed([KEEPS_SUBCATEGORIES]);
          }
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

  // Puts one level of categories in a new order, from the whole list first
  // to last, as staff dragged them (ADR 0032): the top categories, or the
  // subcategories of one (part 15A). Each one's position becomes its place
  // in the list. All of it is saved in one transaction, with an audit entry
  // for each category that moved, so each one's history shows it.
  async reorder(
    { parentId, ids }: CategoryOrderInput,
    context: AuditContext,
  ): Promise<{ categories: Category[] }> {
    const moved = await this.prisma.$transaction(async (tx) => {
      if (parentId) {
        const parent = await tx.category.findUnique({
          where: { id: parentId },
          select: { id: true },
        });
        if (!parent) {
          throw validationFailed([NO_SUCH_PARENT]);
        }
      }
      // The level's categories, locked in the order of their IDs, as
      // everywhere, so two new orders take turns. NO KEY UPDATE: products
      // being saved in a category don't wait for it.
      const current = await tx.$queryRaw<{ id: string; position: number }[]>`
        SELECT id, position FROM categories
         WHERE "parentId" IS NOT DISTINCT FROM ${parentId}::uuid
         ORDER BY id FOR NO KEY UPDATE`;
      const was = new Map(current.map((row) => [row.id, row.position]));
      // The list must be every category of the level: one added, moved or
      // deleted since staff loaded the page would otherwise be left out of
      // the order.
      if (current.length !== ids.length || ids.some((id) => !was.has(id))) {
        throw new ConflictException(CATEGORIES_CHANGED);
      }
      let count = 0;
      for (const [position, id] of ids.entries()) {
        const before = was.get(id);
        if (before === position) {
          continue;
        }
        await tx.category.update({
          where: { id },
          data: { position },
          select: { id: true },
        });
        await this.audit.record(tx, {
          ...context,
          action: 'category.updated',
          targetType: 'category',
          targetId: id,
          before: { position: before },
          after: { position },
        });
        count += 1;
      }
      return count;
    });
    if (moved > 0) {
      this.logger.info(
        { parentId, moved, actorId: context.actorId },
        'Categories reordered',
      );
    }
    return this.list();
  }

  // Deletes a category for good. Only Super Users may: the route is
  // @SuperUserOnly(). The audit entry keeps what the category was. While the
  // category has subcategories, or products, which the database refuses
  // (ON DELETE RESTRICT), the answer is 409.
  async remove(id: string, context: AuditContext): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const { current } = await this.lockedCategory(tx, id);
        // Locked, so none can be put inside it meanwhile.
        if (await this.hasSubcategories(tx, id)) {
          throw new ConflictException(CATEGORY_HAS_SUBCATEGORIES);
        }
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

  // Locks the category, and the top category it is to sit in if one is
  // given, then reads it, or answers 404.
  private async lockedCategory(
    tx: Prisma.TransactionClient,
    id: string,
    parentId?: string | null,
  ): Promise<{ current: Category; parent: Placement | undefined }> {
    const rows = await this.locked(tx, parentId ? [id, parentId] : [id]);
    if (!rows.has(id)) {
      throw new NotFoundException(CATEGORY_NOT_FOUND);
    }
    const current = await tx.category.findUniqueOrThrow({
      where: { id },
      select: CATEGORY_FIELDS,
    });
    return { current, parent: parentId ? rows.get(parentId) : undefined };
  }

  // Locks these categories until the transaction ends, in the order of
  // their IDs, as everywhere, so two changes never wait for each other in a
  // circle, and gives where each one sits. One change at a time for each
  // category, so an audit entry's "before" is exactly what the change
  // replaced, and a category being moved into can't be deleted or become a
  // subcategory meanwhile. The IDs are sent as parameters, never pasted
  // into the SQL.
  private async locked(
    tx: Prisma.TransactionClient,
    ids: string[],
  ): Promise<Map<string, Placement>> {
    const rows = await tx.$queryRaw<Placement[]>`
      SELECT id, "parentId" FROM categories
       WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
    return new Map(rows.map((row) => [row.id, row]));
  }

  private async hasSubcategories(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<boolean> {
    const child = await tx.category.findFirst({
      where: { parentId: id },
      select: { id: true },
    });
    return child !== null;
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
