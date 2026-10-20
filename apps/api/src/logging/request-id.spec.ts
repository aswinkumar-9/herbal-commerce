import { resolveRequestId } from './request-id';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('resolveRequestId', () => {
  it('keeps a safe incoming id', () => {
    expect(resolveRequestId('my-test-id-12345')).toBe('my-test-id-12345');
  });

  it('replaces unsafe values with a generated UUID', () => {
    expect(resolveRequestId('bad id\nwith newline')).toMatch(UUID);
    expect(resolveRequestId('short')).toMatch(UUID);
  });

  it('generates a UUID when the header is missing or repeated', () => {
    expect(resolveRequestId(undefined)).toMatch(UUID);
    expect(resolveRequestId(['a', 'b'])).toMatch(UUID);
  });
});
