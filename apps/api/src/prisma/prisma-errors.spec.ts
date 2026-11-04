import { isForeignKeyViolation, isUniqueViolation } from './prisma-errors';

const withCode = (code: string) =>
  Object.assign(new Error('Prisma error'), { code });

describe('isUniqueViolation', () => {
  it("recognises Prisma's unique constraint error", () => {
    const error = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
    });
    expect(isUniqueViolation(error)).toBe(true);
  });

  it('says no to every other error and to things that are not errors', () => {
    const other = Object.assign(new Error('Record not found'), {
      code: 'P2025',
    });
    for (const value of [other, new Error('boom'), null, 'P2002', undefined]) {
      expect(isUniqueViolation(value)).toBe(false);
    }
  });
});

describe('isForeignKeyViolation', () => {
  it("recognises Prisma's foreign key error, and nothing else", () => {
    expect(isForeignKeyViolation(withCode('P2003'))).toBe(true);
    for (const value of [withCode('P2002'), new Error('boom'), null, 'P2003']) {
      expect(isForeignKeyViolation(value)).toBe(false);
    }
  });
});
