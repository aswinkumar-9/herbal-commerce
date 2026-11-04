function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === code
  );
}

// Prisma's error for a unique constraint: someone saved the same value (for
// example the same email address) at the same moment.
export function isUniqueViolation(error: unknown): boolean {
  return hasCode(error, 'P2002');
}

// Prisma's error for a foreign key: a row points to one that does not exist
// (a product's category), or a row that others point to cannot be deleted
// (a category that still has products).
export function isForeignKeyViolation(error: unknown): boolean {
  return hasCode(error, 'P2003');
}
