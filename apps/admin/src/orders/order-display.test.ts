import { describe, expect, it } from 'vitest';
import { ORDER_FILTERS, countName, orderFilter } from './order-display';

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
