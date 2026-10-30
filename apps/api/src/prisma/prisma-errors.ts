// Prisma's error for a unique constraint: someone saved the same value (for
// example the same email address) at the same moment.
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
