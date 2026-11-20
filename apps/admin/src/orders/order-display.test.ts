import { describe, expect, it } from 'vitest';
import {
  ORDER_FILTERS,
  countName,
  givenBackNote,
  orderFilter,
  refundShown,
} from './order-display';

describe('the order filters', () => {
  it('reads the one in the address, and opens on the orders to pack otherwise', () => {
    expect(orderFilter('packed').label).toBe('Packed');
    expect(orderFilter(null).name).toBe('to-pack');
    expect(orderFilter('lost').name).toBe('to-pack');
  });

  it('puts the work first, the oldest first, and the rest newest first', () => {
    expect(ORDER_FILTERS.map((filter) => [filter.name, filter.query])).toEqual([
      ['to-pack', { status: 'PAID', sort: 'oldest' }],
      ['packed', { status: 'PACKED', sort: 'oldest' }],
      ['on-its-way', { status: 'SHIPPED', sort: 'oldest' }],
      ['delivered', { status: 'DELIVERED' }],
      ['cancelled', { status: 'CANCELLED' }],
      ['waiting', { status: 'PENDING_PAYMENT' }],
      ['expired', { status: 'EXPIRED' }],
      ['all', {}],
    ]);
  });
});

describe("the menu's count", () => {
  it.each([
    [{ count: 1, more: false }, '1'],
    [{ count: 99, more: false }, '99'],
    [{ count: 100, more: false }, '99+'],
    [{ count: 100, more: true }, '99+'],
  ])('reads %j as %s', (count, name) => {
    expect(countName(count)).toBe(name);
  });
});

describe('a failed refund given back by hand', () => {
  it('shows as given back only when it failed and was given back', () => {
    const at = '2026-11-20T04:35:00.000Z';
    expect(refundShown({ status: 'FAILED', givenBackAt: at })).toBe(
      'GIVEN_BACK',
    );
    expect(refundShown({ status: 'FAILED', givenBackAt: null })).toBe('FAILED');
    expect(refundShown({ status: 'PROCESSED', givenBackAt: at })).toBe(
      'PROCESSED',
    );
  });

  it('takes the note as the API does: 3 to 500 characters, without spaces at the ends', () => {
    expect(givenBackNote('  UPI, ref 123  ')).toBe('UPI, ref 123');
    expect(givenBackNote('Bank transfer\r\nUTR 4123')).toBe(
      'Bank transfer\nUTR 4123',
    );
    expect(givenBackNote('Bank\rUTR')).toBe('Bank\nUTR');
    expect(givenBackNote('  ok \n ')).toBeUndefined();
    expect(givenBackNote('abc')).toBe('abc');
    expect(givenBackNote('a'.repeat(500))).toHaveLength(500);
    expect(givenBackNote('a'.repeat(501))).toBeUndefined();
  });
});
